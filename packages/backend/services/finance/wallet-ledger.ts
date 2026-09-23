import type {
	FlowPoint,
	FundState,
	LedgerLine,
	TransactionListParams,
	TransactionPage,
	TxnCategory,
} from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import type { WalletAccount, WalletContext } from "./wallet-scope.ts";

/**
 * wallet-ledger — the wallet's movements as the surface shows them: every `finance.transactions` line
 * of the wallets in view, labelled, linked back to the work that produced it, and grouped for the
 * charts.
 *
 * A ledger line only knows its `reason` and a `(ref_table, ref_id)` pointer. The label, the project it
 * paid for and the person on the other side are resolved here by reading the referenced rows WITH THE
 * VIEWER'S TOKEN — so a line never names more than its reader may see. A freelancer sees the client
 * business's public face on an escrow release; a buyer sees their own order's reference; a seller sees
 * "Product sale" and not who bought it, because the buyer's order is not theirs to read.
 *
 * **A bounded window, stated.** The Transactions page filters, sorts and pages over the most recent
 * {@link LEDGER_WINDOW} lines of the wallets in view; the counts it reports are counts within that
 * window. Dates and direction are narrowed in the database first, so a date-bounded query reaches
 * further back than the window alone would.
 */

// #region Reference
const DAY = 86_400_000;
/** How many of the most recent lines a Transactions query works over. */
export const LEDGER_WINDOW = 1000;

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

/** `Today` / `Yesterday` / `3 days ago` / `12 Sept`. */
export function dateLabel(iso: string, now = Date.now()): string {
	const ms = Date.parse(iso);
	const diff = Math.floor(now / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	if (diff < 7) return `${diff} days ago`;
	return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function clip(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
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
		.select("id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, fund_state, created_at")
		.in("wallet_id", [...walletIds]);
	if (options.direction) q = q.eq("direction", options.direction);
	if (options.fundState) q = q.eq("fund_state", options.fundState);
	const from = options.since ?? options.from;
	if (from && Number.isFinite(Date.parse(from))) q = q.gte("created_at", new Date(from).toISOString());
	if (options.to && Number.isFinite(Date.parse(options.to))) {
		q = q.lte("created_at", new Date(options.to).toISOString());
	}
	const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false })
		.limit(options.limit);
	if (error) throw new Error(`finance.transactions read failed: ${error.message}`);
	return ((data ?? []) as TxnRow[]).map((row) => ({ ...row, amount_cents: Number(row.amount_cents) || 0 }));
}
// #endregion

// #region Enrichment
interface EscrowFacts {
	projectSlug: string | null;
	projectTitle: string | null;
	stageSlug: string | null;
	counterparty: string | null;
	counterpartyHandle: string | null;
}

/**
 * The context each line's reference points at, resolved in batches with the viewer's token. Anything
 * the viewer cannot read simply stays unresolved and the line falls back to its reason's label.
 */
async function resolveRefs(ctx: WalletContext, rows: readonly TxnRow[]) {
	const db = getUserClient(ctx.actor.accessToken);
	const idsFor = (table: string) => [...new Set(rows.filter((r) => r.ref_table === table && r.ref_id).map((r) => r.ref_id!))];
	const escrowIds = idsFor("escrows");
	const orderIds = idsFor("orders");
	const distributionIds = idsFor("team_distribution");

	const escrows = new Map<string, EscrowFacts>();
	if (escrowIds.length > 0) {
		const { data, error } = await db.schema("finance").from("escrows")
			.select("id, project_stage_id, payer_business_id, payee_type, payee_id")
			.in("id", escrowIds);
		if (error) throw new Error(`finance.escrows read failed: ${error.message}`);
		const escrowRows = (data ?? []) as {
			id: string;
			project_stage_id: string;
			payer_business_id: string;
			payee_type: string;
			payee_id: string;
		}[];
		const stages = await stageFacts(ctx, escrowRows.map((e) => e.project_stage_id));
		const faces = await counterpartyFaces(ctx, escrowRows);
		for (const e of escrowRows) {
			const stage = stages.get(e.project_stage_id);
			const viewerIsPayer = ctx.accounts.some((a) =>
				a.scope === "business" && a.id === e.payer_business_id
			);
			const face = viewerIsPayer
				? faces.get(`${e.payee_type}:${e.payee_id}`)
				: faces.get(`business:${e.payer_business_id}`);
			escrows.set(e.id, {
				projectSlug: stage?.projectSlug ?? null,
				projectTitle: stage?.projectTitle ?? null,
				stageSlug: stage?.stageSlug ?? null,
				counterparty: face?.name ?? null,
				counterpartyHandle: face?.handle ?? null,
			});
		}
	}

	const orders = new Map<string, string>();
	if (orderIds.length > 0) {
		const { data, error } = await db.schema("finance").from("orders").select("id, reference").in("id", orderIds);
		if (error) throw new Error(`finance.orders read failed: ${error.message}`);
		for (const o of (data ?? []) as { id: string; reference: string }[]) orders.set(o.id, o.reference);
	}

	// A distribution's credit points at a correlation id; the vault it came from is on the audit row,
	// which a member of that vault may read.
	const distributions = new Map<string, string>();
	if (distributionIds.length > 0) {
		const { data, error } = await db.schema("finance").from("ledger_audit")
			.select("ref_id, wallet_id")
			.eq("ref_table", "team_distribution")
			.in("ref_id", distributionIds);
		if (error) throw new Error(`finance.ledger_audit read failed: ${error.message}`);
		for (const a of (data ?? []) as { ref_id: string; wallet_id: string }[]) {
			const account = accountOfWallet(ctx.accounts, a.wallet_id);
			if (account) distributions.set(a.ref_id, account.owner.name);
		}
	}

	return { escrows, orders, distributions };
}

/** What a stage id resolves to for a reader: its project and its address. */
export interface StageFacts {
	projectId: string;
	projectSlug: string;
	projectTitle: string;
	stageSlug: string | null;
	stageName: string;
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
	const ids = [...new Set(stageIds)];
	if (ids.length === 0) return out;
	const db = getUserClient(ctx.actor.accessToken);
	const st = await db.schema("projects").from("project_stages").select("id, slug, name, project_id").in("id", ids);
	if (st.error) throw new Error(`projects.project_stages read failed: ${st.error.message}`);
	const stageRows = (st.data ?? []) as { id: string; slug: string | null; name: string; project_id: string }[];
	const projectIds = [...new Set(stageRows.map((s) => s.project_id))];
	const projects = new Map<string, { slug: string; title: string }>();
	if (projectIds.length > 0) {
		const pr = await db.schema("projects").from("projects").select("id, slug, title").in("id", projectIds);
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
		});
	}
	return out;
}

/** Names and handles of the other party on escrow lines: payees for a payer, the payer for a payee. */
async function counterpartyFaces(
	ctx: WalletContext,
	escrows: readonly { payer_business_id: string; payee_type: string; payee_id: string }[],
): Promise<Map<string, { name: string; handle: string | null }>> {
	const db = getUserClient(ctx.actor.accessToken);
	const faces = new Map<string, { name: string; handle: string | null }>();
	const userIds = [...new Set(escrows.filter((e) => e.payee_type === "freelancer").map((e) => e.payee_id))];
	const teamIds = [...new Set(escrows.filter((e) => e.payee_type === "team").map((e) => e.payee_id))];
	const businessIds = [...new Set(escrows.map((e) => e.payer_business_id))];

	if (userIds.length > 0) {
		const { data } = await db.schema("org").from("users_public")
			.select("user_id, username, first_name, last_name").in("user_id", userIds);
		for (const u of (data ?? []) as { user_id: string; username: string; first_name: string | null; last_name: string | null }[]) {
			const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username;
			faces.set(`freelancer:${u.user_id}`, { name, handle: u.username });
		}
	}
	if (teamIds.length > 0) {
		const { data } = await db.schema("org").from("teams").select("id, name, slug").in("id", teamIds);
		for (const t of (data ?? []) as { id: string; name: string; slug: string }[]) {
			faces.set(`team:${t.id}`, { name: t.name, handle: t.slug });
		}
	}
	// A business's public face through the purchase-owner door — `business_profiles` has no client
	// read policy, and the door answers the public face (name, handle) to anyone signed in.
	await Promise.all(businessIds.map(async (id) => {
		const own = ctx.accounts.find((a) => a.scope === "business" && a.id === id);
		if (own) {
			faces.set(`business:${id}`, { name: own.owner.name, handle: own.owner.handle });
			return;
		}
		const { data } = await db.schema("finance").rpc("get_purchase_owner", {
			p_owner_type: "business",
			p_owner_id: id,
		});
		const face = data as { name: string | null; handle: string | null } | null;
		if (face?.name) faces.set(`business:${id}`, { name: face.name, handle: face.handle });
	}));
	return faces;
}

/** The viewer's account that owns a wallet row. */
export function accountOfWallet(accounts: readonly WalletAccount[], walletId: string): WalletAccount | undefined {
	return accounts.find((a) => a.rows.some((row) => row.id === walletId));
}

/**
 * Project raw lines into what the surface shows, in the display currency. When `projectsOut` is given
 * it collects every project a line paid for (`slug → title`) — the Transactions page's project filter.
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
		let counterparty: string | null = null;
		let counterpartyHandle: string | null = null;
		let refId: string | null = null;
		let href: string | null = null;

		if (row.ref_table === "escrows" && row.ref_id) {
			const facts = refs.escrows.get(row.ref_id);
			if (facts?.projectTitle) title = `${meta.label} · ${facts.projectTitle}`;
			if (facts?.projectSlug && facts.projectTitle) projectsOut?.set(facts.projectSlug, facts.projectTitle);
			counterparty = facts?.counterparty ?? null;
			counterpartyHandle = facts?.counterpartyHandle ?? null;
			refId = facts?.projectSlug ?? null;
			href = facts?.projectSlug
				? facts.stageSlug ? `/projects/${facts.projectSlug}/${facts.stageSlug}` : `/projects/${facts.projectSlug}`
				: null;
		} else if (row.ref_table === "orders" && row.ref_id) {
			const reference = refs.orders.get(row.ref_id);
			if (reference) {
				title = `${meta.label} · ${reference}`;
				href = `/checkout/confirmation?order=${encodeURIComponent(row.ref_id)}`;
			}
		} else if (row.ref_table === "wallets" && row.ref_id) {
			const other = accountOfWallet(ctx.accounts, row.ref_id);
			if (other) {
				counterparty = other.owner.name;
				counterpartyHandle = other.scope === "personal" ? null : other.owner.handle;
				title = row.direction === "credit" ? `Transfer from ${other.owner.name}` : `Transfer to ${other.owner.name}`;
			}
		} else if (row.ref_table === "team_distribution" && row.ref_id && row.direction === "credit") {
			const team = refs.distributions.get(row.ref_id);
			if (team) {
				title = `${meta.label} · ${team}`;
				counterparty = team;
			}
		} else if (row.ref_table === "payouts") {
			href = "/wallet/payouts";
		}

		return {
			id: row.id,
			direction: row.direction,
			reason: clip(row.reason, 80),
			title: clip(title, 160),
			counterparty: counterparty ? clip(counterparty, 120) : null,
			counterpartyHandle: counterpartyHandle ? clip(counterpartyHandle, 40) : null,
			amount: ctx.money.price(row.amount_cents, row.currency),
			fundState: row.fund_state ?? "available",
			category: meta.category,
			refKind: meta.refKind,
			refId: refId ? clip(refId, 64) : null,
			href: href ? clip(href, 200) : null,
			at: new Date(row.created_at).toISOString(),
			dateLabel: dateLabel(row.created_at, now),
		};
	});
}
// #endregion

// #region Transactions page
/** A page of the ledger for the Transactions table. */
export async function ledgerPage(
	ctx: WalletContext,
	walletIds: readonly string[],
	params: TransactionListParams,
): Promise<TransactionPage> {
	const rows = await readLedger(ctx, walletIds, {
		direction: params.direction,
		fundState: params.fundState,
		from: params.from,
		to: params.to,
		limit: LEDGER_WINDOW,
	});
	const projects = new Map<string, string>();
	let lines = await toLedgerLines(ctx, rows, projects);

	if (params.category) lines = lines.filter((l) => l.category === params.category);
	if (params.project) lines = lines.filter((l) => l.refId === params.project);
	if (params.search) {
		const needle = params.search.toLowerCase();
		lines = lines.filter((l) =>
			l.title.toLowerCase().includes(needle) || (l.counterparty?.toLowerCase().includes(needle) ?? false)
		);
	}

	const sort = params.sort ?? "date";
	const asc = (params.dir ?? "desc") === "asc";
	const sorted = [...lines].sort((a, b) => {
		let c = 0;
		if (sort === "amount") c = a.amount.minor - b.amount.minor;
		else if (sort === "counterparty") c = (a.counterparty ?? "").localeCompare(b.counterparty ?? "");
		else if (sort === "category") c = a.category.localeCompare(b.category);
		else if (sort === "status") c = a.fundState.localeCompare(b.fundState);
		else c = a.at.localeCompare(b.at);
		if (c === 0) c = a.id.localeCompare(b.id);
		return asc ? c : -c;
	});

	const limit = Math.min(200, Math.max(1, params.limit ?? 40));
	const offset = params.cursor && /^o:\d+$/.test(params.cursor) ? Number(params.cursor.slice(2)) : 0;
	const page = sorted.slice(offset, offset + limit);
	const more = offset + limit < sorted.length;
	return {
		items: page,
		hasMore: more,
		nextCursor: more ? `o:${offset + limit}` : null,
		total: sorted.length,
		projects: [...projects.entries()].slice(0, 60).map(([id, name]) => ({
			id: clip(id, 64),
			name: clip(name, 120),
		})),
	};
}
// #endregion

// #region Series
/** In-vs-out over the last `days`, in `buckets` equal slices, in the display currency. */
export function flowSeries(
	ctx: WalletContext,
	rows: readonly TxnRow[],
	days: number,
	buckets: number,
	now = Date.now(),
): FlowPoint[] {
	const span = (days * DAY) / buckets;
	const start = now - days * DAY;
	const points: FlowPoint[] = Array.from({ length: buckets }, (_, i) => ({
		label: new Date(start + i * span).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
		inMinor: 0,
		outMinor: 0,
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
	return points;
}
// #endregion
