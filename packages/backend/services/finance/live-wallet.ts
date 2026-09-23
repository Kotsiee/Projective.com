import type {
	AccessView,
	ActivityRange,
	ActivityView,
	AuditRow,
	BillRow,
	BudgetBurn,
	BusinessExtras,
	CategorySlice,
	FundableStage,
	FundingView,
	IncomeSmootherState,
	IncomingItem,
	InvoicesView,
	MethodsView,
	MoneyView,
	PaymentMethodView,
	PayoutsView,
	PersonalExtras,
	ProjectFlow,
	SpendApprovalView,
	SpendingCapView,
	SplitRuleView,
	SplitShare,
	StatementRow,
	TeamExtras,
	TransactionListParams,
	TransactionPage,
	TxnCategory,
	VaultCapability,
	VaultMember,
	WalletAction,
	WalletOverview,
	WalletSwitcher,
	WalletVariant,
	WalletVerification,
} from "@projective/types/finance";
import { currencyExponent, PLATFORM_FEE_BP, walletVariant } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import {
	dateLabel,
	flowSeries,
	LEDGER_WINDOW,
	ledgerPage,
	readLedger,
	reasonMeta,
	stageFacts,
	toLedgerLines,
	type TxnRow,
} from "./wallet-ledger.ts";
import {
	aggregateRef,
	availableOf,
	primaryCurrency,
	refOf,
	sumOf,
	type WalletAccount,
	type WalletContext,
} from "./wallet-scope.ts";
import { standingFor } from "./wallet-standing.ts";

/**
 * live-wallet — every `/wallet` read projection, built from the finance tables as the signed-in viewer.
 *
 * **The four balances are a projection, never stored** (`documentation/database/finance/Tables.md`):
 *
 * - **Available** — `finance.wallets.balance_cents`, the materialised running balance.
 * - **Locked** — escrow on active stages: for a seller, the escrows held for their work (what they
 *   will receive, net of the fee already set); for a paying business, the capital it has committed.
 * - **Pending** — releases inside the safety window (`finance.pending_releases`).
 * - **On hold** — escrow under dispute (`escrows.status = 'disputed'`).
 *
 * Every figure is a stored amount converted once through the read's money projector; nothing here
 * invents a balance, a series or a counterparty. What a wallet does not have — no escrow, no pot, no
 * payout history — reads as empty, not as a plausible sample.
 */

// #region Environment
/**
 * The actions this deployment cannot run, with the sentence the surface shows on them. Each needs an
 * external payment or payout processor; none is connected here, so each is offered locked with its
 * reason and refused server-side regardless (`wallet-actions.ts`).
 */
export const PROCESSOR_REASON: Readonly<Partial<Record<WalletAction, string>>> = {
	top_up: "Top-ups need a payment processor, which isn't connected in this environment.",
	withdraw: "Withdrawals need a payout processor, which isn't connected in this environment.",
	new_recurring: "Recurring deposits need a payment processor, which isn't connected in this environment.",
	add_method: "Payment methods are added through the payment processor, which isn't connected in this environment.",
	enrol_smoother: "The Income Smoother pays out through the payout processor, which isn't connected in this environment.",
};

const DAY = 86_400_000;
const LIVE_PROJECT_STATUSES = ["active", "on_hold"];
// #endregion

// #region Small helpers
function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function money(ctx: WalletContext, minor: number, currency: string): MoneyView {
	return ctx.money.price(minor, currency);
}

function convert(ctx: WalletContext, minor: number, currency: string): number {
	return ctx.money.canConvert(currency) ? ctx.money.convertMinor(minor, currency) : 0;
}

function walletIds(account: WalletAccount): string[] {
	return account.rows.map((row) => row.id);
}

function clearingLabel(availableAt: number, now = Date.now()): string {
	const days = Math.ceil((availableAt - now) / DAY);
	if (days <= 0) return "Clearing now";
	if (days === 1) return "Clears tomorrow";
	return `Clears in ${days} days`;
}

function nameOf(u: { username: string; first_name: string | null; last_name: string | null }): string {
	return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username;
}

interface PersonFace {
	name: string;
	handle: string;
	avatar: string | null;
}

/** Public faces of a set of people (names, handles, avatars through the public-media door). */
async function peopleFaces(ctx: WalletContext, userIds: readonly string[]): Promise<Map<string, PersonFace>> {
	const out = new Map<string, PersonFace>();
	const ids = [...new Set(userIds)];
	if (ids.length === 0) return out;
	const client = getUserClient(ctx.actor.accessToken);
	const { data, error } = await client.schema("org").from("users_public")
		.select("user_id, username, first_name, last_name, avatar_file_id")
		.in("user_id", ids);
	if (error) throw new Error(`org.users_public read failed: ${error.message}`);
	const people = (data ?? []) as {
		user_id: string;
		username: string;
		first_name: string | null;
		last_name: string | null;
		avatar_file_id: string | null;
	}[];
	const media = await fetchPublicMedia(client, people.map((u) => u.avatar_file_id));
	for (const u of people) {
		out.set(u.user_id, {
			name: nameOf(u),
			handle: u.username,
			avatar: u.avatar_file_id ? mediaUrl(media.get(u.avatar_file_id), "sm") : null,
		});
	}
	return out;
}
// #endregion

// #region Balances
interface EscrowRow {
	id: string;
	project_stage_id: string;
	payer_business_id: string;
	payee_type: string;
	payee_id: string;
	amount_cents: number;
	platform_fee_cents: number;
	currency: string;
	status: string;
	created_at: string;
}

/** The escrows that bear on an account: held for its work, or funded from its money. */
async function escrowsFor(ctx: WalletContext, account: WalletAccount): Promise<EscrowRow[]> {
	let q = getUserClient(ctx.actor.accessToken).schema("finance").from("escrows")
		.select("id, project_stage_id, payer_business_id, payee_type, payee_id, amount_cents, platform_fee_cents, currency, status, created_at");
	switch (account.scope) {
		case "personal":
			q = q.eq("payee_type", "freelancer").eq("payee_id", ctx.viewer.userId);
			break;
		case "team":
			q = q.eq("payee_type", "team").eq("payee_id", account.id);
			break;
		case "business":
			q = q.eq("payer_business_id", account.id);
			break;
		default:
			return [];
	}
	const { data, error } = await q;
	if (error) throw new Error(`finance.escrows read failed: ${error.message}`);
	return ((data ?? []) as EscrowRow[]).map((e) => ({
		...e,
		amount_cents: Number(e.amount_cents) || 0,
		platform_fee_cents: Number(e.platform_fee_cents) || 0,
	}));
}

/** Escrow still working (`held`, and the column default `funded`). */
function isLive(e: EscrowRow): boolean {
	return e.status === "held" || e.status === "funded";
}

/** What an escrow is worth to this account: what a payee will receive, or what a payer committed. */
function escrowValue(account: WalletAccount, e: EscrowRow): number {
	return account.scope === "business" ? e.amount_cents : Math.max(0, e.amount_cents - e.platform_fee_cents);
}

interface PendingRow {
	id: string;
	escrow_id: string | null;
	wallet_id: string;
	amount_cents: number;
	currency: string;
	released_at: string;
	available_at: string;
}

async function pendingFor(ctx: WalletContext, account: WalletAccount): Promise<PendingRow[]> {
	const ids = walletIds(account);
	if (ids.length === 0) return [];
	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").from("pending_releases")
		.select("id, escrow_id, wallet_id, amount_cents, currency, released_at, available_at")
		.in("wallet_id", ids)
		.eq("state", "pending");
	if (error) throw new Error(`finance.pending_releases read failed: ${error.message}`);
	return ((data ?? []) as PendingRow[]).map((p) => ({ ...p, amount_cents: Number(p.amount_cents) || 0 }));
}
// #endregion

// #region Verification
/** The finance-verification gate for this wallet, from the database's own KYC/KYB state. */
function verificationFor(ctx: WalletContext, account: WalletAccount, variant: WalletVariant): WalletVerification {
	if (variant === "business") {
		const kyb = account.owner.kybStatus ?? "unverified";
		const verified = kyb === "verified";
		return {
			subject: "business",
			kycStatus: kyb,
			tier: verified ? 3 : kyb === "pending" ? 2 : null,
			payoutReady: verified,
			canWithdraw: verified,
			canEarn: true,
			prompt: verified
				? null
				: kyb === "pending"
				? "Business verification (KYB) is in review — this vault opens once it clears"
				: "Verify your business (KYB) to operate this vault",
			href: null,
		};
	}
	// A buyer needs no identity check to pay (tap-and-pay, finance-model §KYC/KYB Gating).
	if (!ctx.viewer.isFreelancer) {
		return {
			subject: "client",
			kycStatus: "verified",
			tier: 1,
			payoutReady: true,
			canWithdraw: true,
			canEarn: true,
			prompt: null,
			href: null,
		};
	}
	const kyc = ctx.viewer.kycStatus ?? "unverified";
	const verified = kyc === "verified";
	return {
		subject: "freelancer",
		kycStatus: kyc,
		tier: ctx.viewer.kycTier === 1 || ctx.viewer.kycTier === 2 || ctx.viewer.kycTier === 3
			? ctx.viewer.kycTier
			: verified ? 2 : null,
		payoutReady: verified && ctx.viewer.payoutReady,
		canWithdraw: verified && ctx.viewer.payoutReady,
		canEarn: verified,
		prompt: !verified
			? kyc === "pending" ? "Identity verification is in review — you can earn once it clears" : "Verify your identity to start earning"
			: !ctx.viewer.payoutReady
			? "Add a payout method to get paid"
			: null,
		href: verified && !ctx.viewer.payoutReady ? "/wallet/payouts" : null,
	};
}
// #endregion

// #region Actions
/**
 * What this viewer may do on this wallet (capability → absence), then which of those cannot run here
 * (environment → locked, with the reason). The two gates behave differently on purpose — see the
 * footer rig — and the verification lock is applied on the client from `verification`.
 */
function actionsFor(
	variant: WalletVariant,
	account: WalletAccount,
	accounts: readonly WalletAccount[],
	smoother: IncomeSmootherState | null,
	fundable: readonly FundableStage[],
	vaultHolds: boolean,
	splitAgreed: boolean,
): { offered: WalletAction[]; unavailable: { action: WalletAction; reason: string }[] } {
	const caps = account.capabilities;
	const offered: WalletAction[] = [];
	const personal = variant === "personal";
	if (caps.includes("add_funds")) offered.push("top_up");
	if (caps.includes("withdraw")) offered.push("withdraw");
	// Money leaves a vault only for someone who may withdraw from it; a person's own wallet always.
	if (personal || caps.includes("withdraw")) offered.push("transfer");
	if (variant === "team" && caps.includes("distribute")) offered.push("distribute");
	// Escrow is paid by a business (`finance.escrows.payer_business_id`), so only its vault funds stages.
	if (account.scope === "business" && caps.includes("spend")) offered.push("fund_escrow");
	if (caps.includes("add_funds")) offered.push("new_recurring");
	if (personal || caps.includes("manage_billing")) offered.push("add_method");
	if (caps.includes("withdraw")) offered.push("set_payout");
	if (smoother?.status === "eligible") offered.push("enrol_smoother");
	if (!personal && !caps.includes("spend")) offered.push("request_spend");

	const unavailable: { action: WalletAction; reason: string }[] = [];
	for (const action of offered) {
		const processor = PROCESSOR_REASON[action];
		if (processor) {
			unavailable.push({ action, reason: processor });
			continue;
		}
		if (action === "fund_escrow" && fundable.length === 0) {
			unavailable.push({ action, reason: "No assigned stage is waiting for its escrow." });
		}
		if (action === "distribute") {
			if (!splitAgreed) unavailable.push({ action, reason: "Agree how this team splits its income first." });
			else if (!vaultHolds) unavailable.push({ action, reason: "The vault has nothing to distribute." });
		}
		if (action === "transfer") {
			const currencies = new Set(account.rows.filter((r) => r.balance_cents > 0).map((r) => r.currency));
			const reachable = accounts.some((other) =>
				other.key !== account.key && other.rows.some((r) => currencies.has(r.currency))
			);
			if (!reachable) {
				unavailable.push({
					action,
					reason: currencies.size === 0
						? "This wallet has nothing to transfer."
						: "You have no other wallet in the same currency to move money to.",
				});
			}
		}
	}
	return { offered, unavailable };
}
// #endregion

// #region Personal extras
interface SmootherRow {
	enrolled: boolean;
	target_monthly_cents: number | null;
	currency: string | null;
	fee_bp: number;
	eligibility_met: boolean;
}

/** The Income Smoother card, from the enrolment row and the earning history it is gated on. */
function smootherState(ctx: WalletContext, row: SmootherRow | null, rows: readonly TxnRow[]): IncomeSmootherState {
	const earnings = rows.filter((r) => r.direction === "credit" && reasonMeta(r.reason, "credit").category === "earning");
	const first = earnings.reduce((min, r) => Math.min(min, Date.parse(r.created_at)), Number.POSITIVE_INFINITY);
	const monthsElapsed = Number.isFinite(first) ? Math.floor((Date.now() - first) / (30 * DAY)) : 0;
	const monthsRequired = 3;
	const status: IncomeSmootherState["status"] = row?.enrolled
		? "enrolled"
		: row?.eligibility_met || monthsElapsed >= monthsRequired
		? "eligible"
		: "ineligible";
	const weeksToGo = status === "ineligible"
		? Math.max(0, Math.ceil(((monthsRequired * 30 * DAY) - (Number.isFinite(first) ? Date.now() - first : 0)) / (7 * DAY)))
		: 0;
	const feeBp = Number(row?.fee_bp ?? 50);
	const target = row?.enrolled && row.target_monthly_cents ? Number(row.target_monthly_cents) : null;
	const currency = row?.currency ?? primaryCurrency(ctx.accounts[0]) ?? ctx.money.display;
	return {
		status,
		feeBp,
		monthsRequired,
		monthsElapsed: Math.min(monthsElapsed, 999),
		weeksToGo,
		targetMonthly: target !== null ? money(ctx, target, currency) : null,
		// The smoothed figure after the fee — derived from the stored target, not projected income.
		projected: target !== null ? money(ctx, Math.round(target * (1 - feeBp / 10000)), currency) : null,
	};
}

async function personalExtras(
	ctx: WalletContext,
	account: WalletAccount,
	rows: readonly TxnRow[],
	lockedNet: MoneyView,
): Promise<PersonalExtras> {
	const db = getUserClient(ctx.actor.accessToken);
	if (!ctx.viewer.isFreelancer) {
		const [methodsRes] = await Promise.all([
			db.schema("finance").from("payment_methods")
				.select("brand, last4, label, is_default_funding, status, method_role")
				.eq("owner_id", ctx.viewer.userId)
				.in("owner_type", ["user", "freelancer"]),
		]);
		if (methodsRes.error) throw new Error(`finance.payment_methods read failed: ${methodsRes.error.message}`);
		const methods = (methodsRes.data ?? []) as {
			brand: string | null;
			last4: string | null;
			label: string | null;
			is_default_funding: boolean;
			status: string;
			method_role: string;
		}[];
		const source = methods.find((m) => m.is_default_funding && m.method_role !== "payout") ??
			methods.find((m) => m.method_role !== "payout");
		const monthStart = new Date();
		monthStart.setUTCDate(1);
		monthStart.setUTCHours(0, 0, 0, 0);
		let spent = 0;
		for (const r of rows) {
			if (r.direction !== "debit" || Date.parse(r.created_at) < monthStart.getTime()) continue;
			const category = reasonMeta(r.reason, "debit").category;
			if (category === "spend" || category === "escrow") spent += convert(ctx, r.amount_cents, r.currency);
		}
		return {
			incomeSmoother: null,
			taxPot: null,
			projectedFromLocked: null,
			fundingSource: source
				? clip([source.brand ?? source.label ?? "Card", source.last4 ? `·· ${source.last4}` : null].filter(Boolean).join(" "), 120)
				: null,
			spentThisMonth: ctx.money.derived(spent),
		};
	}

	const [smootherRes, potsRes] = await Promise.all([
		db.schema("finance").from("income_smoothing")
			.select("enrolled, target_monthly_cents, currency, fee_bp, eligibility_met")
			.eq("user_id", ctx.viewer.userId)
			.maybeSingle(),
		walletIds(account).length > 0
			? db.schema("finance").from("wallet_pots")
				.select("id, purpose, name, balance_cents, currency, auto_allocate_bp")
				.in("wallet_id", walletIds(account))
				.eq("purpose", "tax")
			: Promise.resolve({ data: [], error: null }),
	]);
	if (smootherRes.error) throw new Error(`finance.income_smoothing read failed: ${smootherRes.error.message}`);
	if (potsRes.error) throw new Error(`finance.wallet_pots read failed: ${potsRes.error.message}`);
	const pot = ((potsRes.data ?? []) as {
		id: string;
		purpose: "tax";
		name: string;
		balance_cents: number;
		currency: string;
		auto_allocate_bp: number;
	}[])[0];
	return {
		incomeSmoother: smootherState(ctx, smootherRes.data as SmootherRow | null, rows),
		taxPot: pot
			? {
				id: pot.id,
				purpose: "tax",
				name: clip(pot.name, 120),
				balance: money(ctx, Number(pot.balance_cents) || 0, pot.currency),
				autoAllocateBp: Number(pot.auto_allocate_bp) || 0,
			}
			: null,
		projectedFromLocked: lockedNet,
		fundingSource: null,
		spentThisMonth: null,
	};
}
// #endregion

// #region Team extras
interface SplitRuleRow {
	rule_type: "co_op" | "finders_fee" | "benevolent_dictator";
	vault_bp: number;
	finder_user_id: string | null;
	finder_bp: number | null;
}

function splitLabel(type: SplitRuleRow["rule_type"]): string {
	switch (type) {
		case "co_op":
			return "Co-op · agreed stakes";
		case "finders_fee":
			return "Finder's fee";
		case "benevolent_dictator":
			return "Benevolent dictator";
	}
}

async function teamExtras(
	ctx: WalletContext,
	account: WalletAccount,
	escrows: readonly EscrowRow[],
): Promise<TeamExtras> {
	const db = getUserClient(ctx.actor.accessToken);
	const [ruleRes, stakesRes, membersRes] = await Promise.all([
		db.schema("finance").from("split_rules")
			.select("rule_type, vault_bp, finder_user_id, finder_bp")
			.eq("team_id", account.id)
			.eq("active", true)
			.maybeSingle(),
		db.schema("finance").from("contribution_agreements")
			.select("member_user_id, percent_bp")
			.eq("team_id", account.id),
		db.schema("finance").from("vault_permissions")
			.select("member_user_id, capabilities")
			.in("wallet_id", walletIds(account).length > 0 ? walletIds(account) : ["00000000-0000-0000-0000-000000000000"]),
	]);
	if (ruleRes.error) throw new Error(`finance.split_rules read failed: ${ruleRes.error.message}`);
	if (stakesRes.error) throw new Error(`finance.contribution_agreements read failed: ${stakesRes.error.message}`);
	if (membersRes.error) throw new Error(`finance.vault_permissions read failed: ${membersRes.error.message}`);

	const stakes = (stakesRes.data ?? []) as { member_user_id: string; percent_bp: number }[];
	const perms = new Map<string, string[]>();
	for (const p of (membersRes.data ?? []) as { member_user_id: string; capabilities: string[] | null }[]) {
		perms.set(p.member_user_id, p.capabilities ?? []);
	}
	const faces = await peopleFaces(ctx, stakes.map((s) => s.member_user_id));
	const members = stakes
		.map((s) => {
			const face = faces.get(s.member_user_id);
			const caps = perms.get(s.member_user_id) ?? ["view"];
			return {
				userId: s.member_user_id,
				handle: face?.handle ?? null,
				name: clip(face?.name ?? "Member", 120),
				avatar: face?.avatar ?? null,
				stakeBp: Number(s.percent_bp) || 0,
				role: caps.includes("manage_billing")
					? "owner" as const
					: caps.includes("manage_members")
					? "admin" as const
					: caps.includes("spend")
					? "pm" as const
					: "member" as const,
			};
		})
		.sort((a, b) => b.stakeBp - a.stakeBp);

	const rule = ruleRes.data as SplitRuleRow | null;
	const currency = primaryCurrency(account) ?? ctx.money.display;
	// The preview divides the team's most recent release the documented way (finance-model.md §5):
	// the 5% platform fee off the gross, the vault's cut off the net, then each member's agreed stake,
	// with anything that does not divide kept in the vault.
	const last = escrows.filter((e) => e.status === "released")
		.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
	let splitRule: SplitRuleView;
	if (!rule) {
		splitRule = {
			ruleType: "co_op",
			label: "No split agreed yet",
			vaultBp: 0,
			finderHandle: null,
			finderBp: null,
			previewGross: null,
			previewFee: null,
			previewVault: null,
			previewShares: [],
		};
	} else if (!last) {
		splitRule = {
			ruleType: rule.rule_type,
			label: splitLabel(rule.rule_type),
			vaultBp: Number(rule.vault_bp) || 0,
			finderHandle: rule.finder_user_id ? faces.get(rule.finder_user_id)?.handle ?? null : null,
			finderBp: rule.finder_bp,
			previewGross: null,
			previewFee: null,
			previewVault: null,
			previewShares: [],
		};
	} else {
		const gross = last.amount_cents;
		const fee = Math.floor((gross * PLATFORM_FEE_BP + 5000) / 10000);
		const net = gross - fee;
		const vaultCut = Math.floor((net * (Number(rule.vault_bp) || 0)) / 10000);
		const remainder = net - vaultCut;
		let paid = 0;
		const shares: SplitShare[] = [];
		for (const m of members) {
			const minor = Math.floor((remainder * m.stakeBp) / 10000);
			paid += minor;
			shares.push({ name: m.name, handle: m.handle, amount: money(ctx, minor, last.currency), shareBp: m.stakeBp });
		}
		splitRule = {
			ruleType: rule.rule_type,
			label: splitLabel(rule.rule_type),
			vaultBp: Number(rule.vault_bp) || 0,
			finderHandle: rule.finder_user_id ? faces.get(rule.finder_user_id)?.handle ?? null : null,
			finderBp: rule.finder_bp,
			previewGross: money(ctx, gross, last.currency),
			previewFee: money(ctx, fee, last.currency),
			previewVault: money(ctx, vaultCut + (remainder - paid), last.currency),
			previewShares: shares.slice(0, 24),
		};
	}
	return {
		splitRule,
		members: members.map((m) => ({ ...m, handle: m.handle ? clip(m.handle, 40) : null })),
		vaultBalance: account.rows.length > 0 ? availableOf(ctx.money, account) : money(ctx, 0, currency),
	};
}
// #endregion

// #region Business extras
/** Stages this business may fund right now: assigned, with assigned and unpaid tickets. */
export async function fundableStages(ctx: WalletContext, account: WalletAccount): Promise<FundableStage[]> {
	if (account.scope !== "business" || !account.capabilities.includes("spend")) return [];
	const db = getUserClient(ctx.actor.accessToken).schema("projects");
	const projectsRes = await db.from("projects").select("id, slug, title, currency").eq("client_business_id", account.id);
	if (projectsRes.error) throw new Error(`projects.projects read failed: ${projectsRes.error.message}`);
	const projects = (projectsRes.data ?? []) as { id: string; slug: string; title: string; currency: string | null }[];
	if (projects.length === 0) return [];
	const stagesRes = await db.from("project_stages")
		.select("id, name, project_id, unit_price_cents")
		.in("project_id", projects.map((p) => p.id))
		.eq("status", "assigned");
	if (stagesRes.error) throw new Error(`projects.project_stages read failed: ${stagesRes.error.message}`);
	const stages = (stagesRes.data ?? []) as { id: string; name: string; project_id: string; unit_price_cents: number | null }[];
	if (stages.length === 0) return [];
	const ticketsRes = await db.from("tickets")
		.select("current_stage_id, unit_price_cents")
		.in("current_stage_id", stages.map((s) => s.id))
		.not("current_assignee_id", "is", null)
		.eq("payment_status", "unpaid");
	if (ticketsRes.error) throw new Error(`projects.tickets read failed: ${ticketsRes.error.message}`);
	const tickets = (ticketsRes.data ?? []) as { current_stage_id: string; unit_price_cents: number | null }[];

	const out: FundableStage[] = [];
	for (const stage of stages) {
		const own = tickets.filter((t) => t.current_stage_id === stage.id);
		// Priced exactly as `fn_hold_ticket_escrow` will price it: the ticket's own rate, else the stage's.
		const amount = own.reduce((sum, t) => sum + (Number(t.unit_price_cents ?? stage.unit_price_cents ?? 0) || 0), 0);
		if (own.length === 0 || amount <= 0) continue;
		const project = projects.find((p) => p.id === stage.project_id)!;
		out.push({
			projectId: clip(project.slug, 64),
			projectTitle: clip(project.title, 160),
			stageId: stage.id,
			stageName: clip(stage.name, 120),
			amount: money(ctx, amount, (project.currency ?? "USD").toUpperCase()),
			ticketCount: own.length,
		});
	}
	return out.slice(0, 40);
}

async function spendingCaps(ctx: WalletContext, account: WalletAccount): Promise<SpendingCapView[]> {
	const ids = walletIds(account);
	if (ids.length === 0) return [];
	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").from("spending_limits")
		.select("id, wallet_id, member_user_id, cap_cents, spent_cents, period_interval, resets_at")
		.in("wallet_id", ids);
	if (error) throw new Error(`finance.spending_limits read failed: ${error.message}`);
	const rows = (data ?? []) as {
		id: string;
		wallet_id: string;
		member_user_id: string;
		cap_cents: number;
		spent_cents: number;
		period_interval: string;
		resets_at: string | null;
	}[];
	const faces = await peopleFaces(ctx, rows.map((r) => r.member_user_id));
	return rows.map((r) => {
		const currency = account.rows.find((w) => w.id === r.wallet_id)?.currency ?? ctx.money.display;
		const cap = Number(r.cap_cents) || 0;
		const spent = Number(r.spent_cents) || 0;
		const face = faces.get(r.member_user_id);
		const interval = r.period_interval === "weekly" || r.period_interval === "per_transaction"
			? r.period_interval
			: "monthly";
		return {
			id: r.id,
			memberName: clip(face?.name ?? "Member", 120),
			memberHandle: face?.handle ?? null,
			avatar: face?.avatar ?? null,
			cap: money(ctx, cap, currency),
			spent: money(ctx, spent, currency),
			interval: interval as SpendingCapView["interval"],
			utilizationBp: cap > 0 ? Math.min(10000, Math.round((spent / cap) * 10000)) : 0,
			resetsLabel: r.resets_at
				? `Resets ${new Date(r.resets_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
				: null,
		};
	});
}

async function businessExtras(
	ctx: WalletContext,
	account: WalletAccount,
	escrows: readonly EscrowRow[],
): Promise<BusinessExtras> {
	const db = getUserClient(ctx.actor.accessToken);
	const [projectsRes, invoicesRes, caps, fundable] = await Promise.all([
		db.schema("projects").from("projects")
			.select("id, budget_amount_cents, currency, status")
			.eq("client_business_id", account.id)
			.in("status", LIVE_PROJECT_STATUSES),
		db.schema("finance").from("invoices")
			.select("total_cents, currency, status")
			.eq("issue_to_business_id", account.id)
			.in("status", ["issued", "overdue"]),
		spendingCaps(ctx, account),
		fundableStages(ctx, account),
	]);
	if (projectsRes.error) throw new Error(`projects.projects read failed: ${projectsRes.error.message}`);
	if (invoicesRes.error) throw new Error(`finance.invoices read failed: ${invoicesRes.error.message}`);

	// The burn-down is the business's live project budgets against the escrow it has committed to
	// them. There is no separate operating-budget figure in the schema, so none is shown.
	const live = (projectsRes.data ?? []) as { id: string; budget_amount_cents: number | null; currency: string | null }[];
	const liveIds = new Set(live.map((p) => p.id));
	let budget = 0;
	for (const p of live) budget += convert(ctx, Number(p.budget_amount_cents ?? 0) || 0, p.currency ?? "USD");
	const stages = await stageFacts(ctx, escrows.map((e) => e.project_stage_id));
	const committed = escrows
		.filter((e) => e.status !== "refunded" && liveIds.has(stages.get(e.project_stage_id)?.projectId ?? ""))
		.map((e) => ({ at: Date.parse(e.created_at), minor: convert(ctx, e.amount_cents, e.currency) }))
		.sort((a, b) => a.at - b.at);
	const spent = committed.reduce((sum, c) => sum + c.minor, 0);
	const now = Date.now();
	const points: BudgetBurn["points"] = [];
	for (let d = 30; d >= 0; d -= 3) {
		const at = now - d * DAY;
		points.push({
			label: new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
			plannedMinor: budget,
			actualMinor: committed.filter((c) => c.at <= at).reduce((sum, c) => sum + c.minor, 0),
		});
	}
	const invoices = (invoicesRes.data ?? []) as { total_cents: number; currency: string }[];
	let due = 0;
	for (const inv of invoices) due += convert(ctx, Number(inv.total_cents) || 0, inv.currency);

	return {
		burnDown: {
			label: "Live project budgets",
			budget: ctx.money.derived(budget),
			spent: ctx.money.derived(spent),
			remaining: ctx.money.derived(Math.max(0, budget - spent)),
			utilizationBp: budget > 0 ? Math.min(10000, Math.round((spent / budget) * 10000)) : 0,
			points,
		},
		caps,
		invoicesDue: invoices.length,
		invoicesDueAmount: invoices.length > 0 ? ctx.money.derived(due) : null,
		fundable,
	};
}
// #endregion

// #region Overview
/** The Overview hub for the target wallet, or the read-only rollup. */
export async function overviewOf(ctx: WalletContext): Promise<WalletOverview> {
	if (ctx.target === "aggregate") return aggregateOverview(ctx);
	const account = ctx.target;
	const variant = walletVariant(account.scope);
	const [rows, escrows, pending] = await Promise.all([
		readLedger(ctx, walletIds(account), { limit: LEDGER_WINDOW }),
		escrowsFor(ctx, account),
		pendingFor(ctx, account),
	]);

	const liveEscrows = escrows.filter(isLive);
	const disputed = escrows.filter((e) => e.status === "disputed");
	// Every figure is summed in the currency it is HELD in and converted once (`sumOf`), exactly as the
	// Available balance is. Converting each amount and summing the conversions rounds every term, so a
	// vault that has earned $2,911.75 and spent nothing would show £2,292.73 earned beside £2,292.72
	// held — a penny that does not exist, on the one surface whose job is to be exact.
	const locked = sumOf(ctx.money, liveEscrows.map((e) => ({ minor: escrowValue(account, e), currency: e.currency })));
	const pendingView = sumOf(ctx.money, pending.map((p) => ({ minor: p.amount_cents, currency: p.currency })));
	const onHold = sumOf(ctx.money, disputed.map((e) => ({ minor: escrowValue(account, e), currency: e.currency })));
	const available = availableOf(ctx.money, account);
	const seller = account.scope === "team" || (account.scope === "personal" && ctx.viewer.isFreelancer);

	// Lifetime: what a seller has earned, or what a buyer has spent — within the ledger window.
	const lifetime = sumOf(
		ctx.money,
		rows.filter((r) => {
			const category = reasonMeta(r.reason, r.direction).category;
			return seller
				? r.direction === "credit" && category === "earning"
				: r.direction === "debit" && (category === "spend" || category === "escrow");
		}).map((r) => ({ minor: r.amount_cents, currency: r.currency })),
	);

	const stages = await stageFacts(ctx, [...liveEscrows, ...escrows].map((e) => e.project_stage_id));
	const incoming: IncomingItem[] = [];
	if (account.scope !== "business") {
		for (const e of liveEscrows.slice(0, 8)) {
			const facts = stages.get(e.project_stage_id);
			incoming.push({
				id: `escrow-${e.id}`,
				kind: "escrow_funded",
				label: clip(facts ? `Escrow funded · ${facts.projectTitle}` : "Escrow funded", 160),
				amount: money(ctx, escrowValue(account, e), e.currency),
				state: "locked",
				clearingLabel: "On active stage",
				clearingAt: null,
				clearingFraction: 0,
				href: facts ? clip(facts.stageSlug ? `/projects/${facts.projectSlug}/${facts.stageSlug}` : `/projects/${facts.projectSlug}`, 200) : null,
			});
		}
	}
	for (const p of pending.slice(0, 12 - incoming.length)) {
		const releasedAt = Date.parse(p.released_at);
		const availableAt = Date.parse(p.available_at);
		const span = Math.max(1, availableAt - releasedAt);
		incoming.push({
			id: `pending-${p.id}`,
			kind: "pending_release",
			label: "Release clearing",
			amount: money(ctx, p.amount_cents, p.currency),
			state: "pending",
			clearingLabel: clearingLabel(availableAt),
			clearingAt: new Date(availableAt).toISOString(),
			clearingFraction: Math.min(1, Math.max(0, (Date.now() - releasedAt) / span)),
			href: "/wallet/transactions",
		});
	}

	const personal = variant === "personal"
		? await personalExtras(ctx, account, rows, locked)
		: null;
	const [team, business] = await Promise.all([
		variant === "team" ? teamExtras(ctx, account, escrows) : Promise.resolve(null),
		variant === "business" && account.scope === "business"
			? businessExtras(ctx, account, escrows)
			: Promise.resolve(null),
	]);
	const verification = verificationFor(ctx, account, variant);
	const vaultHolds = account.rows.some((r) => r.balance_cents > 0);
	const splitAgreed = (team?.members.length ?? 0) > 0 && team?.splitRule.label !== "No split agreed yet";
	const { offered, unavailable } = actionsFor(
		variant,
		account,
		ctx.accounts,
		personal?.incomeSmoother ?? null,
		business?.fundable ?? [],
		vaultHolds,
		splitAgreed,
	);
	const standing = seller
		? await standingFor(
			ctx,
			account.scope === "team" ? { type: "team", id: account.id } : { type: "freelancer", id: ctx.viewer.userId },
			rows,
		)
		: null;

	// The capital is the four displayed states added up, so the meter's segments sum to it exactly.
	const capitalMinor = available.minor + locked.minor + pendingView.minor + onHold.minor;
	return {
		ref: refOf(ctx.money, account),
		variant,
		balances: {
			currency: ctx.money.display,
			availableCents: available.minor,
			lockedCents: locked.minor,
			pendingCents: pendingView.minor,
			onHoldCents: onHold.minor,
			lifetimeCents: lifetime.minor,
		},
		available,
		locked,
		pending: pendingView,
		onHold,
		lifetime,
		capital: ctx.money.derived(capitalMinor),
		lockedStageCount: new Set(liveEscrows.map((e) => e.project_stage_id)).size,
		heldCaseCount: disputed.length,
		incoming: incoming.slice(0, 12),
		flow: flowSeries(ctx, rows, 90, 12),
		flowRange: "90d",
		recent: await toLedgerLines(ctx, rows.slice(0, 8)),
		quickActions: offered.slice(0, 10),
		unavailable: unavailable.slice(0, 10),
		capabilities: account.capabilities,
		verification,
		standing,
		personal,
		team,
		business,
	};
}

/** The read-only rollup: every visible wallet, summed. It moves nothing and carries no rung. */
async function aggregateOverview(ctx: WalletContext): Promise<WalletOverview> {
	const ids = ctx.accounts.flatMap(walletIds);
	const rows = await readLedger(ctx, ids, { limit: LEDGER_WINDOW });
	const ref = aggregateRef(ctx.money, ctx.accounts);
	const lifetime = sumOf(
		ctx.money,
		rows.filter((r) => r.direction === "credit" && reasonMeta(r.reason, "credit").category === "earning")
			.map((r) => ({ minor: r.amount_cents, currency: r.currency })),
	);
	const personal = ctx.accounts.find((a) => a.scope === "personal");
	return {
		ref,
		variant: "personal",
		balances: {
			currency: ctx.money.display,
			availableCents: ref.available.minor,
			lockedCents: 0,
			pendingCents: 0,
			onHoldCents: 0,
			lifetimeCents: lifetime.minor,
		},
		available: ref.available,
		locked: ctx.money.derived(0),
		pending: ctx.money.derived(0),
		onHold: ctx.money.derived(0),
		lifetime,
		capital: ref.available,
		lockedStageCount: 0,
		heldCaseCount: 0,
		incoming: [],
		flow: flowSeries(ctx, rows, 90, 12),
		flowRange: "90d",
		recent: await toLedgerLines(ctx, rows.slice(0, 8)),
		quickActions: [],
		unavailable: [],
		capabilities: ["view"],
		verification: personal ? verificationFor(ctx, personal, "personal") : verificationFor(ctx, ctx.accounts[0], "personal"),
		standing: null,
		personal: null,
		team: null,
		business: null,
	};
}
// #endregion

// #region Switcher
export function switcherOf(ctx: WalletContext): WalletSwitcher {
	const accounts = ctx.accounts.map((a) => refOf(ctx.money, a));
	const aggregate = aggregateRef(ctx.money, ctx.accounts);
	const active = ctx.target === "aggregate" ? aggregate : refOf(ctx.money, ctx.target);
	return { active, accounts, aggregate };
}
// #endregion

// #region Transactions + activity
export function transactionsOf(ctx: WalletContext, params: TransactionListParams): Promise<TransactionPage> {
	const ids = ctx.target === "aggregate" ? ctx.accounts.flatMap(walletIds) : walletIds(ctx.target);
	return ledgerPage(ctx, ids, params);
}

/** A text cell as a spreadsheet will read it: quoted when it must be, and never a formula. */
function csvText(value: string | null): string {
	let text = value ?? "";
	// A cell a spreadsheet would evaluate — `=`, `+`, `-`, `@`, or a control character first — is made
	// literal, so a counterparty named `=HYPERLINK(…)` stays a name when the export is opened.
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The wallet's ledger as CSV, for the rig's Export control. Every line in the read window, newest
 * first, with each amount in the currency it was STORED in — an export is a record, and a record in a
 * converted currency would change every time the rates did. Debits are negative.
 */
export async function ledgerCsvOf(ctx: WalletContext): Promise<{ filename: string; csv: string }> {
	const accounts = ctx.target === "aggregate" ? ctx.accounts : [ctx.target];
	const rows = await readLedger(ctx, accounts.flatMap(walletIds), { limit: LEDGER_WINDOW });
	const lines = await toLedgerLines(ctx, rows);
	const out = ["Date,Description,Counterparty,Category,Status,Amount,Currency,Reference"];
	for (const line of lines) {
		const held = line.amount.origin ?? line.amount;
		const exponent = currencyExponent(held.currency);
		const signed = (line.direction === "debit" ? -held.minor : held.minor) / 10 ** exponent;
		out.push([
			line.at,
			csvText(line.title),
			csvText(line.counterparty),
			line.category,
			line.fundState,
			signed.toFixed(exponent),
			held.currency.toUpperCase(),
			csvText(line.refId),
		].join(","));
	}
	const who = ctx.target === "aggregate" ? "all-accounts" : ctx.target.scope;
	const day = new Date().toISOString().slice(0, 10);
	return { filename: `projective-wallet-${who}-${day}.csv`, csv: `${out.join("\r\n")}\r\n` };
}

export async function activityOf(ctx: WalletContext, range: ActivityRange): Promise<ActivityView> {
	const days = range === "30d" ? 30 : range === "90d" ? 90 : 365;
	const buckets = range === "30d" ? 30 : range === "90d" ? 13 : 12;
	const since = new Date(Date.now() - days * DAY).toISOString();
	const accounts = ctx.target === "aggregate" ? ctx.accounts : [ctx.target];
	const rows = await readLedger(ctx, accounts.flatMap(walletIds), { since, limit: LEDGER_WINDOW });

	const projects = new Map<string, string>();
	const lines = await toLedgerLines(ctx, rows, projects);
	const byCategoryMinor = new Map<TxnCategory, number>();
	const byProjectMinor = new Map<string, number>();
	let totalIn = 0;
	let totalOut = 0;
	for (const line of lines) {
		const minor = line.amount.minor;
		byCategoryMinor.set(line.category, (byCategoryMinor.get(line.category) ?? 0) + minor);
		if (line.refId) byProjectMinor.set(line.refId, (byProjectMinor.get(line.refId) ?? 0) + minor);
		if (line.direction === "credit") totalIn += minor;
		else totalOut += minor;
	}
	const categorySum = [...byCategoryMinor.values()].reduce((a, b) => a + b, 0) || 1;
	const byCategory: CategorySlice[] = [...byCategoryMinor.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)
		.map(([category, minor]) => ({
			category,
			amount: ctx.money.derived(minor),
			shareBp: Math.round((minor / categorySum) * 10000),
		}));
	const byProject: ProjectFlow[] = [...byProjectMinor.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 24)
		.map(([id, minor]) => ({ id: clip(id, 64), name: clip(projects.get(id) ?? id, 120), amount: ctx.money.derived(minor) }));

	let lockedCapital: MoneyView | null = null;
	let burnDown: BudgetBurn | null = null;
	if (ctx.target !== "aggregate") {
		const account = ctx.target;
		const escrows = await escrowsFor(ctx, account);
		const seller = account.scope === "team" || (account.scope === "personal" && ctx.viewer.isFreelancer);
		if (seller) {
			// The same figure the Overview's meter shows, summed the same way (held currency, converted once).
			lockedCapital = sumOf(
				ctx.money,
				escrows.filter(isLive).map((e) => ({ minor: escrowValue(account, e), currency: e.currency })),
			);
		}
		if (account.scope === "business") burnDown = (await businessExtras(ctx, account, escrows)).burnDown;
	}
	return {
		range,
		flow: flowSeries(ctx, rows, days, buckets),
		byCategory,
		byProject,
		totalIn: ctx.money.derived(totalIn),
		totalOut: ctx.money.derived(totalOut),
		net: ctx.money.derived(totalIn - totalOut),
		lockedCapital,
		// Held escrow IS the income a seller has coming: what the stages already fund, net of the fee.
		projectedIncome: lockedCapital,
		burnDown,
	};
}
// #endregion

// #region Methods, funding, payouts
interface MethodRow {
	id: string;
	provider: string;
	brand: string | null;
	last4: string | null;
	label: string | null;
	method_role: "funding" | "payout" | "both";
	is_default_funding: boolean;
	is_default_payout: boolean;
	status: string;
}

async function methodsFor(ctx: WalletContext, account: WalletAccount): Promise<MethodRow[]> {
	const types = account.scope === "personal" ? ["user", "freelancer"] : [account.scope];
	const ownerId = account.scope === "personal" ? ctx.viewer.userId : account.id;
	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").from("payment_methods")
		.select("id, provider, brand, last4, label, method_role, is_default_funding, is_default_payout, status")
		.eq("owner_id", ownerId)
		.in("owner_type", types)
		.order("created_at", { ascending: true });
	if (error) throw new Error(`finance.payment_methods read failed: ${error.message}`);
	return (data ?? []) as MethodRow[];
}

function methodStatus(status: string): PaymentMethodView["status"] {
	return status === "expired" ? "expired" : status === "active" ? "active" : "inactive";
}

function methodLabel(m: MethodRow): string {
	return clip(m.label ?? [m.brand, m.last4 ? `·· ${m.last4}` : null].filter(Boolean).join(" ") ?? "Payment method", 120) ||
		"Payment method";
}

export async function methodsOf(ctx: WalletContext): Promise<MethodsView> {
	if (ctx.target === "aggregate") return { methods: [] };
	const rows = await methodsFor(ctx, ctx.target);
	return {
		methods: rows.map((m) => ({
			id: m.id,
			provider: clip(m.provider, 40),
			brand: m.brand ? clip(m.brand, 40) : null,
			last4: m.last4 ? m.last4.trim().slice(0, 4) : null,
			label: m.label ? clip(m.label, 120) : null,
			methodRole: m.method_role,
			isDefaultFunding: m.is_default_funding,
			isDefaultPayout: m.is_default_payout,
			status: methodStatus(m.status),
		})),
	};
}

export async function fundingOf(ctx: WalletContext): Promise<FundingView> {
	if (ctx.target === "aggregate") {
		return { sources: [], rules: [], balance: aggregateRef(ctx.money, ctx.accounts).available };
	}
	const account = ctx.target;
	const [methods, rulesRes] = await Promise.all([
		methodsFor(ctx, account),
		walletIds(account).length > 0
			? getUserClient(ctx.actor.accessToken).schema("finance").from("deposit_rules")
				.select("id, source_method_id, amount_cents, currency, interval, next_run_at, active, failure_count, last_error")
				.in("wallet_id", walletIds(account))
			: Promise.resolve({ data: [], error: null }),
	]);
	if (rulesRes.error) throw new Error(`finance.deposit_rules read failed: ${rulesRes.error.message}`);
	const sources = methods.filter((m) => m.method_role !== "payout").map((m) => ({
		id: m.id,
		label: methodLabel(m),
		brand: m.brand ? clip(m.brand, 40) : null,
		last4: m.last4 ? m.last4.trim().slice(0, 4) : null,
		role: m.method_role,
		isDefault: m.is_default_funding,
	}));
	const rules = ((rulesRes.data ?? []) as {
		id: string;
		source_method_id: string | null;
		amount_cents: number;
		currency: string;
		interval: "weekly" | "monthly";
		next_run_at: string | null;
		active: boolean;
		failure_count: number;
		last_error: string | null;
	}[]).map((r) => {
		const source = methods.find((m) => m.id === r.source_method_id);
		return {
			id: r.id,
			amount: money(ctx, Number(r.amount_cents) || 0, r.currency),
			interval: r.interval,
			sourceLabel: source ? methodLabel(source) : null,
			nextRunLabel: r.next_run_at ? clip(dateLabel(r.next_run_at), 60) : "Not scheduled",
			active: r.active,
			failureNote: r.failure_count > 0 && r.last_error ? clip(`Last run failed — ${r.last_error}`, 200) : null,
		};
	});
	return { sources, rules, balance: availableOf(ctx.money, account) };
}

export async function payoutsOf(ctx: WalletContext): Promise<PayoutsView> {
	if (ctx.target === "aggregate") {
		const personal = ctx.accounts.find((a) => a.scope === "personal") ?? ctx.accounts[0];
		return {
			schedule: { mode: "manual", destinationLabel: null, threshold: null, instant: false, nextRunLabel: null },
			destinations: [],
			incomeSmoother: null,
			instantAvailable: ctx.money.derived(0),
			instantFeeLabel: "Choose a wallet to see its payouts",
			history: [],
			verification: verificationFor(ctx, personal, "personal"),
		};
	}
	const account = ctx.target;
	const variant = walletVariant(account.scope);
	const db = getUserClient(ctx.actor.accessToken).schema("finance");
	const ownerTypes = account.scope === "personal" ? ["user", "freelancer"] : [account.scope];
	const ownerId = account.scope === "personal" ? ctx.viewer.userId : account.id;
	const scheduleCurrency = primaryCurrency(account) ?? ctx.money.display;
	const [methods, scheduleRes, historyRes, smootherRes, rows] = await Promise.all([
		methodsFor(ctx, account),
		// One schedule per owner per currency (`uq_payout_schedule_owner`): the wallet's own currency's.
		db.from("payout_schedules")
			.select("mode, destination_method_id, threshold_cents, currency, next_run_at, instant, active")
			.eq("owner_id", ownerId)
			.in("owner_type", ownerTypes)
			.eq("currency", scheduleCurrency)
			.limit(1)
			.maybeSingle(),
		walletIds(account).length > 0
			? db.from("payouts")
				.select("id, destination_method_id, amount_cents, currency, status, created_at, settled_at")
				.in("wallet_id", walletIds(account))
				.order("created_at", { ascending: false })
				.limit(24)
			: Promise.resolve({ data: [], error: null }),
		variant === "personal" && ctx.viewer.isFreelancer
			? db.from("income_smoothing")
				.select("enrolled, target_monthly_cents, currency, fee_bp, eligibility_met")
				.eq("user_id", ctx.viewer.userId)
				.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		variant === "personal" && ctx.viewer.isFreelancer
			? readLedger(ctx, walletIds(account), { limit: LEDGER_WINDOW })
			: Promise.resolve([] as TxnRow[]),
	]);
	if (scheduleRes.error) throw new Error(`finance.payout_schedules read failed: ${scheduleRes.error.message}`);
	if (historyRes.error) throw new Error(`finance.payouts read failed: ${historyRes.error.message}`);
	if (smootherRes.error) throw new Error(`finance.income_smoothing read failed: ${smootherRes.error.message}`);

	const destinations = methods.filter((m) => m.method_role !== "funding").map((m) => ({
		id: m.id,
		label: methodLabel(m),
		brand: m.brand ? clip(m.brand, 40) : null,
		last4: m.last4 ? m.last4.trim().slice(0, 4) : null,
		isDefault: m.is_default_payout,
	}));
	const schedule = scheduleRes.data as
		| {
			mode: PayoutsView["schedule"]["mode"];
			destination_method_id: string | null;
			threshold_cents: number | null;
			currency: string | null;
			next_run_at: string | null;
			instant: boolean;
			active: boolean;
		}
		| null;
	const destination = destinations.find((d) => d.id === schedule?.destination_method_id) ??
		destinations.find((d) => d.isDefault) ?? destinations[0];
	const walletCurrency = primaryCurrency(account) ?? ctx.money.display;
	const history = ((historyRes.data ?? []) as {
		id: string;
		destination_method_id: string | null;
		amount_cents: number;
		currency: string;
		status: "pending" | "paid" | "failed" | "cancelled";
		created_at: string;
	}[]).map((p) => ({
		id: p.id,
		amount: money(ctx, Number(p.amount_cents) || 0, p.currency),
		status: p.status === "cancelled" ? "failed" as const : p.status,
		destinationLabel: clip(destinations.find((d) => d.id === p.destination_method_id)?.label ?? "Bank account", 120),
		at: new Date(p.created_at).toISOString(),
		dateLabel: dateLabel(p.created_at),
	}));

	return {
		schedule: {
			mode: schedule?.mode ?? "manual",
			destinationLabel: destination?.label ?? null,
			threshold: schedule?.threshold_cents ? money(ctx, Number(schedule.threshold_cents), schedule.currency ?? walletCurrency) : null,
			instant: schedule?.instant ?? false,
			nextRunLabel: schedule && schedule.mode !== "manual" && schedule.next_run_at
				? clip(`Next run ${new Date(schedule.next_run_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`, 60)
				: null,
		},
		destinations,
		incomeSmoother: variant === "personal" && ctx.viewer.isFreelancer
			? smootherState(ctx, smootherRes.data as SmootherRow | null, rows)
			: null,
		instantAvailable: availableOf(ctx.money, account),
		// The Instant Payout fee magnitude is undecided platform-wide (finance-model §1.4) — never a figure.
		instantFeeLabel: "A small fee applies — shown before you confirm",
		history,
		verification: verificationFor(ctx, account, variant),
	};
}
// #endregion

// #region Invoices + access
export async function invoicesOf(ctx: WalletContext): Promise<InvoicesView> {
	if (ctx.target === "aggregate" || ctx.target.scope !== "business") {
		return { current: null, statements: [], bills: [], caps: [] };
	}
	const account = ctx.target;
	const db = getUserClient(ctx.actor.accessToken);
	const [billsRes, rows, caps] = await Promise.all([
		db.schema("finance").from("invoices")
			.select("id, project_stage_id, invoice_type, total_cents, currency, status, due_date, created_at")
			.eq("issue_to_business_id", account.id)
			.in("status", ["issued", "overdue"])
			.order("due_date", { ascending: true }),
		readLedger(ctx, walletIds(account), { since: new Date(Date.now() - 200 * DAY).toISOString(), limit: LEDGER_WINDOW }),
		spendingCaps(ctx, account),
	]);
	if (billsRes.error) throw new Error(`finance.invoices read failed: ${billsRes.error.message}`);
	const billRows = (billsRes.data ?? []) as {
		id: string;
		project_stage_id: string | null;
		invoice_type: string;
		total_cents: number;
		currency: string;
		status: string;
		due_date: string | null;
		created_at: string;
	}[];
	const stages = await stageFacts(ctx, billRows.map((b) => b.project_stage_id).filter((id): id is string => !!id));
	const now = Date.now();
	const bills: BillRow[] = billRows.map((b) => {
		const due = b.due_date ? Date.parse(b.due_date) : null;
		const overdue = b.status === "overdue" || (due !== null && due < now);
		const days = due === null ? null : Math.round((due - now) / DAY);
		const facts = b.project_stage_id ? stages.get(b.project_stage_id) : undefined;
		return {
			id: b.id,
			label: clip(facts ? `Stage invoice · ${facts.projectTitle}` : b.invoice_type === "consolidated_monthly" ? "Monthly statement" : "Invoice", 160),
			amount: money(ctx, Number(b.total_cents) || 0, b.currency),
			dueLabel: days === null
				? "No due date"
				: overdue
				? `Overdue ${Math.max(1, -days)} ${Math.abs(days) === 1 ? "day" : "days"}`
				: days === 0
				? "Due today"
				: `Due in ${days} ${days === 1 ? "day" : "days"}`,
			status: overdue ? "overdue" : "issued",
			overdue,
		} as BillRow;
	});

	// Statements are the wallet's own monthly totals, read from its ledger; the current month is still
	// accruing. No PDF is generated in this environment, so none is offered.
	const months = new Map<string, { inMinor: number; outMinor: number; fees: number }>();
	for (const r of rows) {
		const d = new Date(r.created_at);
		const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
		const bucket = months.get(key) ?? { inMinor: 0, outMinor: 0, fees: 0 };
		const minor = convert(ctx, r.amount_cents, r.currency);
		if (r.direction === "credit") bucket.inMinor += minor;
		else bucket.outMinor += minor;
		if (reasonMeta(r.reason, r.direction).category === "fee") bucket.fees += minor;
		months.set(key, bucket);
	}
	const thisMonth = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
	const periodLabel = (key: string) =>
		new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
	const toStatement = (key: string, b: { inMinor: number; outMinor: number; fees: number }, current: boolean): StatementRow => ({
		id: `statement-${account.id}-${key}`,
		periodLabel: current ? `${periodLabel(key)} · accruing` : periodLabel(key),
		totalIn: ctx.money.derived(b.inMinor),
		totalOut: ctx.money.derived(b.outMinor),
		totalFees: ctx.money.derived(b.fees),
		status: current ? "draft" : "final",
		hasPdf: false,
	});
	const current = months.get(thisMonth);
	return {
		current: toStatement(thisMonth, current ?? { inMinor: 0, outMinor: 0, fees: 0 }, true),
		statements: [...months.entries()]
			.filter(([key]) => key !== thisMonth)
			.sort((a, b) => b[0].localeCompare(a[0]))
			.slice(0, 12)
			.map(([key, b]) => toStatement(key, b, false)),
		bills,
		caps,
	};
}

export async function accessOf(ctx: WalletContext): Promise<AccessView> {
	if (ctx.target === "aggregate" || ctx.target.scope === "personal") {
		return { members: [], caps: [], approvals: [], audit: [], viewerCapabilities: ["view"] };
	}
	const account = ctx.target;
	const ids = walletIds(account);
	if (ids.length === 0) {
		return { members: [], caps: [], approvals: [], audit: [], viewerCapabilities: account.capabilities };
	}
	const db = getUserClient(ctx.actor.accessToken).schema("finance");
	const [permsRes, approvalsRes, auditRes, caps] = await Promise.all([
		db.from("vault_permissions").select("member_user_id, capabilities").in("wallet_id", ids),
		db.from("spend_approvals")
			.select("id, requested_by, amount_cents, currency, reason, status, created_at")
			.in("wallet_id", ids)
			.order("created_at", { ascending: false })
			.limit(40),
		db.from("ledger_audit")
			.select("id, actor_user_id, action, amount_cents, currency, metadata, created_at")
			.in("wallet_id", ids)
			.order("created_at", { ascending: false })
			.limit(60),
		spendingCaps(ctx, account),
	]);
	if (permsRes.error) throw new Error(`finance.vault_permissions read failed: ${permsRes.error.message}`);
	if (approvalsRes.error) throw new Error(`finance.spend_approvals read failed: ${approvalsRes.error.message}`);
	if (auditRes.error) throw new Error(`finance.ledger_audit read failed: ${auditRes.error.message}`);

	const perms = new Map<string, VaultCapability[]>();
	for (const p of (permsRes.data ?? []) as { member_user_id: string; capabilities: string[] | null }[]) {
		const caps = p.capabilities ?? [];
		const all: VaultCapability[] = ["view", "add_funds", "spend", "distribute", "withdraw", "manage_members", "manage_billing"];
		perms.set(p.member_user_id, caps.includes("manage_members") ? all : all.filter((c) => caps.includes(c)));
	}
	const approvals = (approvalsRes.data ?? []) as {
		id: string;
		requested_by: string;
		amount_cents: number;
		currency: string;
		reason: string;
		status: SpendApprovalView["status"];
		created_at: string;
	}[];
	const audit = (auditRes.data ?? []) as {
		id: string;
		actor_user_id: string | null;
		action: AuditRow["action"];
		amount_cents: number;
		currency: string;
		metadata: Record<string, unknown> | null;
		created_at: string;
	}[];
	const faces = await peopleFaces(ctx, [
		...perms.keys(),
		...approvals.map((a) => a.requested_by),
		...audit.map((a) => a.actor_user_id).filter((id): id is string => !!id),
	]);

	const members: VaultMember[] = [...perms.entries()].map(([userId, caps]) => {
		const face = faces.get(userId);
		return {
			userId,
			handle: face?.handle ? clip(face.handle, 40) : null,
			name: clip(face?.name ?? "Member", 120),
			avatar: face?.avatar ?? null,
			role: caps.includes("manage_billing") ? "owner" : caps.includes("manage_members") ? "admin" : caps.includes("spend") ? "pm" : "member",
			capabilities: caps,
		};
	});
	const now = Date.now();
	return {
		members,
		caps,
		approvals: approvals.map((a) => {
			const face = faces.get(a.requested_by);
			return {
				id: a.id,
				requesterName: clip(face?.name ?? "Member", 120),
				requesterHandle: face?.handle ? clip(face.handle, 40) : null,
				amount: money(ctx, Number(a.amount_cents) || 0, a.currency),
				reason: clip(a.reason, 400),
				status: a.status,
				at: new Date(a.created_at).toISOString(),
				dateLabel: dateLabel(a.created_at, now),
			};
		}),
		audit: audit.map((a) => {
			const face = a.actor_user_id ? faces.get(a.actor_user_id) : undefined;
			const kind = typeof a.metadata?.kind === "string" ? a.metadata.kind.replace(/_/g, " ") : a.action.replace(/_/g, " ");
			return {
				id: a.id,
				actorName: clip(face?.name ?? "A member", 120),
				actorHandle: face?.handle ? clip(face.handle, 40) : null,
				action: a.action,
				amount: money(ctx, Number(a.amount_cents) || 0, a.currency),
				label: clip(`${face?.name ?? "A member"} · ${kind}`, 200),
				at: new Date(a.created_at).toISOString(),
				dateLabel: dateLabel(a.created_at, now),
			};
		}),
		viewerCapabilities: account.capabilities,
	};
}
// #endregion
