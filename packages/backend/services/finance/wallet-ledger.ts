import type {
	FlowGrain,
	FlowPoint,
	FundState,
	LedgerInstrument,
	LedgerKeyset,
	LedgerKind,
	LedgerLine,
	LedgerPartyKind,
	LedgerSettlement,
	LedgerSubject,
	TransactionListParams,
	TransactionPage,
	TxnCategory,
} from "@projective/types/finance";
import {
	CardBrand,
	decodeLedgerCursor,
	encodeLedgerCursor,
	LEDGER_KIND_REASONS,
	LedgerKind as LedgerKindEnum,
	ledgerKindOf,
} from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import type { WalletAccount, WalletContext } from "./wallet-scope.ts";

/**
 * wallet-ledger — the wallet's movements as the surface shows them: every `finance.transactions` line
 * of the wallets in view, labelled, linked back to the work that produced it, and grouped for the
 * charts.
 *
 * A ledger line only knows its `reason` and a `(ref_table, ref_id)` pointer. The label, the record it
 * paid for, the person on the other side, the card that paid and where the money stands now are
 * resolved here by reading the referenced rows WITH THE VIEWER'S TOKEN — so a line never names more
 * than its reader may see. A freelancer sees the client business's public face on an escrow release; a
 * buyer sees their own order's reference and the card it went on; a seller sees "Service sale" and not
 * who bought it, because the buyer's order is not theirs to read.
 *
 * **Pages are keyset pages** (`finance.list_ledger`): the next page is every matching line strictly
 * older than the last one read, filtered in the database — direction, line family, date range and a
 * search over what the viewer may read. The cash-flow series is summed in the database too
 * (`finance.ledger_flow`), per calendar bucket in the viewer's own time zone.
 */

// #region Reference
const DAY = 86_400_000;
/** How many of the most recent lines a bounded read (the overview, the export) works over. */
export const LEDGER_WINDOW = 1000;
/** The most ids one `in.(…)` filter carries, so a long page never builds an over-long request line. */
const IN_CHUNK = 100;

/** A `finance.transactions` row. */
export interface TxnRow {
	id: string;
	wallet_id: string;
	direction: "credit" | "debit";
	amount_cents: number;
	currency: string;
	reason: string;
	ref_table: string | null;
	ref_id: string | null;
	fund_state: FundState | null;
	created_at: string;
}

interface ReasonMeta {
	category: TxnCategory;
	label: string;
	refKind: LedgerLine["refKind"];
}

/** What a ledger `reason` means to a reader. An unknown reason is labelled from its own code. */
export function reasonMeta(reason: string, direction: "credit" | "debit"): ReasonMeta {
	switch (reason) {
		case "escrow_hold":
			return { category: "escrow", label: "Escrow funded", refKind: "stage" };
		case "escrow_release":
			return { category: "earning", label: "Escrow release", refKind: "stage" };
		case "escrow_release_vault_retention":
			return { category: "earning", label: "Vault share of a release", refKind: "stage" };
		case "escrow_refund":
			return { category: "refund", label: "Escrow refund", refKind: "stage" };
		case "team_split":
			return { category: "earning", label: "Team split", refKind: "stage" };
		case "team_distribution":
			return direction === "credit"
				? { category: "earning", label: "Team distribution", refKind: "transfer" }
				: { category: "transfer", label: "Distributed to members", refKind: "transfer" };
		case "product_sale":
			return { category: "earning", label: "Product sale", refKind: null };
		case "product_sale_vault_retention":
			return { category: "earning", label: "Vault share of a product sale", refKind: null };
		case "service_sale":
			return { category: "earning", label: "Service sale", refKind: null };
		case "service_sale_vault_retention":
			return { category: "earning", label: "Vault share of a service sale", refKind: null };
		case "order_payment":
			return { category: "spend", label: "Order payment", refKind: null };
		case "topup":
			return { category: "deposit", label: "Wallet top-up", refKind: "deposit" };
		case "demo_opening_credit":
			return { category: "deposit", label: "Opening balance", refKind: "deposit" };
		case "payout":
			return { category: "payout", label: "Payout to bank", refKind: "payout" };
		case "payout_reversal":
			return { category: "refund", label: "Payout returned", refKind: "payout" };
		case "chargeback":
			return { category: "refund", label: "Card dispute clawback", refKind: null };
		case "fair_exit_release":
			return { category: "earning", label: "Fair-exit release", refKind: "stage" };
		case "fair_exit_release_vault_retention":
			return { category: "earning", label: "Vault share of a fair-exit release", refKind: "stage" };
		case "fair_exit_refund":
			return { category: "refund", label: "Fair-exit refund", refKind: "stage" };
		case "team_finder_fee":
			return { category: "earning", label: "Finder's fee", refKind: "stage" };
		case "instant_payout_fee":
			return { category: "fee", label: "Instant payout fee", refKind: "fee" };
		case "platform_fee":
			return { category: "fee", label: "Platform fee", refKind: "fee" };
		case "refund":
			return direction === "credit"
				? { category: "refund", label: "Refund", refKind: null }
				: { category: "refund", label: "Refund issued", refKind: null };
		case "transfer_in":
			return { category: "transfer", label: "Transfer in", refKind: "transfer" };
		case "transfer_out":
			return { category: "transfer", label: "Transfer out", refKind: "transfer" };
		default: {
			const words = reason.replace(/_/g, " ").trim();
			return {
				category: direction === "credit" ? "deposit" : "spend",
				label: words ? words[0].toUpperCase() + words.slice(1) : "Movement",
				refKind: null,
			};
		}
	}
}

/**
 * An IANA zone the platform can bucket and label in, or `null` when the name is not one. Postgres and
 * `Intl` read the same tz database, so a name `Intl` accepts is one `AT TIME ZONE` accepts.
 */
export function safeTimeZone(raw: string | null | undefined): string | null {
	const name = raw?.trim();
	if (!name || name.length > 64) return null;
	try {
		return new Intl.DateTimeFormat("en-GB", { timeZone: name }).resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

/** The calendar date (`YYYY-MM-DD`) an instant falls on in a time zone. */
export function localDay(ms: number, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(ms);
}

/** How far a time zone's wall clock runs ahead of UTC at an instant, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(ms);
	const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	return Date.UTC(at("year"), at("month") - 1, at("day"), at("hour"), at("minute"), at("second")) -
		Math.floor(ms / 1000) * 1000;
}

/** The instant a calendar day (`YYYY-MM-DD`) begins in a time zone, across a DST change too. */
export function zonedMidnight(day: string, timeZone: string): string {
	const wall = Date.parse(`${day}T00:00:00Z`);
	let at = wall - zoneOffset(wall, timeZone);
	const corrected = wall - zoneOffset(at, timeZone);
	if (corrected !== at) at = corrected;
	return new Date(at).toISOString();
}

/**
 * Where the ruler's window starts for the ledger, on the viewer's calendar: "the last 7 days" is today
 * and the six days before it, "the last 12 months" this month and the eleven before it. `null` for
 * all time.
 */
export function rangeStart(
	range: string | null | undefined,
	now: number,
	timeZone: string,
): string | null {
	const today = localDay(now, timeZone);
	const back = (days: number) => addGrain(today, "day", -(days - 1));
	const months = (n: number) => addGrain(truncateDay(today, "month"), "month", -(n - 1));
	const first = range === "7d"
		? back(7)
		: range === "30d"
		? back(30)
		: range === "90d"
		? back(90)
		: range === "180d"
		? back(180)
		: range === "12m"
		? months(12)
		: range === "5y"
		? months(60)
		: null;
	return first ? zonedMidnight(first, timeZone) : null;
}

/** Whole calendar days from `a` to `b` (`YYYY-MM-DD`). */
function dayDiff(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/**
 * `Today` / `Yesterday` / `3 days ago` / `12 Sept` — or `12 Sept 2025` outside the current year — on the
 * viewer's calendar, so a line written at 00:30 local time is "Today" even while UTC still says otherwise.
 */
export function dateLabel(iso: string, now = Date.now(), timeZone = "UTC"): string {
	const ms = Date.parse(iso);
	const today = localDay(now, timeZone);
	const day = localDay(ms, timeZone);
	const diff = dayDiff(day, today);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	if (diff < 7) return `${diff} days ago`;
	const sameYear = day.slice(0, 4) === today.slice(0, 4);
	return new Date(ms).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
		timeZone,
	});
}

/**
 * The heading a line is filed under in the ledger: `Today`, `Yesterday`, else the month it fell in
 * ("September 2026"), on the viewer's calendar.
 */
export function ledgerGroup(iso: string, now = Date.now(), timeZone = "UTC"): string {
	const ms = Date.parse(iso);
	const diff = dayDiff(localDay(ms, timeZone), localDay(now, timeZone));
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	return new Date(ms).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone });
}

function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** A card brand as `finance.card_brand` names it; a free-text brand Stripe never sends is `unknown`. */
export function cardBrandOf(raw: string | null | undefined): CardBrand {
	const key = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
	const parsed = CardBrand.safeParse(
		key === "american_express" ? "amex" : key === "master_card" ? "mastercard" : key,
	);
	return parsed.success ? parsed.data : "unknown";
}

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** Every distinct non-empty id among `values`. */
function idsOf(values: readonly (string | null | undefined)[]): string[] {
	return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}
// #endregion

// #region Reading
interface ReadOptions {
	direction?: "credit" | "debit";
	fundState?: FundState;
	from?: string;
	to?: string;
	since?: string;
	limit: number;
}

/** The most recent lines of a set of wallets, newest first, narrowed in the database where it can. */
export async function readLedger(
	ctx: WalletContext,
	walletIds: readonly string[],
	options: ReadOptions,
): Promise<TxnRow[]> {
	if (walletIds.length === 0) return [];
	let q = getUserClient(ctx.actor.accessToken).schema("finance").from("transactions")
		.select(
			"id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, fund_state, created_at",
		)
		.in("wallet_id", [...walletIds]);
	if (options.direction) q = q.eq("direction", options.direction);
	if (options.fundState) q = q.eq("fund_state", options.fundState);
	const from = options.since ?? options.from;
	if (from && Number.isFinite(Date.parse(from))) {
		q = q.gte("created_at", new Date(from).toISOString());
	}
	if (options.to && Number.isFinite(Date.parse(options.to))) {
		q = q.lte("created_at", new Date(options.to).toISOString());
	}
	const { data, error } = await q.order("created_at", { ascending: false }).order("id", {
		ascending: false,
	})
		.limit(options.limit);
	if (error) throw new Error(`finance.transactions read failed: ${error.message}`);
	return normaliseRows(data);
}

function normaliseRows(data: unknown): TxnRow[] {
	return ((data ?? []) as TxnRow[]).map((row) => ({
		...row,
		amount_cents: Number(row.amount_cents) || 0,
		created_at: new Date(row.created_at).toISOString(),
	}));
}

/** One keyset page's filters, already resolved to what `finance.list_ledger` takes. */
export interface LedgerFilter {
	direction?: "credit" | "debit" | null;
	/** Reason codes to include (the line-family selector); `null` for every reason. */
	reasons?: readonly string[] | null;
	from?: string | null;
	to?: string | null;
	search?: string | null;
	/** Reason codes whose LABELS match the search words. */
	searchReasons?: readonly string[];
	/** The viewer's own wallets whose owner name matches the search words (transfers between them). */
	searchWallets?: readonly string[];
	/** The last line of the previous page; `null` for the first page. */
	after?: LedgerKeyset | null;
}

function isoOrNull(value: string | null | undefined): string | null {
	return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** One keyset page of a set of wallets' ledger through `finance.list_ledger` (`limit` rows at most). */
export async function listLedger(
	ctx: WalletContext,
	walletIds: readonly string[],
	filter: LedgerFilter,
	limit: number,
): Promise<TxnRow[]> {
	if (walletIds.length === 0) return [];
	const search = filter.search?.trim() || null;
	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc(
		"list_ledger",
		{
			p_wallet_ids: [...walletIds],
			p_limit: Math.min(201, Math.max(1, limit)),
			p_after_at: filter.after?.at ?? null,
			p_after_id: filter.after?.id ?? null,
			p_direction: filter.direction ?? null,
			p_reasons: filter.reasons ? [...filter.reasons] : null,
			p_from: isoOrNull(filter.from),
			p_to: isoOrNull(filter.to),
			p_search: search,
			p_search_reasons: search ? [...(filter.searchReasons ?? [])] : null,
			p_search_wallets: search ? [...(filter.searchWallets ?? [])] : null,
		},
	);
	if (error) throw new Error(`finance.list_ledger failed: ${error.message}`);
	return normaliseRows(data);
}

/** Every reason code a family label or a line label can name. */
const KNOWN_REASONS: readonly string[] = [...new Set(Object.values(LEDGER_KIND_REASONS).flat())];

/**
 * The reason codes whose labels contain the search words ("release" → the release codes), in either
 * direction's wording — the half of a search the database cannot answer, because a label is copy.
 */
export function reasonsMatching(needle: string): string[] {
	const words = needle.trim().toLowerCase();
	if (!words) return [];
	return KNOWN_REASONS.filter((reason) =>
		reasonMeta(reason, "credit").label.toLowerCase().includes(words) ||
		reasonMeta(reason, "debit").label.toLowerCase().includes(words)
	);
}

/** The viewer's own wallet rows whose owner's name contains the search words. */
export function walletsMatching(accounts: readonly WalletAccount[], needle: string): string[] {
	const words = needle.trim().toLowerCase();
	if (!words) return [];
	return accounts
		.filter((a) => a.owner.name.toLowerCase().includes(words))
		.flatMap((a) => a.rows.map((row) => row.id));
}

/** The reason codes a set of line families stands for; `null` when the set is empty (every family). */
export function reasonsForKinds(kinds: readonly LedgerKind[] | null | undefined): string[] | null {
	const wanted = (kinds ?? []).filter((k) => k !== "other");
	if (wanted.length === 0) return null;
	return [...new Set(wanted.flatMap((k) => LEDGER_KIND_REASONS[k]))];
}
// #endregion

// #region Enrichment
/** The other party on a line, as the viewer may see them. */
interface Party {
	kind: LedgerPartyKind;
	name: string;
	handle: string | null;
	avatar: string | null;
}

interface EscrowRow {
	id: string;
	project_stage_id: string;
	payer_business_id: string | null;
	payer_user_id: string | null;
	payee_type: string;
	payee_id: string;
	status: string;
}

interface EscrowFacts {
	stage: StageFacts | null;
	party: Party | null;
	status: string;
	disputed: boolean;
	/** The newest issued invoice for the escrow's stage the viewer may read. */
	invoiceId: string | null;
}

interface OrderFacts {
	reference: string;
	instrument: LedgerInstrument | null;
}

interface OrderLineFacts {
	title: string;
	itemType: string;
	orderId: string;
}

interface InboundFacts {
	recurring: boolean;
	instrument: LedgerInstrument | null;
	stage: StageFacts | null;
}

/** Every fact a page of lines needs, resolved in batches with the viewer's token. */
interface RefFacts {
	escrows: Map<string, EscrowFacts>;
	/** `escrow_id:wallet_id` pairs still inside their 7-day window. */
	clearing: Set<string>;
	orders: Map<string, OrderFacts>;
	orderLines: Map<string, OrderLineFacts>;
	inbound: Map<string, InboundFacts>;
	methods: Map<string, LedgerInstrument>;
	distributions: Map<string, string>;
	/** Line ids an open card dispute reverses. */
	contested: Set<string>;
}

type Db = ReturnType<typeof getUserClient>;

/** Reads a table by id in chunks, tolerating (and logging) a failure: an enrichment is never fatal. */
async function readByIds<T>(
	label: string,
	ids: readonly string[],
	run: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
	if (ids.length === 0) return [];
	const out: T[] = [];
	for (const chunk of chunks(ids)) {
		const { data, error } = await run(chunk);
		if (error) {
			console.error(`[wallet:ledger] ${label} read failed:`, error.message);
			continue;
		}
		out.push(...((data ?? []) as T[]));
	}
	return out;
}

function instrumentOf(
	brand: string | null | undefined,
	last4: string | null | undefined,
): LedgerInstrument | null {
	if (!brand && !last4) return null;
	const digits = last4?.trim() ?? "";
	return { brand: cardBrandOf(brand), last4: /^\d{4}$/.test(digits) ? digits : null };
}

async function resolveRefs(ctx: WalletContext, rows: readonly TxnRow[]): Promise<RefFacts> {
	const db = getUserClient(ctx.actor.accessToken);
	const refIds = (table: string) =>
		idsOf(rows.filter((r) => r.ref_table === table).map((r) => r.ref_id));

	// Phase 1 — the rows the lines point at.
	const [escrowRows, lineRows, inboundRows, methodRows, auditRows, chargebackRows] = await Promise
		.all([
			readByIds<EscrowRow>(
				"escrows",
				refIds("escrows"),
				(ids) =>
					db.schema("finance").from("escrows")
						.select(
							"id, project_stage_id, payer_business_id, payer_user_id, payee_type, payee_id, status",
						)
						.in("id", ids),
			),
			readByIds<{ id: string; order_id: string; title: string; item_type: string }>(
				"order_lines",
				refIds("order_lines"),
				(ids) =>
					db.schema("finance").from("order_lines").select("id, order_id, title, item_type").in(
						"id",
						ids,
					),
			),
			readByIds<{ id: string; deposit_rule_id: string | null; project_stage_id: string | null }>(
				"inbound_payments",
				refIds("inbound_payments"),
				(ids) =>
					db.schema("finance").from("inbound_payments").select(
						"id, deposit_rule_id, project_stage_id",
					).in("id", ids),
			),
			readByIds<{ id: string; brand: string | null; last4: string | null }>(
				"payment_methods",
				refIds("payment_methods"),
				(ids) =>
					db.schema("finance").from("payment_methods").select("id, brand, last4").in("id", ids),
			),
			// A distribution's credit points at a correlation id; the vault it came from is on the audit row,
			// which a member of that vault may read.
			readByIds<{ ref_id: string; wallet_id: string }>(
				"ledger_audit",
				refIds("team_distribution"),
				(ids) =>
					db.schema("finance").from("ledger_audit").select("ref_id, wallet_id")
						.eq("ref_table", "team_distribution").in("ref_id", ids),
			),
			readByIds<{ transaction_id: string }>(
				"chargebacks",
				idsOf(rows.map((r) => r.id)),
				(ids) =>
					db.schema("finance").from("chargebacks").select("transaction_id")
						.in("transaction_id", ids).in("status", ["opened", "under_review"]),
			),
		]);

	// Phase 2 — what those rows point at in turn.
	const escrowIds = escrowRows.map((e) => e.id);
	const orderIds = idsOf([...refIds("orders"), ...lineRows.map((l) => l.order_id)]);
	const stageIds = idsOf([
		...escrowRows.map((e) => e.project_stage_id),
		...inboundRows.map((p) => p.project_stage_id),
	]);
	const [stages, faces, disputeRows, pendingRows, orderRows, ruleRows] = await Promise.all([
		stageFacts(ctx, stageIds).catch((error) => {
			console.error(
				"[wallet:ledger] stage facts failed:",
				error instanceof Error ? error.message : error,
			);
			return new Map<string, StageFacts>();
		}),
		counterpartyFaces(ctx, escrowRows),
		readByIds<{ escrow_id: string }>(
			"disputes",
			escrowIds,
			(ids) =>
				db.schema("finance").from("disputes").select("escrow_id")
					.in("escrow_id", ids).in("status", ["open", "under_review"]),
		),
		readByIds<{ escrow_id: string; wallet_id: string }>(
			"pending_releases",
			escrowIds,
			(ids) =>
				db.schema("finance").from("pending_releases").select("escrow_id, wallet_id")
					.in("escrow_id", ids).eq("state", "pending"),
		),
		readByIds<{ id: string; reference: string; saved_card_id: string | null }>(
			"orders",
			orderIds,
			(ids) =>
				db.schema("finance").from("orders").select("id, reference, saved_card_id").in("id", ids),
		),
		readByIds<{ id: string; source_method_id: string | null }>(
			"deposit_rules",
			idsOf(inboundRows.map((p) => p.deposit_rule_id)),
			(ids) =>
				db.schema("finance").from("deposit_rules").select("id, source_method_id").in("id", ids),
		),
	]);

	// Phase 3 — the documents and instruments at the end of the chain.
	const [invoiceRows, cardRows, sourceRows] = await Promise.all([
		readByIds<{ id: string; project_stage_id: string | null; created_at: string }>(
			"invoices",
			idsOf(escrowRows.map((e) => e.project_stage_id)),
			(ids) =>
				db.schema("finance").from("invoices").select("id, project_stage_id, created_at")
					.in("project_stage_id", ids).in("status", ["issued", "paid", "overdue"])
					.order("created_at", { ascending: false }),
		),
		readByIds<{ id: string; brand: string | null; last4: string | null }>(
			"saved_cards",
			idsOf(orderRows.map((o) => o.saved_card_id)),
			(ids) => db.schema("finance").from("saved_cards").select("id, brand, last4").in("id", ids),
		),
		readByIds<{ id: string; brand: string | null; last4: string | null }>(
			"payment_methods",
			idsOf(ruleRows.map((r) => r.source_method_id)),
			(ids) =>
				db.schema("finance").from("payment_methods").select("id, brand, last4").in("id", ids),
		),
	]);

	const disputed = new Set(disputeRows.map((d) => d.escrow_id));
	const invoiceByStage = new Map<string, string>();
	for (const inv of invoiceRows) {
		if (inv.project_stage_id && !invoiceByStage.has(inv.project_stage_id)) {
			invoiceByStage.set(inv.project_stage_id, inv.id);
		}
	}
	const escrows = new Map<string, EscrowFacts>();
	for (const e of escrowRows) {
		const viewerIsPayer = e.payer_user_id === ctx.viewer.userId ||
			ctx.accounts.some((a) => a.scope === "business" && a.id === e.payer_business_id);
		const party = viewerIsPayer
			? faces.get(`${e.payee_type}:${e.payee_id}`)
			: e.payer_business_id
			? faces.get(`business:${e.payer_business_id}`)
			: faces.get(`freelancer:${e.payer_user_id}`);
		escrows.set(e.id, {
			stage: stages.get(e.project_stage_id) ?? null,
			party: party ?? null,
			status: e.status,
			disputed: e.status === "disputed" || disputed.has(e.id),
			invoiceId: invoiceByStage.get(e.project_stage_id) ?? null,
		});
	}

	const cards = new Map(cardRows.map((c) => [c.id, instrumentOf(c.brand, c.last4)]));
	const orders = new Map<string, OrderFacts>();
	for (const o of orderRows) {
		orders.set(o.id, {
			reference: o.reference,
			instrument: o.saved_card_id ? cards.get(o.saved_card_id) ?? null : null,
		});
	}

	const orderLines = new Map<string, OrderLineFacts>();
	for (const l of lineRows) {
		orderLines.set(l.id, { title: l.title, itemType: l.item_type, orderId: l.order_id });
	}

	const sources = new Map(sourceRows.map((m) => [m.id, instrumentOf(m.brand, m.last4)]));
	const rules = new Map(ruleRows.map((r) => [r.id, r.source_method_id]));
	const inbound = new Map<string, InboundFacts>();
	for (const p of inboundRows) {
		const source = p.deposit_rule_id ? rules.get(p.deposit_rule_id) ?? null : null;
		inbound.set(p.id, {
			recurring: p.deposit_rule_id !== null,
			instrument: source ? sources.get(source) ?? null : null,
			stage: p.project_stage_id ? stages.get(p.project_stage_id) ?? null : null,
		});
	}

	const methods = new Map<string, LedgerInstrument>();
	for (const m of methodRows) {
		const instrument = instrumentOf(m.brand, m.last4);
		if (instrument) methods.set(m.id, instrument);
	}

	const distributions = new Map<string, string>();
	for (const a of auditRows) {
		const account = accountOfWallet(ctx.accounts, a.wallet_id);
		if (account) distributions.set(a.ref_id, account.owner.name);
	}

	return {
		escrows,
		clearing: new Set(pendingRows.map((p) => `${p.escrow_id}:${p.wallet_id}`)),
		orders,
		orderLines,
		inbound,
		methods,
		distributions,
		contested: new Set(chargebackRows.map((c) => c.transaction_id)),
	};
}

/** What a stage id resolves to for a reader: its project, its address and, when it has one, its due date. */
export interface StageFacts {
	projectId: string;
	projectSlug: string;
	projectTitle: string;
	stageSlug: string | null;
	stageName: string;
	/** The stage's fixed delivery deadline (`file_due_date`), when the owner set one. */
	dueAt: string | null;
}

/** The address of a stage (or of its project, for a stage with no slug). */
export function stageHref(facts: StageFacts): string {
	return facts.stageSlug
		? `/projects/${facts.projectSlug}/${facts.stageSlug}`
		: `/projects/${facts.projectSlug}`;
}

/**
 * Stage and project facts for a set of stage ids, read with the viewer's token — a stage on a project
 * the viewer cannot see is simply absent.
 */
export async function stageFacts(
	ctx: WalletContext,
	stageIds: readonly string[],
): Promise<Map<string, StageFacts>> {
	const out = new Map<string, StageFacts>();
	const ids = idsOf(stageIds);
	if (ids.length === 0) return out;
	const db = getUserClient(ctx.actor.accessToken);
	const stageRows: {
		id: string;
		slug: string | null;
		name: string;
		project_id: string;
		file_due_date: string | null;
	}[] = [];
	for (const chunk of chunks(ids)) {
		const st = await db.schema("projects").from("project_stages")
			.select("id, slug, name, project_id, file_due_date").in("id", chunk);
		if (st.error) throw new Error(`projects.project_stages read failed: ${st.error.message}`);
		stageRows.push(...(st.data ?? []) as typeof stageRows);
	}
	const projectIds = idsOf(stageRows.map((s) => s.project_id));
	const projects = new Map<string, { slug: string; title: string }>();
	for (const chunk of chunks(projectIds)) {
		const pr = await db.schema("projects").from("projects").select("id, slug, title").in(
			"id",
			chunk,
		);
		if (pr.error) throw new Error(`projects.projects read failed: ${pr.error.message}`);
		for (const p of (pr.data ?? []) as { id: string; slug: string; title: string }[]) {
			projects.set(p.id, { slug: p.slug, title: p.title });
		}
	}
	for (const s of stageRows) {
		const project = projects.get(s.project_id);
		if (!project) continue;
		out.set(s.id, {
			projectId: s.project_id,
			projectSlug: project.slug,
			projectTitle: project.title,
			stageSlug: s.slug,
			stageName: s.name,
			dueAt: s.file_due_date ? new Date(s.file_due_date).toISOString() : null,
		});
	}
	return out;
}

/** Names, handles, kinds and pictures of the other party on escrow lines: payees for a payer, the payer for a payee. */
async function counterpartyFaces(
	ctx: WalletContext,
	escrows: readonly EscrowRow[],
): Promise<Map<string, Party>> {
	const db = getUserClient(ctx.actor.accessToken);
	const faces = new Map<string, Party>();
	const userIds = idsOf([
		...escrows.filter((e) => e.payee_type === "freelancer").map((e) => e.payee_id),
		...escrows.map((e) => e.payer_user_id),
	]);
	const teamIds = idsOf(escrows.filter((e) => e.payee_type === "team").map((e) => e.payee_id));
	const businessIds = idsOf(escrows.map((e) => e.payer_business_id));

	const [people, teams] = await Promise.all([
		readByIds<{
			user_id: string;
			username: string;
			first_name: string | null;
			last_name: string | null;
			avatar_file_id: string | null;
		}>("users_public", userIds, (ids) =>
			db.schema("org").from("users_public")
				.select("user_id, username, first_name, last_name, avatar_file_id").in("user_id", ids)),
		readByIds<{ id: string; name: string; slug: string; avatar_file_id: string | null }>(
			"teams",
			teamIds,
			(ids) =>
				db.schema("org").from("teams").select("id, name, slug, avatar_file_id").in("id", ids),
		),
	]);
	const media = await fetchPublicMedia(db, [
		...people.map((u) => u.avatar_file_id),
		...teams.map((t) => t.avatar_file_id),
	])
		.catch(() => new Map());
	for (const u of people) {
		const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username;
		faces.set(`freelancer:${u.user_id}`, {
			kind: "user",
			name,
			handle: u.username,
			avatar: u.avatar_file_id ? mediaUrl(media.get(u.avatar_file_id), "sm") : null,
		});
	}
	for (const t of teams) {
		faces.set(`team:${t.id}`, {
			kind: "team",
			name: t.name,
			handle: t.slug,
			avatar: t.avatar_file_id ? mediaUrl(media.get(t.avatar_file_id), "sm") : null,
		});
	}
	// A business's public face through the purchase-owner door — `business_profiles` has no client
	// read policy, and the door answers the public face (name, handle, picture) to anyone signed in.
	await Promise.all(businessIds.map(async (id) => {
		const own = ctx.accounts.find((a) => a.scope === "business" && a.id === id);
		if (own) {
			faces.set(`business:${id}`, {
				kind: "business",
				name: own.owner.name,
				handle: own.owner.handle,
				avatar: own.owner.avatar,
			});
			return;
		}
		const { data } = await db.schema("finance").rpc("get_purchase_owner", {
			p_owner_type: "business",
			p_owner_id: id,
		});
		const face = data as {
			name: string | null;
			handle: string | null;
			avatar_bucket?: string | null;
			avatar_path?: string | null;
		} | null;
		if (face?.name) {
			faces.set(`business:${id}`, {
				kind: "business",
				name: face.name,
				handle: face.handle,
				avatar: publicObjectUrl(face.avatar_bucket, face.avatar_path),
			});
		}
	}));
	return faces;
}

/** The viewer's account that owns a wallet row. */
export function accountOfWallet(
	accounts: readonly WalletAccount[],
	walletId: string,
): WalletAccount | undefined {
	return accounts.find((a) => a.rows.some((row) => row.id === walletId));
}

/** The kind of party a wallet account is, as a ledger counterparty. */
function partyKindOf(account: WalletAccount): LedgerPartyKind {
	if (account.scope === "team") return "team";
	if (account.scope === "business" || account.scope === "organisation") return "business";
	return "user";
}

/**
 * Where a line's money stands now. An escrow line follows its escrow (held → pending, disputed →
 * disputed, settled → cleared) and a release still inside its window is pending; anything an open card
 * dispute reverses is disputed; otherwise the line's stored fund state decides.
 */
export function settlementOf(
	row: Pick<TxnRow, "id" | "wallet_id" | "fund_state" | "ref_table" | "ref_id">,
	facts: Pick<RefFacts, "escrows" | "clearing" | "contested">,
): LedgerSettlement {
	if (facts.contested.has(row.id) || row.fund_state === "on_hold") return "disputed";
	if (row.ref_table === "escrows" && row.ref_id) {
		const escrow = facts.escrows.get(row.ref_id);
		if (escrow?.disputed) return "disputed";
		if (facts.clearing.has(`${row.ref_id}:${row.wallet_id}`)) return "pending";
		if (escrow && (escrow.status === "held" || escrow.status === "funded")) return "pending";
		if (escrow) return "cleared";
	}
	return row.fund_state === "pending" || row.fund_state === "locked" ? "pending" : "cleared";
}

/**
 * Project raw lines into what the surface shows, in the display currency and on the viewer's calendar.
 * When `projectsOut` is given it collects every project a line paid for (`slug → title`).
 */
export async function toLedgerLines(
	ctx: WalletContext,
	rows: readonly TxnRow[],
	projectsOut?: Map<string, string>,
): Promise<LedgerLine[]> {
	if (rows.length === 0) return [];
	const refs = await resolveRefs(ctx, rows);
	const now = Date.now();
	return rows.map((row) => {
		const meta = reasonMeta(row.reason, row.direction);
		let title = meta.label;
		let party: Party | null = null;
		let refId: string | null = null;
		let href: string | null = null;
		let subject: LedgerSubject | null = null;
		let instrument: LedgerInstrument | null = null;
		let receiptHref: string | null = null;

		if (row.ref_table === "escrows" && row.ref_id) {
			const facts = refs.escrows.get(row.ref_id);
			const stage = facts?.stage ?? null;
			if (stage) {
				title = `${meta.label} · ${stage.projectTitle}`;
				projectsOut?.set(stage.projectSlug, stage.projectTitle);
				refId = stage.projectSlug;
				href = stageHref(stage);
				subject = { kind: "stage", label: `${stage.projectTitle} · ${stage.stageName}`, href };
			}
			party = facts?.party ?? null;
			if (facts?.invoiceId) receiptHref = `/api/finance/invoices/${facts.invoiceId}/pdf`;
		} else if (row.ref_table === "orders" && row.ref_id) {
			const order = refs.orders.get(row.ref_id);
			if (order) {
				title = `${meta.label} · ${order.reference}`;
				href = `/checkout/confirmation?order=${encodeURIComponent(row.ref_id)}`;
				subject = { kind: "order", label: `Order ${order.reference}`, href };
				instrument = order.instrument;
			}
		} else if (row.ref_table === "order_lines" && row.ref_id) {
			// A sale credits the seller against the BUYER's order line, which only the buyer may read: the
			// seller's line stays "Service sale" with no subject rather than guessing at what was bought.
			const line = refs.orderLines.get(row.ref_id);
			const order = line ? refs.orders.get(line.orderId) : undefined;
			if (line) {
				title = `${meta.label} · ${line.title}`;
				const linkTo = order
					? `/checkout/confirmation?order=${encodeURIComponent(line.orderId)}`
					: null;
				subject = {
					kind: line.itemType === "digital_product" && !row.reason.startsWith("service_")
						? "product"
						: "service",
					label: line.title,
					href: linkTo,
				};
				href = linkTo;
				instrument = order?.instrument ?? null;
			}
		} else if (row.ref_table === "inbound_payments" && row.ref_id) {
			const payment = refs.inbound.get(row.ref_id);
			if (payment) {
				instrument = payment.instrument;
				subject = payment.stage
					? {
						kind: "stage",
						label: `${payment.stage.projectTitle} · ${payment.stage.stageName}`,
						href: stageHref(payment.stage),
					}
					: {
						kind: "topup",
						label: payment.recurring ? "Recurring top-up" : "Card top-up",
						href: null,
					};
			}
		} else if (row.ref_table === "payment_methods" && row.ref_id) {
			instrument = refs.methods.get(row.ref_id) ?? null;
			subject = { kind: "topup", label: "Card top-up", href: null };
		} else if (row.ref_table === "wallets" && row.ref_id) {
			const other = accountOfWallet(ctx.accounts, row.ref_id);
			if (other) {
				party = {
					kind: partyKindOf(other),
					name: other.owner.name,
					handle: other.scope === "personal" ? null : other.owner.handle,
					avatar: other.owner.avatar,
				};
				title = row.direction === "credit"
					? `Transfer from ${other.owner.name}`
					: `Transfer to ${other.owner.name}`;
				subject = { kind: "transfer", label: other.owner.name, href: null };
			}
		} else if (row.ref_table === "team_distribution" && row.ref_id && row.direction === "credit") {
			const team = refs.distributions.get(row.ref_id);
			if (team) {
				title = `${meta.label} · ${team}`;
				party = { kind: "team", name: team, handle: null, avatar: null };
				subject = { kind: "transfer", label: team, href: null };
			}
		} else if (row.ref_table === "payouts") {
			subject = { kind: "payout", label: "Payout to your bank", href: null };
		}

		return {
			id: row.id,
			direction: row.direction,
			reason: clip(row.reason, 80),
			title: clip(title, 160),
			counterparty: party ? clip(party.name, 120) : null,
			counterpartyHandle: party?.handle ? clip(party.handle, 40) : null,
			counterpartyKind: party?.kind ?? null,
			counterpartyAvatar: party?.avatar ? clip(party.avatar, 600) : null,
			amount: ctx.money.price(row.amount_cents, row.currency),
			fundState: row.fund_state ?? "available",
			category: meta.category,
			kind: ledgerKindOf(row.reason),
			refKind: meta.refKind,
			refId: refId ? clip(refId, 64) : null,
			href: href ? clip(href, 200) : null,
			subject: subject
				? {
					...subject,
					label: clip(subject.label, 160),
					href: subject.href ? clip(subject.href, 200) : null,
				}
				: null,
			instrument,
			settlement: settlementOf(row, refs),
			receiptHref,
			at: row.created_at,
			dateLabel: dateLabel(row.created_at, now, ctx.timezone),
			group: ledgerGroup(row.created_at, now, ctx.timezone),
		};
	});
}

/**
 * The project (slug and title) each escrow-backed line paid for — what the analytics breakdown sums
 * by, resolved without the rest of a line's enrichment.
 */
export async function projectsOfRows(
	ctx: WalletContext,
	rows: readonly TxnRow[],
): Promise<Map<string, { slug: string; title: string; href: string }>> {
	const out = new Map<string, { slug: string; title: string; href: string }>();
	const escrowIds = idsOf(rows.filter((r) => r.ref_table === "escrows").map((r) => r.ref_id));
	if (escrowIds.length === 0) return out;
	const db = getUserClient(ctx.actor.accessToken);
	const escrows = await readByIds<{ id: string; project_stage_id: string }>(
		"escrows",
		escrowIds,
		(ids) => db.schema("finance").from("escrows").select("id, project_stage_id").in("id", ids),
	);
	const stages = await stageFacts(ctx, escrows.map((e) => e.project_stage_id));
	const byEscrow = new Map(escrows.map((e) => [e.id, stages.get(e.project_stage_id)]));
	for (const row of rows) {
		if (row.ref_table !== "escrows" || !row.ref_id) continue;
		const stage = byEscrow.get(row.ref_id);
		if (stage) {
			out.set(row.id, {
				slug: stage.projectSlug,
				title: stage.projectTitle,
				href: `/projects/${stage.projectSlug}`,
			});
		}
	}
	return out;
}
// #endregion

// #region Transactions page
/**
 * A keyset page of the ledger for the Transactions page: filtered in the database, one more row read
 * than shown to learn whether another page exists, the cursor the last line shown. `sort`/`dir` other
 * than newest-first re-order the page in place — keyset paging is defined for the date order alone.
 */
export async function ledgerPage(
	ctx: WalletContext,
	walletIds: readonly string[],
	params: TransactionListParams,
): Promise<TransactionPage> {
	const limit = Math.min(200, Math.max(1, params.limit ?? 40));
	const search = params.search?.trim() || null;
	const reasons = reasonsForKinds(params.kinds);
	const rows = await listLedger(ctx, walletIds, {
		direction: params.direction ?? null,
		reasons,
		from: params.from ?? rangeStart(params.range, Date.now(), ctx.timezone),
		to: params.to ?? null,
		search,
		searchReasons: search ? reasonsMatching(search) : [],
		searchWallets: search ? walletsMatching(ctx.accounts, search) : [],
		after: decodeLedgerCursor(params.cursor),
	}, limit + 1);
	const more = rows.length > limit;
	const pageRows = rows.slice(0, limit);
	const projects = new Map<string, string>();
	let lines = await toLedgerLines(ctx, pageRows, projects);
	if (params.fundState) lines = lines.filter((l) => l.fundState === params.fundState);
	if (params.category) lines = lines.filter((l) => l.category === params.category);
	if (params.project) lines = lines.filter((l) => l.refId === params.project);

	const sort = params.sort ?? "date";
	if (sort !== "date" || params.dir === "asc") {
		const asc = (params.dir ?? "desc") === "asc";
		lines = [...lines].sort((a, b) => {
			let c = 0;
			if (sort === "amount") c = a.amount.minor - b.amount.minor;
			else if (sort === "counterparty") {
				c = (a.counterparty ?? "").localeCompare(b.counterparty ?? "");
			} else if (sort === "category") c = a.category.localeCompare(b.category);
			else if (sort === "status") c = a.fundState.localeCompare(b.fundState);
			else c = a.at.localeCompare(b.at);
			if (c === 0) c = a.id.localeCompare(b.id);
			return asc ? c : -c;
		});
	}

	const last = pageRows[pageRows.length - 1];
	return {
		items: lines,
		hasMore: more,
		nextCursor: more && last ? encodeLedgerCursor({ at: last.created_at, id: last.id }) : null,
		total: null,
		projects: [...projects.entries()].slice(0, 60).map(([id, name]) => ({
			id: clip(id, 64),
			name: clip(name, 120),
		})),
	};
}
// #endregion

// #region Series
/**
 * In-vs-out over the last `days`, in `buckets` equal slices, in the display currency — the overview's
 * small series. A window longer than a year labels each slice by month and year ("Mar 2024"), because a
 * day-and-month label repeats across the years such a window spans and stops saying which slice it is.
 */
export function flowSeries(
	ctx: WalletContext,
	rows: readonly TxnRow[],
	days: number,
	buckets: number,
	now = Date.now(),
): FlowPoint[] {
	const span = (days * DAY) / buckets;
	const start = now - days * DAY;
	const format: Intl.DateTimeFormatOptions = days > 366
		? { month: "short", year: "numeric", timeZone: ctx.timezone }
		: { day: "numeric", month: "short", timeZone: ctx.timezone };
	const points: FlowPoint[] = Array.from({ length: buckets }, (_, i) => ({
		label: new Date(start + i * span).toLocaleDateString("en-GB", format),
		start: localDay(start + i * span, ctx.timezone),
		inMinor: 0,
		outMinor: 0,
		netMinor: 0,
	}));
	for (const row of rows) {
		const at = Date.parse(row.created_at);
		if (at < start || at > now) continue;
		const index = Math.min(buckets - 1, Math.floor((at - start) / span));
		if (!ctx.money.canConvert(row.currency)) continue;
		const minor = ctx.money.convertMinor(row.amount_cents, row.currency);
		if (row.direction === "credit") points[index].inMinor += minor;
		else points[index].outMinor += minor;
	}
	for (const p of points) p.netMinor = p.inMinor - p.outMinor;
	return points;
}

/** One `finance.ledger_flow` row. */
export interface FlowBucketRow {
	bucket: string;
	currency: string;
	direction: "credit" | "debit";
	reason: string;
	total_cents: number;
	line_count: number;
}

/** The ledger summed per calendar bucket in the viewer's zone, as the database groups it. */
export async function readFlowBuckets(
	ctx: WalletContext,
	walletIds: readonly string[],
	window: { from: string | null; to: string | null; grain: FlowGrain },
): Promise<FlowBucketRow[]> {
	if (walletIds.length === 0) return [];
	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc(
		"ledger_flow",
		{
			p_wallet_ids: [...walletIds],
			p_from: window.from,
			p_to: window.to,
			p_tz: ctx.timezone,
			p_grain: window.grain,
		},
	);
	if (error) throw new Error(`finance.ledger_flow failed: ${error.message}`);
	return ((data ?? []) as FlowBucketRow[]).map((r) => ({
		...r,
		bucket: String(r.bucket).slice(0, 10),
		total_cents: Number(r.total_cents) || 0,
		line_count: Number(r.line_count) || 0,
	}));
}

/** The oldest movement the viewer may read across a set of wallets, or `null` when there is none. */
export async function readFirstMovement(
	ctx: WalletContext,
	walletIds: readonly string[],
): Promise<string | null> {
	if (walletIds.length === 0) return null;
	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc(
		"ledger_first_at",
		{
			p_wallet_ids: [...walletIds],
		},
	);
	if (error) throw new Error(`finance.ledger_first_at failed: ${error.message}`);
	return typeof data === "string" && Number.isFinite(Date.parse(data))
		? new Date(data).toISOString()
		: null;
}

/** Adds `n` grain steps to a calendar day (`YYYY-MM-DD`), in pure calendar arithmetic. */
export function addGrain(day: string, grain: FlowGrain, n: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	if (grain === "day") d.setUTCDate(d.getUTCDate() + n);
	else if (grain === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
	else d.setUTCMonth(d.getUTCMonth() + n);
	return d.toISOString().slice(0, 10);
}

/** The first day of the grain bucket a calendar day falls in (ISO weeks start on Monday). */
export function truncateDay(day: string, grain: FlowGrain): string {
	const d = new Date(`${day}T00:00:00Z`);
	if (grain === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	else if (grain === "month") d.setUTCDate(1);
	return d.toISOString().slice(0, 10);
}

/** A bucket's axis label: "5 Oct" for a day or a week, "Oct 2026" for a month. */
export function bucketLabel(day: string, grain: FlowGrain): string {
	const d = new Date(`${day}T00:00:00Z`);
	return grain === "month"
		? d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
		: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Every bucket from `firstDay` to `lastDay` inclusive (both already truncated), with the database's sums
 * folded in after converting each origin currency once per bucket. A bucket nothing moved in is still
 * drawn, at zero, so the axis is the calendar and not the ledger's gaps.
 */
export function bucketSeries(
	ctx: WalletContext,
	rows: readonly FlowBucketRow[],
	firstDay: string,
	lastDay: string,
	grain: FlowGrain,
): FlowPoint[] {
	const points: FlowPoint[] = [];
	const index = new Map<string, number>();
	for (let day = firstDay; day <= lastDay && points.length < 64; day = addGrain(day, grain, 1)) {
		index.set(day, points.length);
		points.push({
			label: bucketLabel(day, grain),
			start: day,
			inMinor: 0,
			outMinor: 0,
			netMinor: 0,
		});
	}
	// Sum each bucket per origin currency first, then convert once — the same rounding rule as every
	// balance on the surface (`sumOf`): converting each line and adding the conversions invents pennies.
	const held = new Map<string, { credit: number; debit: number }>();
	for (const r of rows) {
		const key = `${truncateDay(r.bucket, grain)}|${r.currency}`;
		const sums = held.get(key) ?? { credit: 0, debit: 0 };
		sums[r.direction] += r.total_cents;
		held.set(key, sums);
	}
	for (const [key, sums] of held) {
		const [day, currency] = key.split("|");
		const at = index.get(day);
		if (at === undefined || !ctx.money.canConvert(currency)) continue;
		points[at].inMinor += ctx.money.convertMinor(sums.credit, currency);
		points[at].outMinor += ctx.money.convertMinor(sums.debit, currency);
	}
	for (const p of points) p.netMinor = p.inMinor - p.outMinor;
	return points;
}

/** The line families ranked by what they moved, from the database's per-reason sums. */
export function kindTotals(
	ctx: WalletContext,
	rows: readonly FlowBucketRow[],
): { kind: LedgerKind; inMinor: number; outMinor: number; lines: number }[] {
	const held = new Map<string, { credit: number; debit: number; lines: number }>();
	for (const r of rows) {
		const key = `${ledgerKindOf(r.reason)}|${r.currency}`;
		const sums = held.get(key) ?? { credit: 0, debit: 0, lines: 0 };
		sums[r.direction] += r.total_cents;
		sums.lines += r.line_count;
		held.set(key, sums);
	}
	const byKind = new Map<LedgerKind, { inMinor: number; outMinor: number; lines: number }>();
	for (const [key, sums] of held) {
		const [kind, currency] = key.split("|") as [LedgerKind, string];
		if (!ctx.money.canConvert(currency)) continue;
		const acc = byKind.get(kind) ?? { inMinor: 0, outMinor: 0, lines: 0 };
		acc.inMinor += ctx.money.convertMinor(sums.credit, currency);
		acc.outMinor += ctx.money.convertMinor(sums.debit, currency);
		acc.lines += sums.lines;
		byKind.set(kind, acc);
	}
	return LedgerKindEnum.options
		.filter((kind) => byKind.has(kind))
		.map((kind) => ({ kind, ...byKind.get(kind)! }))
		.sort((a, b) => b.inMinor + b.outMinor - (a.inMinor + a.outMinor));
}
// #endregion
