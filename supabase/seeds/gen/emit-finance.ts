/**
 * emit-finance.ts — `07_finance.sql`: wallets, the transaction ledger, escrows, payouts, invoices,
 * orders, baskets, cards, payment methods, subscriptions and vault permissions.
 *
 * ## The ledger is COMPUTED, not typed
 *
 * `finance.transactions.balance_after_cents` is a materialised running balance (finance-model §7).
 * A hand-written ledger drifts from its own wallet balance the first time anybody edits a row, so
 * this emitter collects every money movement the world implies — opening credits, top-ups, escrow
 * holds, releases, team splits, product sales, refunds, payouts — sorts each wallet's events
 * chronologically, walks them, and refuses to emit if any balance would go negative. The wallet row
 * is written with the final balance; the trigger that would otherwise mint a 25,000.00 opening
 * credit at `now()` is disabled around the insert and replaced by an explicit, DATED opening credit,
 * so the history reads in order.
 *
 * The platform fee is 5% (SSOT `platform_fee_bp = 500`; the DB param ships at 0 per Decision #68(b)
 * and is not consulted here so the ledger matches the documented economics). Team income follows
 * finance-model §5: 10% vault retention (`finance.split_rules.vault_bp`), the remainder split by
 * `contribution_agreements.percent_bp`, dust to the vault.
 */

import { PRODUCTS, SERVICES } from "./corpus.ts";
import { ago, ahead, enumArr, HEADER, id, insert, jsonb, localAt, minutesOf, q, uuidFor } from "./sql.ts";
import { entity, party, persona, walletIdFor, type World } from "./resolve.ts";
import { BASKETS, CARDS, ORDERS, PAYOUTS, TOPUPS } from "./world.ts";
import { SCHEDULES } from "./schedules.ts";


const PLATFORM_FEE_BP = 500;
const VAULT_BP = 1000;
const INSTANT_PAYOUT_FEE_BP = 100;

interface Wallet {
	id: string;
	ownerType: "user" | "freelancer" | "team" | "business";
	ownerId: string;
	/** Persona/entity key, for messages. */
	key: string;
	events: LedgerEvent[];
}

interface LedgerEvent {
	daysAgo: number;
	direction: "credit" | "debit";
	amount: number;
	reason: string;
	refTable: string | null;
	refId: string | null;
	fundState: "available" | "pending" | "locked" | "on_hold";
	/** Tie-break within a day: lower runs first. */
	order: number;
}

function fee(amount: number): number {
	return Math.floor((amount * PLATFORM_FEE_BP) / 10000);
}

function priceMinorOf(item: { priceMinor?: number; price?: string }): number {
	if (typeof item.priceMinor === "number") return item.priceMinor;
	const n = Number(String(item.price ?? "").replace(/[^0-9.]/g, ""));
	return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export function emitFinance(world: World): string {
	const out: string[] = [
		HEADER(
			"07_finance.sql — wallets, ledger, escrows, orders, invoices, payouts and cards",
			"Every balance_after_cents is a computed running balance over a chronologically sorted event list; the generator refuses to emit a ledger that ever goes negative. The business-wallet opening-credit trigger is disabled around the wallet insert and replaced by a dated opening credit so the history reads in order.",
		),
	];

	// #region Wallets
	const wallets = new Map<string, Wallet>();
	const walletOf = (key: string): Wallet => {
		const who = party(world, key);
		const ownerType = who.kind === "user"
			? (who.persona.role === "freelancer" ? "freelancer" : "user")
			: who.kind;
		const ownerId = who.kind === "user" ? who.persona.userId : who.entity.entityId;
		const wid = walletIdFor(ownerType, ownerId);
		let w = wallets.get(wid);
		if (!w) {
			w = { id: wid, ownerType, ownerId, key, events: [] };
			wallets.set(wid, w);
		}
		return w;
	};
	for (const p of world.personas.values()) walletOf(p.key);
	for (const e of world.entities.values()) walletOf(e.key);

	const push = (key: string, e: Omit<LedgerEvent, "order"> & { order?: number }) =>
		walletOf(key).events.push({ order: 0, ...e });

	// Opening credits (what the wallet trigger would have minted, dated honestly).
	for (const e of world.entities.values()) {
		if (e.kind !== "business") continue;
		push(e.key, {
			daysAgo: e.createdDaysAgo,
			direction: "credit",
			amount: 2_500_000,
			reason: "demo_opening_credit",
			refTable: null,
			refId: null,
			fundState: "available",
		});
	}
	for (const t of TOPUPS) {
		push(t.owner, {
			daysAgo: t.daysAgo,
			direction: "credit",
			amount: t.cents,
			reason: "topup",
			refTable: "payment_methods",
			refId: uuidFor("payment_method", `${t.owner}:funding`),
			fundState: "available",
		});
	}

	/** Team income: vault retention to the team wallet, the rest split by contribution share. */
	const teamIncome = (
		teamKey: string,
		payout: number,
		daysAgo: number,
		refTable: string | null,
		refId: string | null,
		reason: string,
	): Array<{ persona: string; share: number }> => {
		const team = entity(world, teamKey);
		const vault = Math.floor((payout * VAULT_BP) / 10000);
		const pool = payout - vault;
		const shares: Array<{ persona: string; share: number }> = [];
		let distributed = 0;
		for (const m of team.members) {
			if (m.splitBp === undefined) continue;
			const share = Math.floor((pool * m.splitBp) / 10000);
			distributed += share;
			shares.push({ persona: m.persona, share });
			push(m.persona, {
				daysAgo,
				direction: "credit",
				amount: share,
				reason: "team_split",
				refTable,
				refId,
				fundState: "available",
				order: 1,
			});
		}
		push(teamKey, {
			daysAgo,
			direction: "credit",
			amount: vault + (pool - distributed),
			reason: `${reason}_vault_retention`,
			refTable,
			refId,
			fundState: "available",
		});
		return shares;
	};

	// Escrows: hold on fund, release to the payee.
	const escrowRows: string[][] = [];
	const payoutSplitRows: string[][] = [];
	const invoiceRows: string[][] = [];
	const invoiceLineRows: string[][] = [];
	for (const p of world.projects.values()) {
		for (const t of p.tickets) {
			const r = p.ticketsByKey.get(t.key)!;
			if (!r.escrowId) continue;
			if (!p.clientBusinessId) {
				throw new Error(
					`world: ticket "${p.key}:${t.key}" is paid but the client is not a business (finance.escrows needs payer_business_id)`,
				);
			}
			const stageSpec = p.stages.find((s) => s.key === t.stage)!;
			const stage = p.stagesByKey.get(t.stage)!;
			const amount = stageSpec.priceCents;
			const assignment = p.assignments.find((a) => a.stage === t.stage);
			if (!assignment) {
				throw new Error(`world: paid ticket "${p.key}:${t.key}" has no assignment on its stage`);
			}
			const payee = party(world, assignment.assignee);
			const payeeType = payee.kind === "user" ? "freelancer" : "team";
			const payeeId = payee.kind === "user" ? payee.persona.userId : payee.entity.entityId;
			const released = t.payment === "released";
			const platformFee = released ? fee(amount) : 0;
			const fundedDaysAgo = t.fundedDaysAgo ?? t.claimedDaysAgo ?? 1;

			escrowRows.push([
				id(r.escrowId),
				id(stage.id),
				id(r.id),
				id(p.clientBusinessId),
				q(payeeType),
				id(payeeId),
				String(amount),
				String(platformFee),
				"0",
				"'USD'",
				q(released ? "released" : "funded"),
				ago(fundedDaysAgo),
			]);

			const client = [...world.entities.values()].find((e) => e.entityId === p.clientBusinessId)!;
			push(client.key, {
				daysAgo: fundedDaysAgo,
				direction: "debit",
				amount,
				reason: "escrow_hold",
				refTable: "escrows",
				refId: r.escrowId,
				fundState: "locked",
			});

			if (released) {
				const releasedDaysAgo = t.releasedDaysAgo ?? 0;
				const payout = amount - platformFee;
				if (payee.kind === "user") {
					push(payee.persona.key, {
						daysAgo: releasedDaysAgo,
						direction: "credit",
						amount: payout,
						reason: "escrow_release",
						refTable: "escrows",
						refId: r.escrowId,
						fundState: "available",
					});
				} else {
					const shares = teamIncome(
						assignment.assignee,
						payout,
						releasedDaysAgo,
						"escrows",
						r.escrowId,
						"escrow_release",
					);
					for (const s of shares) {
						payoutSplitRows.push([
							id(uuidFor("payout_split", `${r.escrowId}:${s.persona}`)),
							id(r.escrowId),
							id(persona(world, s.persona).userId),
							String(s.share),
							"'USD'",
							ago(releasedDaysAgo),
						]);
					}
				}
			}

			// One invoice per escrow: paid once released, issued while funds are merely held.
			const invoiceId = uuidFor("invoice", `${p.key}:${t.key}`);
			invoiceRows.push([
				id(invoiceId),
				id(stage.id),
				id(p.clientBusinessId),
				id(payeeId),
				"'per_stage'",
				String(amount),
				String(amount),
				String(platformFee),
				"0",
				String(amount),
				"'USD'",
				q(released ? "paid" : "issued"),
				ahead(30 - fundedDaysAgo),
				released ? ago(t.releasedDaysAgo ?? 0) : "NULL",
				ago(fundedDaysAgo),
			]);
			invoiceLineRows.push([
				id(uuidFor("invoice_line", `${invoiceId}:escrow`)),
				id(invoiceId),
				"'escrow'",
				id(r.escrowId),
				q(`${t.title} — ${stageSpec.name}`),
				String(amount),
				"'USD'",
			]);
			if (platformFee > 0) {
				invoiceLineRows.push([
					id(uuidFor("invoice_line", `${invoiceId}:fee`)),
					id(invoiceId),
					"'platform_fee'",
					id(r.escrowId),
					"'Platform fee (5%) — deducted from the payee'",
					String(-platformFee),
					"'USD'",
				]);
			}
		}
	}

	// Orders: card-charged unless `fromWallet`; sellers are credited net of the platform fee.
	const orderRows: string[][] = [];
	const orderLineRows: string[][] = [];
	/** The seller's first conferencing platform, from the schedule they publish (`schedules.ts`). */
	const sellerPlatform = (principal: { entityKey?: string; accountUserId: string }) => {
		const ownerKey = principal.entityKey ??
			[...world.personas.values()].find((p) => p.userId === principal.accountUserId)?.key;
		return SCHEDULES.find((s) => s.owner === ownerKey)?.call?.platforms[0] ?? null;
	};
	/** The zone a seller keeps their schedule in: their team's, or their own. */
	const sellerTimezone = (principal: { entityKey?: string; accountUserId: string }) =>
		principal.entityKey
			? entity(world, principal.entityKey).timezone
			: [...world.personas.values()].find((p) => p.userId === principal.accountUserId)?.timezone ?? "UTC";
	const sellerOf = (corpusId: string) => {
		const item = corpusId.startsWith("pr-")
			? PRODUCTS.find((x) => x.key === corpusId)
			: SERVICES.find((x) => x.key === corpusId);
		if (!item) throw new Error(`world: order names unknown listing "${corpusId}"`);
		const principal = world.principals.get(item.owner)!;
		return { item, principal, isService: corpusId.startsWith("sv-") };
	};
	ORDERS.forEach((o, oi) => {
		const buyer = party(world, o.buyer);
		const buyerOwnerType = buyer.kind === "user" ? "user" : buyer.kind;
		const buyerOwnerId = buyer.kind === "user" ? buyer.persona.userId : buyer.entity.entityId;
		const placedBy = persona(world, o.placedBy);
		const orderId = uuidFor("order", o.key);
		let subtotal = 0;
		o.items.forEach((corpusId, li) => {
			const { item, principal, isService } = sellerOf(corpusId);
			const price = priceMinorOf(item);
			subtotal += price;
			const service = isService ? SERVICES.find((s) => s.key === corpusId)! : null;
			const itemType = !isService
				? "digital_product"
				: service!.model === "session"
				? "service_session"
				: service!.model === "direct_deliverable"
				? "single_service_task"
				: "one_off_service";
			const fulfilment = !isService
				? "download"
				: itemType === "service_session"
				? "session"
				: "engagement";
			orderLineRows.push([
				id(uuidFor("order_line", `${o.key}:${corpusId}`)),
				id(orderId),
				q(itemType),
				id(isService ? world.serviceId(corpusId) : world.productId(corpusId)),
				q(item.title),
				q(isService ? service!.delivery : "Instant download"),
				"1",
				String(price),
				"'USD'",
				q(fulfilment),
				!isService ? q(`${corpusId}.zip`) : "NULL",
				!isService ? String(18_400_000 + li * 2_100_000) : "NULL",
				!isService ? "'zip'" : "NULL",
				!isService ? "'standard'" : "NULL",
				o.scheduledAt !== undefined && fulfilment === "session"
					// The sitting in the SELLER's zone — the same instant their schedule holds for it.
					? localAt(
						sellerTimezone(principal),
						o.scheduledAt.week,
						o.scheduledAt.day,
						minutesOf(o.scheduledAt.time),
					)
					: "NULL",
				o.scheduledAt !== undefined && fulfilment === "session" ? q(placedBy.timezone) : "NULL",
				fulfilment === "session" ? String(service!.sessionMinutes ?? 60) : "NULL",
				// The room is on a platform the seller actually offers, from their own schedule.
				fulfilment === "session" ? q(sellerPlatform(principal)) : "NULL",
				String(li),
			]);

			// Seller side.
			const net = price - fee(price);
			const reason = isService ? "service_sale" : "product_sale";
			if (principal.kind === "team") {
				teamIncome(
					principal.entityKey!,
					net,
					o.daysAgo,
					"order_lines",
					uuidFor("order_line", `${o.key}:${corpusId}`),
					reason,
				);
			} else {
				const sellerKey = [...world.personas.values()].find((p) =>
					p.userId === principal.accountUserId
				)!.key;
				push(sellerKey, {
					daysAgo: o.daysAgo,
					direction: "credit",
					amount: net,
					reason,
					refTable: "order_lines",
					refId: uuidFor("order_line", `${o.key}:${corpusId}`),
					fundState: "available",
				});
				if (o.status === "refunded") {
					push(sellerKey, {
						daysAgo: o.daysAgo - 2,
						direction: "debit",
						amount: net,
						reason: "refund",
						refTable: "orders",
						refId: orderId,
						fundState: "available",
					});
				}
			}
		});
		if (o.fromWallet) {
			push(o.buyer, {
				daysAgo: o.daysAgo,
				direction: "debit",
				amount: subtotal,
				reason: "order_payment",
				refTable: "orders",
				refId: orderId,
				fundState: "available",
				order: -1,
			});
		}
		if (o.status === "refunded") {
			push(o.buyer, {
				daysAgo: o.daysAgo - 2,
				direction: "credit",
				amount: subtotal,
				reason: "refund",
				refTable: "orders",
				refId: orderId,
				fundState: "available",
			});
		}
		orderRows.push([
			id(orderId),
			q(`PJ-2026-${String(1000 + oi + 1)}`),
			q(o.status),
			ago(o.daysAgo),
			q(buyerOwnerType),
			id(buyerOwnerId),
			"'USD'",
			String(subtotal),
			"0",
			String(fee(subtotal)),
			String(PLATFORM_FEE_BP),
			"'seller_deducted'",
			String(subtotal),
			String(subtotal),
			"'stripe'",
			q(
				o.fromWallet
					? `${buyer.kind === "user" ? "Wallet" : buyer.entity.name + " vault"}`
					: `${CARDS[o.buyer]?.[0] ?? "card"} •••• ${o.cardLast4}`,
			),
			o.fromWallet ? "NULL" : id(uuidFor("saved_card", o.buyer)),
			q(`seed:${o.key}`),
			ago(o.daysAgo),
		]);
	});

	// Payouts.
	const payoutRows: string[][] = [];
	for (const po of PAYOUTS) {
		const payoutId = uuidFor("payout", `${po.owner}:${po.daysAgo}`);
		const txId = uuidFor("transaction", `${walletOf(po.owner).id}:payout:${po.daysAgo}`);
		push(po.owner, {
			daysAgo: po.daysAgo,
			direction: "debit",
			amount: po.cents,
			reason: "payout",
			refTable: "payouts",
			refId: payoutId,
			fundState: "available",
		});
		if (po.instant) {
			const instantFee = Math.floor((po.cents * INSTANT_PAYOUT_FEE_BP) / 10000);
			push(po.owner, {
				daysAgo: po.daysAgo,
				direction: "debit",
				amount: instantFee,
				reason: "instant_payout_fee",
				refTable: "payouts",
				refId: payoutId,
				fundState: "available",
				order: 1,
			});
		}
		payoutRows.push([
			id(payoutId),
			id(walletOf(po.owner).id),
			id(uuidFor("payment_method", `${po.owner}:payout`)),
			String(po.cents),
			"'USD'",
			"'paid'",
			String(!!po.instant),
			"'stripe'",
			q(`po_seed_${po.owner}_${po.daysAgo}`),
			id(txId),
			ago(po.daysAgo),
			po.instant ? ago(po.daysAgo) : ago(Math.max(0, po.daysAgo - 2)),
		]);
	}

	// Walk every wallet's ledger.
	const walletRows: string[][] = [];
	const txRows: string[][] = [];
	for (const w of wallets.values()) {
		const events = [...w.events].sort((a, b) => (b.daysAgo - a.daysAgo) || (a.order - b.order));
		let balance = 0;
		events.forEach((e, index) => {
			balance += e.direction === "credit" ? e.amount : -e.amount;
			if (balance < 0) {
				throw new Error(
					`ledger: wallet of "${w.key}" goes negative (${balance}) at ${e.reason} ${e.amount} ${e.daysAgo} days ago`,
				);
			}
			const txId = e.reason === "payout"
				? uuidFor("transaction", `${w.id}:payout:${e.daysAgo}`)
				: uuidFor("transaction", `${w.id}:${e.reason}:${e.refId ?? ""}:${e.daysAgo}:${e.amount}`);
			txRows.push([
				id(txId),
				id(w.id),
				q(e.direction),
				String(e.amount),
				"'USD'",
				q(e.reason),
				q(e.refTable),
				id(e.refId),
				String(balance),
				q(e.fundState),
				// Same-day events are staggered by their walk position, so ORDER BY created_at
				// reproduces exactly the sequence the running balance was computed in.
				`${ago(e.daysAgo)} + interval '${index} seconds'`,
			]);
		});
		walletRows.push([
			id(w.id),
			q(w.ownerType),
			id(w.ownerId),
			"'USD'",
			String(balance),
			w.ownerType === "business" ? "500000" : "NULL",
			ago(
				w.ownerType === "user" || w.ownerType === "freelancer"
					? persona(world, w.key).joinedDaysAgo
					: entity(world, w.key).createdDaysAgo,
			),
		]);
	}

	out.push(
		"-- The trigger would credit every business wallet 25,000.00 at now(); the dated opening credit below replaces it.",
	);
	out.push("ALTER TABLE finance.wallets DISABLE TRIGGER trg_seed_business_wallet;");
	out.push(
		insert(
			"finance.wallets",
			[
				"id",
				"owner_type",
				"owner_id",
				"currency",
				"balance_cents",
				"approval_threshold_cents",
				"created_at",
			],
			walletRows,
		),
	);
	out.push("ALTER TABLE finance.wallets ENABLE TRIGGER trg_seed_business_wallet;\n");

	out.push(
		insert(
			"finance.escrows",
			[
				"id",
				"project_stage_id",
				"ticket_id",
				"payer_business_id",
				"payee_type",
				"payee_id",
				"amount_cents",
				"platform_fee_cents",
				"deadline_bonus_cents",
				"currency",
				"status",
				"created_at",
			],
			escrowRows,
		),
	);
	out.push(
		insert(
			"finance.payout_splits",
			["id", "escrow_id", "member_user_id", "amount_cents", "currency", "created_at"],
			payoutSplitRows,
		),
	);
	out.push(
		insert(
			"finance.transactions",
			[
				"id",
				"wallet_id",
				"direction",
				"amount_cents",
				"currency",
				"reason",
				"ref_table",
				"ref_id",
				"balance_after_cents",
				"fund_state",
				"created_at",
			],
			txRows,
		),
	);
	// #endregion

	// #region Instruments: payment methods, saved cards, payout accounts and schedules
	const methodRows: string[][] = [];
	const cardRows: string[][] = [];
	for (const [ownerKey, [brand, last4, expMonth, expYear, holder]] of Object.entries(CARDS)) {
		const who = party(world, ownerKey);
		const ownerType = who.kind === "user" ? "user" : who.kind;
		const ownerId = who.kind === "user" ? who.persona.userId : who.entity.entityId;
		const methodId = uuidFor("payment_method", `${ownerKey}:funding`);
		methodRows.push([
			id(methodId),
			q(ownerType),
			id(ownerId),
			"'funding'",
			"'stripe'",
			q(`pm_seed_${ownerKey}`),
			q(`${holder} — ${brand} ${last4}`),
			q(brand),
			q(last4),
			"true",
			"false",
			"'active'",
			ago(45),
		]);
		cardRows.push([
			id(uuidFor("saved_card", ownerKey)),
			q(ownerType),
			id(ownerId),
			id(methodId),
			q(`pm_seed_${ownerKey}`),
			q(brand),
			q(last4),
			String(expMonth),
			String(expYear),
			q(holder),
			String(who.kind !== "user"),
			id(who.kind === "user" ? who.persona.userId : who.entity.ownerUserId),
			"true",
			ago(45),
		]);
	}
	const payoutAccountRows: string[][] = [];
	const payoutScheduleRows: string[][] = [];
	for (const p of world.personas.values()) {
		if (!p.payoutReady) continue;
		const methodId = uuidFor("payment_method", `${p.key}:payout`);
		const last4 = String(2000 + ((p.handle.length * 37) % 8000)).slice(-4);
		methodRows.push([
			id(methodId),
			"'freelancer'",
			id(p.userId),
			"'payout'",
			"'stripe'",
			q(`ba_seed_${p.handle}`),
			q(`Bank account •••• ${last4}`),
			"'bank_account'",
			q(last4),
			"false",
			"true",
			"'active'",
			ago(Math.min(p.joinedDaysAgo - 2, 50)),
		]);
		payoutAccountRows.push([
			id(uuidFor("payout_account", p.handle)),
			"'freelancer'",
			id(p.userId),
			"'stripe'",
			q(`acct_seed_${p.handle}`),
			"'verified'",
			ago(Math.min(p.joinedDaysAgo - 2, 50)),
		]);
		payoutScheduleRows.push([
			id(uuidFor("payout_schedule", p.handle)),
			"'freelancer'",
			id(p.userId),
			q(p.key === "maris" ? "scheduled_monthly" : p.key === "kwame" ? "threshold" : "manual"),
			id(methodId),
			p.key === "kwame" ? "250000" : "NULL",
			"'USD'",
			p.key === "maris" ? ahead(12) : "NULL",
			String(p.key === "kwame"),
			"true",
		]);
	}
	out.push(
		insert(
			"finance.payment_methods",
			[
				"id",
				"owner_type",
				"owner_id",
				"method_role",
				"provider",
				"external_ref",
				"label",
				"brand",
				"last4",
				"is_default_funding",
				"is_default_payout",
				"status",
				"created_at",
			],
			methodRows,
		),
	);
	out.push(
		insert(
			"finance.saved_cards",
			[
				"id",
				"owner_type",
				"owner_id",
				"payment_method_id",
				"stripe_payment_method_id",
				"brand",
				"last4",
				"exp_month",
				"exp_year",
				"cardholder_name",
				"is_business_card",
				"created_by_user_id",
				"is_default",
				"created_at",
			],
			cardRows,
		),
	);
	out.push(
		insert(
			"finance.payout_accounts",
			["id", "owner_type", "owner_id", "provider", "account_id", "status", "created_at"],
			payoutAccountRows,
		),
	);
	out.push(
		insert(
			"finance.payout_schedules",
			[
				"id",
				"owner_type",
				"owner_id",
				"mode",
				"destination_method_id",
				"threshold_cents",
				"currency",
				"next_run_at",
				"instant",
				"active",
			],
			payoutScheduleRows,
		),
	);
	out.push(
		insert(
			"finance.payouts",
			[
				"id",
				"wallet_id",
				"destination_method_id",
				"amount_cents",
				"currency",
				"status",
				"instant",
				"provider",
				"provider_ref",
				"transaction_id",
				"initiated_at",
				"settled_at",
			],
			payoutRows,
		),
	);
	// #endregion

	// #region Orders, invoices, baskets
	out.push(
		insert(
			"finance.orders",
			[
				"id",
				"reference",
				"status",
				"placed_at",
				"owner_type",
				"owner_id",
				"currency",
				"subtotal_minor",
				"creator_discount_minor",
				"platform_fee_minor",
				"platform_fee_bp",
				"platform_fee_mode",
				"total_minor",
				"charged_minor",
				"payment_provider",
				"payment_method_label",
				"saved_card_id",
				"idempotency_key",
				"created_at",
			],
			orderRows,
		),
	);
	out.push(
		insert(
			"finance.order_lines",
			[
				"id",
				"order_id",
				"item_type",
				"item_id",
				"title",
				"subtitle",
				"quantity",
				"line_total_minor",
				"currency",
				"fulfilment",
				"download_name",
				"download_bytes",
				"download_format",
				"licence",
				"scheduled_at",
				"timezone",
				"duration_minutes",
				"conferencing_provider",
				"position",
			],
			orderLineRows,
		),
	);
	out.push(
		insert(
			"finance.invoices",
			[
				"id",
				"project_stage_id",
				"issue_to_business_id",
				"issue_from_profile",
				"invoice_type",
				"amount_cents",
				"subtotal_cents",
				"platform_fee_cents",
				"tax_cents",
				"total_cents",
				"currency",
				"status",
				"due_date",
				"paid_at",
				"created_at",
			],
			invoiceRows,
		),
	);
	out.push(
		insert(
			"finance.invoice_line_items",
			["id", "invoice_id", "ref_type", "ref_id", "description", "amount_cents", "currency"],
			invoiceLineRows,
		),
	);

	const basketRows: string[][] = [];
	const basketItemRows: string[][] = [];
	for (const b of BASKETS) {
		const who = party(world, b.owner);
		const ownerType = who.kind === "user" ? "user" : who.kind;
		const ownerId = who.kind === "user" ? who.persona.userId : who.entity.entityId;
		const basketId = uuidFor("basket", b.owner);
		basketRows.push([id(basketId), q(ownerType), id(ownerId), "'Main Basket'", "true"]);
		b.products.forEach((corpusId, i) => {
			const product = PRODUCTS.find((x) => x.key === corpusId);
			if (!product) throw new Error(`world: basket names unknown product "${corpusId}"`);
			basketItemRows.push([
				id(uuidFor("basket_item", `${b.owner}:${corpusId}`)),
				id(basketId),
				"'digital_product'",
				id(world.productId(corpusId)),
				q(product.title),
				"'Instant download'",
				String(priceMinorOf(product)),
				"'USD'",
				"1",
				String(i),
				ago(1 + i),
			]);
		});
	}
	out.push(
		insert("finance.baskets", ["id", "owner_type", "owner_id", "name", "is_default"], basketRows),
	);
	out.push(
		insert(
			"finance.basket_items",
			[
				"id",
				"basket_id",
				"item_type",
				"item_id",
				"title",
				"subtitle",
				"unit_price_minor",
				"currency",
				"quantity",
				"position",
				"created_at",
			],
			basketItemRows,
		),
	);
	// #endregion

	// #region Subscriptions, vault governance, smoother, pots
	const subRows: string[][] = [];
	for (const p of world.personas.values()) {
		if (!p.plan) continue;
		subRows.push([
			id(uuidFor("subscription", p.handle)),
			id(p.userId),
			"'user'",
			id(p.userId),
			`(SELECT id FROM finance.plans WHERE code = ${q(p.plan)})`,
			"'active'",
			"'monthly'",
			ago(18),
			ahead(12),
			"1299",
			"'GBP'",
			q(`sub_seed_${p.handle}`),
			ago(200),
		]);
	}
	for (const e of world.entities.values()) {
		if (!e.teamPlan) continue;
		subRows.push([
			id(uuidFor("subscription", e.slug)),
			id(e.entityId),
			"'team'",
			id(e.entityId),
			`(SELECT id FROM finance.plans WHERE code = ${q(e.teamPlan)})`,
			"'active'",
			"'monthly'",
			ago(9),
			ahead(21),
			"2900",
			"'GBP'",
			q(`sub_seed_${e.slug}`),
			ago(e.createdDaysAgo - 30),
		]);
	}
	out.push(
		insert(
			"finance.subscriptions",
			[
				"id",
				"profile_id",
				"subject_type",
				"subject_id",
				"plan_id",
				"state",
				"billing_interval",
				"current_period_start",
				"current_period_end",
				"price_cents",
				"currency",
				"provider_ref",
				"started_at",
			],
			subRows,
		),
	);

	// Vault permissions for every business/team member, and a spend cap on one business admin.
	const vaultPermRows: string[][] = [];
	for (const e of world.entities.values()) {
		for (const m of e.members) {
			const caps = m.role === "owner"
				? [
					"view",
					"add_funds",
					"spend",
					"distribute",
					"withdraw",
					"manage_members",
					"manage_billing",
				]
				: m.role === "admin" || m.role === "lead"
				? ["view", "add_funds", "spend", "distribute"]
				: ["view"];
			vaultPermRows.push([
				id(uuidFor("vault_permission", `${e.key}:${m.persona}`)),
				id(e.walletId),
				id(persona(world, m.persona).userId),
				enumArr(caps, "finance.vault_capability"),
				id(e.ownerUserId),
			]);
		}
	}
	out.push(
		insert(
			"finance.vault_permissions",
			["id", "wallet_id", "member_user_id", "capabilities", "granted_by"],
			vaultPermRows,
		),
	);
	out.push(
		insert(
			"finance.spending_limits",
			[
				"id",
				"wallet_id",
				"member_user_id",
				"cap_cents",
				"per_transaction_cents",
				"period_interval",
				"spent_cents",
				"resets_at",
			],
			[[
				id(uuidFor("spending_limit", "helia:hannah")),
				id(entity(world, "helia").walletId),
				id(persona(world, "hannah").userId),
				"2500000",
				"1000000",
				"'monthly'",
				"800000",
				ahead(9),
			]],
			"(wallet_id, member_user_id)",
		),
	);
	out.push(
		insert(
			"finance.spend_approvals",
			[
				"id",
				"wallet_id",
				"requested_by",
				"amount_cents",
				"currency",
				"reason",
				"ref_table",
				"ref_id",
				"status",
				"approver_user_id",
				"decided_at",
				"expires_at",
				"created_at",
			],
			[[
				id(uuidFor("spend_approval", "helia:wallet-s2")),
				id(entity(world, "helia").walletId),
				id(persona(world, "hannah").userId),
				"1600000",
				"'USD'",
				"'Fund UX and flows on Helia wallet redesign once Juno accepts'",
				"'project_stages'",
				id(world.projects.get("helia-wallet")!.stagesByKey.get("s2")!.id),
				"'pending'",
				"NULL",
				"NULL",
				ahead(6),
				ago(1),
			]],
		),
	);
	out.push(
		insert(
			"finance.income_smoothing",
			[
				"id",
				"user_id",
				"enrolled",
				"target_monthly_cents",
				"currency",
				"fee_bp",
				"eligibility_met",
				"enrolled_at",
			],
			[
				[
					id(uuidFor("smoother", "maris")),
					id(persona(world, "maris").userId),
					"true",
					"600000",
					"'USD'",
					"50",
					"true",
					ago(60),
				],
				[
					id(uuidFor("smoother", "kwame")),
					id(persona(world, "kwame").userId),
					"false",
					"NULL",
					"'USD'",
					"50",
					"true",
					"NULL",
				],
			],
			"(user_id, currency)",
		),
	);
	out.push(
		insert(
			"finance.wallet_pots",
			["id", "wallet_id", "purpose", "name", "balance_cents", "currency", "auto_allocate_bp"],
			[
				[
					id(uuidFor("pot", "maris:tax")),
					id(walletOf("maris").id),
					"'tax'",
					"'Tax set-aside'",
					"180000",
					"'USD'",
					"2000",
				],
				[
					id(uuidFor("pot", "maris:gear")),
					id(walletOf("maris").id),
					"'goal'",
					"'New display'",
					"45000",
					"'USD'",
					"500",
				],
			],
		),
	);
	out.push(
		insert(
			"finance.ledger_audit",
			[
				"id",
				"wallet_id",
				"actor_user_id",
				"action",
				"amount_cents",
				"currency",
				"ref_table",
				"ref_id",
				"metadata",
				"created_at",
			],
			[
				[
					id(uuidFor("ledger_audit", "helia:topup")),
					id(entity(world, "helia").walletId),
					id(persona(world, "priya").userId),
					"'add_funds'",
					"6000000",
					"'USD'",
					"'payment_methods'",
					id(uuidFor("payment_method", "helia:funding")),
					jsonb({ note: "Q4 hiring budget" }),
					ago(30),
				],
				[
					id(uuidFor("ledger_audit", "atlas:topup")),
					id(entity(world, "atlas").walletId),
					id(persona(world, "daniel").userId),
					"'add_funds'",
					"6000000",
					"'USD'",
					"'payment_methods'",
					id(uuidFor("payment_method", "atlas:funding")),
					jsonb({ note: "Analytics platform build" }),
					ago(44),
				],
			],
		),
	);
	// #endregion

	return out.join("\n");
}
