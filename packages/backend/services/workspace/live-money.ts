import { DEFAULT_LOCALE, type FlowPoint, SpendRefTable } from "@projective/types/finance";
import {
	type BusinessKyb,
	type BusinessMoneyTile,
	type BusinessSpendPolicy,
	type BusinessViewerCan,
	KybRequirement,
	type PoolEntry,
	type SpendEnvelopePreview,
	type SpendLimit,
	type SpendRequest,
	type SpendRequestRef,
	type SplitStake,
	type SplitTemplate,
	type TeamPayoutPolicy,
	type UpdateSpendInput,
	type VerificationState,
	walletHrefFor,
	type WorkspaceCapability,
	type WorkspaceFinance,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { clamp, clampOr } from "../../core/text.ts";
import { ok, type ServiceResult } from "../ServiceResult.ts";
import { overviewOf } from "../finance/live-wallet.ts";
import { reasonMeta } from "../finance/wallet-ledger.ts";
import { resolveWalletContext } from "../finance/wallet-scope.ts";
import { fetchPartyCards, type PartyCard } from "../profile/party-cards.ts";
import { badId, callRpc, clientFor, isUuid, type LiveActor } from "./live-support.ts";
import { spendPatch } from "./live-writes.ts";
import {
	avatarOf,
	dateLabel,
	deriveSplitModel,
	evenSplit,
	isoOf,
	moneyOf,
	type Person,
	projectedShare,
	type RawMember,
	type RawSplitRule,
	relativeLabel,
	spendRequestState,
	toSplitRule,
	verificationPrompt,
} from "./mappers.ts";

/**
 * live-money — the Money modules of the console: a team's payout split, a business's spend policy, and
 * the finance tiles both share.
 *
 * Both kinds' money arrives inside the console's one read (`org.get_workspace_detail`, Decision #233):
 * a team's payout block (sent only to a `manage_finances` holder), and a business's spend block, money
 * tiles, KYB and viewer flags (BB9) — each narrowed in SQL to what the viewer may see, every envelope
 * figure computed there — so the builders here are pure. Every figure is a stored amount in its OWN
 * currency — nothing here converts, sums across currencies, or computes a split a different way from
 * the database. The projected release is `finance.preview_team_split`, which runs the same plan
 * (`finance.fn_team_split_plan`) the release itself runs, so what a team is shown is what it receives.
 *
 * The finance tiles REUSE the `/wallet` entity-scope projection (`resolveWalletContext` + `overviewOf`)
 * rather than re-deriving balances, so the console and the wallet page cannot disagree.
 */

// #region Shared facts

/** An active member, as the money builders need them. */
export interface MoneyMember {
	memberId: string;
	userId: string;
	isOwner: boolean;
	person: Person | undefined;
	/** The member's EFFECTIVE capabilities (role ∪ granted − revoked, kind-scoped). */
	capabilities: readonly WorkspaceCapability[];
}

function faceOf(member: MoneyMember): { handle: string; name: string; avatar: string } {
	return {
		handle: clamp(member.person?.username, 40),
		name: clampOr(member.person?.name, 120, "Member"),
		avatar: avatarOf(member.person?.avatar),
	};
}

const ENTRY_LIMIT = 40;

/** A stored amount as a non-negative integer of minor units (`0` for a figure nobody recorded). */
function minorOf(raw: number | string | null | undefined): number {
	return Math.max(0, Math.trunc(Number(raw) || 0));
}

// #endregion

// #region Team — raw reads

/** `finance.preview_team_split`'s answer. */
export interface RawSplitPreview {
	gross_minor: number | null;
	currency: string | null;
	fee_minor: number | null;
	fee_bp?: number | null;
	escrow_id?: string;
	plan: {
		payout_minor: number;
		rule_type: string | null;
		vault_bp: number;
		finder_user_id: string | null;
		finder_minor: number;
		vault_minor: number;
		members: { member_user_id: string; percent_bp: number; amount_minor: number }[];
		dust_minor: number;
		vault_total_minor: number;
	};
}

/** Everything a team's payout policy is built from. */
export interface TeamMoneyFacts {
	agreements: Map<string, { bp: number; held: boolean }>;
	preview: RawSplitPreview | null;
	walletCurrency: string;
	/** The active `finance.split_rules` row; `null` when the team has never stored one. */
	rule: RawSplitRule | null;
	/** The vault wallet the policy reports balances from; absent or `null` when the team has none. */
	wallet?: RawVaultWallet | null;
}

/** The vault wallet on the detail's payout block — the treasury wallet, else the fullest. */
export interface RawVaultWallet {
	id: string;
	currency: string;
	available_minor: number;
	pending_minor: number;
}

/**
 * The payout block `org.get_workspace_detail` answers to a `manage_finances` holder (and to nobody
 * else): the active split rule, the vault wallet and `finance.preview_team_split`'s projection.
 */
export interface RawTeamPayout {
	rule: RawSplitRule | null;
	wallet: RawVaultWallet | null;
	preview: RawSplitPreview | null;
}

/**
 * A team's money facts from the ONE detail read — the payout block plus the members' stakes the same
 * read carries (`share_bp` / `share_held`). Pure: nothing here touches the database.
 */
export function teamMoneyFacts(
	payout: RawTeamPayout,
	members: readonly Pick<RawMember, "user_id" | "share_bp" | "share_held">[],
): TeamMoneyFacts {
	const agreements = new Map<string, { bp: number; held: boolean }>();
	for (const m of members) {
		if (m.share_bp === null || m.share_bp === undefined) continue;
		agreements.set(m.user_id, { bp: Number(m.share_bp) || 0, held: !!m.share_held });
	}
	return {
		agreements,
		preview: payout.preview ?? null,
		walletCurrency: (payout.wallet?.currency ?? "USD").toUpperCase(),
		rule: payout.rule ?? null,
		wallet: payout.wallet ?? null,
	};
}

// #endregion

// #region Team — the policy

/**
 * A team's payout policy. `stakes` are the ACTIVE members' agreements (a member with no row holds 0);
 * `projected` is each member's share of the next release by the plan the release runs (0 when nothing
 * is held — no release is coming, and none is invented).
 */
export function buildPayoutPolicy(
	members: readonly MoneyMember[],
	facts: TeamMoneyFacts,
): TeamPayoutPolicy {
	const preview = facts.preview;
	const released = preview !== null && preview.gross_minor !== null &&
		preview.gross_minor !== undefined;
	const currency = (released && preview.currency ? preview.currency : facts.walletCurrency)
		.toUpperCase();
	const planned = new Map<string, number>();
	for (const m of preview?.plan?.members ?? []) {
		planned.set(m.member_user_id, Number(m.amount_minor) || 0);
	}

	const stakes: SplitStake[] = members.map((member) => {
		const agreement = facts.agreements.get(member.userId);
		return {
			memberId: member.memberId,
			...faceOf(member),
			shareBp: Math.max(0, Math.min(10_000, agreement?.bp ?? 0)),
			held: agreement?.held ?? false,
			projected: moneyOf(planned.get(member.userId) ?? 0, currency),
		};
	});
	const model = deriveSplitModel(stakes);

	// The members' pool the plan divides: the payout less the finder's and the vault's cuts.
	const plan = preview?.plan;
	const pool = released && plan
		? Math.max(
			0,
			(Number(plan.payout_minor) || 0) - (Number(plan.finder_minor) || 0) -
				(Number(plan.vault_minor) || 0),
		)
		: 0;
	const templates: SplitTemplate[] = [{
		id: "current",
		name: "Current split",
		model,
		stakes,
		isDefault: true,
	}];
	const owner = members.find((m) => m.isOwner)?.memberId ?? null;
	const even = evenSplit(members.map((m) => m.memberId), owner);
	const sameAsCurrent = even.every((e) => {
		const s = stakes.find((stake) => stake.memberId === e.memberId);
		return s !== undefined && s.shareBp === e.shareBp && !s.held;
	});
	if (even.length > 0 && !sameAsCurrent) {
		templates.push({
			id: "even",
			name: "Even split",
			model: "equal",
			isDefault: false,
			stakes: even.map((e) => {
				const member = members.find((m) => m.memberId === e.memberId)!;
				return {
					memberId: e.memberId,
					...faceOf(member),
					shareBp: e.shareBp,
					held: false,
					projected: moneyOf(projectedShare(pool, e.shareBp), currency),
				};
			}),
		});
	}

	// With no release held the plan answers for a zero payout, whose vault figure is 0 by construction;
	// the team's standing rule still says what the vault WILL take, so that is what is shown.
	const rule = toSplitRule(facts.rule);
	const vaultBp = released && plan ? Number(plan.vault_bp) || 0 : rule.vaultBp;
	const wallet = facts.wallet ?? null;

	return {
		walletId: wallet?.id ?? null,
		currency: facts.walletCurrency.toUpperCase(),
		availableMinor: minorOf(wallet?.available_minor),
		pendingMinor: minorOf(wallet?.pending_minor),
		model,
		stakes,
		templates,
		projectedRelease: released ? moneyOf(Number(preview.gross_minor) || 0, currency) : null,
		platformFee: released ? moneyOf(Number(preview.fee_minor) || 0, currency) : null,
		vaultBp: Math.max(0, Math.min(10_000, vaultBp)),
		rule,
		vaultCut: released && plan ? moneyOf(Number(plan.vault_total_minor) || 0, currency) : null,
		withdrawApprovers: members.filter((m) => m.capabilities.includes("withdraw_funds")).map((m) =>
			m.memberId
		),
	};
}

// #endregion

// #region Business — raw blocks (as org.get_workspace_detail answers them)

/** One member's envelope from `finance.fn_business_envelopes` — every figure decided in SQL. */
export interface RawEnvelope {
	member_id: string;
	user_id: string;
	can_spend: boolean;
	limit_minor: number | string | null;
	per_transaction_minor: number | string | null;
	period: string | null;
	spent_minor: number | string | null;
	remaining_minor: number | string | null;
	used_fraction: number | string | null;
}

/** A `finance.ledger_audit` `add_funds` row on the spend block. */
export interface RawContribution {
	id: string;
	actor_user_id: string | null;
	amount_minor: number | string;
	currency: string;
	/** The contributor's note, when they left one. */
	note: string | null;
	/** `card_topup` for a card top-up's audit row (BB6), else `null`. */
	kind: string | null;
	at: string;
}

/** A debit `finance.transactions` row on the spend block. */
export interface RawDebit {
	id: string;
	amount_minor: number | string;
	currency: string;
	reason: string;
	at: string;
}

/**
 * What a request's ref names (`finance.fn_spend_ref`) — the keys present depend on the ref table —
 * and whether the viewer may open it (`opens`).
 */
export interface RawSpendRef {
	title?: string | null;
	item?: string | null;
	items?: number | string | null;
	project_title?: string | null;
	project_slug?: string | null;
	stage_title?: string | null;
	stage_slug?: string | null;
	ticket_slug?: string | null;
	invoice_type?: string | null;
	period_start?: string | null;
	due_at?: string | null;
	owner_type?: string | null;
	opens?: boolean | null;
}

/** A `finance.spend_approvals` row on the spend block. */
export interface RawApproval {
	id: string;
	requested_by: string;
	amount_minor: number | string;
	currency: string;
	reason: string;
	status: string;
	approver_user_id: string | null;
	decided_at: string | null;
	expires_at: string | null;
	created_at: string;
	/** What it was filed against (`finance.spend_approvals.ref_table` / `ref_id`). */
	ref_table?: string | null;
	ref_id?: string | null;
	/** What that is, `{}` when the row is gone. */
	ref?: RawSpendRef | null;
	/** Whether an approved request has been spent. */
	consumed?: boolean | null;
}

/**
 * A business's spend block — answered only to a viewer who may open Spend. `limits` and `approvals`
 * are already narrowed to what the viewer may read (BB6): their own, unless they read the wallet's
 * envelopes (`finance.fn_reads_wallet_envelopes`).
 */
export interface RawBusinessSpend {
	currency: string;
	approval_threshold_minor: number | string | null;
	platform_threshold_minor: number | string | null;
	approver_user_ids: string[] | null;
	contributor_user_ids: string[] | null;
	limits: RawEnvelope[] | null;
	/** What each member has put into the policy wallet, all time. */
	contributed: { user_id: string; minor: number | string }[] | null;
	contributions: RawContribution[] | null;
	debits: RawDebit[] | null;
	approvals: { pending: RawApproval[] | null; decided: RawApproval[] | null } | null;
	/** The member ids whose limits and grants the viewer may change (`[]` for a non-editor). */
	editable_member_ids?: string[] | null;
	/** Nobody besides the owner approves spending. */
	approver_gap?: boolean | null;
	/** Setting a threshold or a ceiling is refused by the Business Pro gate right now. */
	limits_plan_gated?: boolean | null;
}

/** One currency's money tiles, summed in SQL in that currency. */
export interface RawMoneyTile {
	currency: string;
	available_minor: number | string | null;
	pending_minor: number | string | null;
	committed_minor: number | string | null;
	awaiting_approval_minor: number | string | null;
	spent_30d_minor: number | string | null;
}

/** The business's KYB picture. */
export interface RawKyb {
	status: string | null;
	verified_at: string | null;
	/** Whether a Stripe Connect account exists for the business. */
	has_account: boolean | null;
	requirements_due: string[] | null;
}

/** The viewer's server-decided flags, snake_cased. */
export type RawViewerCan = Partial<Record<string, boolean | null>>;

/** `finance.preview_spend_envelope`'s answer. */
export interface RawEnvelopePreview {
	currency: string;
	limits: RawEnvelope[] | null;
}

/** Every user id a spend block names — for the one party-card batch. */
export function businessSpendPeople(raw: RawBusinessSpend | null | undefined): string[] {
	if (!raw) return [];
	const approvals = [...(raw.approvals?.pending ?? []), ...(raw.approvals?.decided ?? [])];
	return [
		...(raw.limits ?? []).map((l) => l.user_id),
		...(raw.contributions ?? []).map((c) => c.actor_user_id ?? ""),
		...approvals.map((a) => a.requested_by),
		...approvals.map((a) => a.approver_user_id ?? ""),
	].filter((id) => id.length > 0);
}

// #endregion

// #region Business — the policy

/** A raw amount that may be absent: `null` stays `null`, anything else a non-negative integer. */
function minorOrNull(raw: number | string | null | undefined): number | null {
	return raw === null || raw === undefined ? null : minorOf(raw);
}

const PERIODS = new Set(["weekly", "monthly", "total"]);

/** A member's envelope as the Spend module renders it — the SQL's figures, formatted. */
export function toSpendLimit(
	raw: RawEnvelope,
	person: Person | undefined,
	currency: string,
): SpendLimit {
	const limitMinor = minorOrNull(raw.limit_minor);
	const spentMinor = minorOf(raw.spent_minor);
	const remainingMinor = limitMinor === null ? null : minorOf(raw.remaining_minor);
	const perTransactionMinor = minorOrNull(raw.per_transaction_minor);
	const fraction = Number(raw.used_fraction);
	return {
		memberId: raw.member_id,
		handle: clamp(person?.username, 40),
		name: clampOr(person?.name, 120, "Member"),
		avatar: avatarOf(person?.avatar),
		canSpend: raw.can_spend === true,
		limitMinor,
		limit: limitMinor === null ? null : moneyOf(limitMinor, currency),
		period: PERIODS.has(raw.period ?? "") ? raw.period as SpendLimit["period"] : "monthly",
		spentMinor,
		spent: moneyOf(spentMinor, currency),
		remainingMinor,
		remaining: remainingMinor === null ? null : moneyOf(remainingMinor, currency),
		usedFraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0,
		perTransactionMinor,
		perTransaction: perTransactionMinor === null ? null : moneyOf(perTransactionMinor, currency),
	};
}

/** What a member has put into the pool, in the policy currency — the SQL's all-time sum. */
export function contributedBy(raw: RawBusinessSpend | null | undefined, userId: string): number {
	const row = (raw?.contributed ?? []).find((c) => c.user_id === userId);
	return row ? minorOf(row.minor) : 0;
}

/** The envelope the viewer may read for a member, or `undefined` (none, or not theirs to see). */
export function envelopeFor(
	raw: RawBusinessSpend | null | undefined,
	userId: string,
): RawEnvelope | undefined {
	return (raw?.limits ?? []).find((l) => l.user_id === userId);
}

/** A member as the business builders need them: their member id and face. */
export interface SpendMember {
	memberId: string;
	userId: string;
	person: Person | undefined;
}

/** The business a spend block belongs to — what a request's link needs to be built. */
export interface SpendRefContext {
	/** The business's id: a basket link's owner, a transfer's wallet scope. */
	businessId: string;
	/** The business's handle: the Billing module's address. */
	handle: string;
}

const REF_TABLES = new Set<string>(SpendRefTable.options);

const EXPIRY_DAY = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

const INVOICE_MONTH = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

/**
 * When a pending request lapses, as the checkout words it ("Expires 24 Oct", UTC so SSR and a refetch
 * agree); `null` with no expiry, or once it has passed.
 */
export function expiryLabel(iso: string | null | undefined, nowMs: number): string | null {
	if (!iso) return null;
	const at = Date.parse(iso);
	if (!Number.isFinite(at) || at <= nowMs) return null;
	return `Expires ${EXPIRY_DAY.format(new Date(at))}`;
}

/** A project page (`/projects/<prj>`), optionally deep into a stage room or a ticket. */
function projectHref(
	projectSlug: string,
	at: { stageSlug?: string | null; ticketSlug?: string | null },
): string {
	const base = `/projects/${encodeURIComponent(projectSlug)}`;
	if (at.stageSlug) return `${base}/${encodeURIComponent(at.stageSlug)}`;
	if (at.ticketSlug) return `${base}?${new URLSearchParams({ tkv: at.ticketSlug })}`;
	return base;
}

/**
 * What a spend request is for, as the Spend module names it (`finance.fn_spend_ref`, Decision #246): a
 * label, a supporting line, and an href set ONLY when the database said the viewer may open it — a
 * project by the projects SELECT predicates, a basket by its owner's visibility, an invoice by the
 * billing right — so a link always lands (root CLAUDE.md §3.11). `null` when the ref names nothing any
 * more (the SQL answers `{}`) or its table is unknown.
 */
export function spendRefOf(
	table: string | null | undefined,
	refId: string | null | undefined,
	raw: RawSpendRef | null | undefined,
	ctx: SpendRefContext,
	nowMs: number,
): SpendRequestRef | null {
	if (!table || !REF_TABLES.has(table) || !raw || Object.keys(raw).length === 0) return null;
	const opens = raw.opens === true;
	const project = clamp(raw.project_title, 120) || null;
	const projectSlug = clamp(raw.project_slug, 64);
	const ref = (label: string, detail: string | null, href: string | null): SpendRequestRef => ({
		table: table as SpendRequestRef["table"],
		label: clamp(label, 160),
		detail: detail ? clamp(detail, 160) : null,
		href: href ? clamp(href, 300) : null,
	});
	switch (table) {
		case "baskets": {
			const count = Math.max(0, Math.floor(Number(raw.items ?? 0)) || 0);
			const first = clamp(raw.item, 120);
			const detail = first ? (count > 1 ? `${first} and ${count - 1} more` : first) : null;
			const href = opens && refId
				? `/checkout?${new URLSearchParams({ basket: refId, owner: `business:${ctx.businessId}` })}`
				: null;
			return ref(clampOr(raw.title, 120, "Basket"), detail, href);
		}
		case "project_stages": {
			const stageSlug = clamp(raw.stage_slug, 64);
			const href = opens && projectSlug && stageSlug
				? projectHref(projectSlug, { stageSlug })
				: null;
			return ref(clampOr(raw.title, 120, "Stage"), project, href);
		}
		case "tickets": {
			const ticketSlug = clamp(raw.ticket_slug, 64);
			const href = opens && projectSlug && ticketSlug
				? projectHref(projectSlug, { ticketSlug })
				: null;
			return ref(clampOr(raw.title, 120, "Ticket"), project, href);
		}
		case "revisions": {
			const ticketSlug = clamp(raw.ticket_slug, 64);
			const href = opens && projectSlug && ticketSlug
				? projectHref(projectSlug, { ticketSlug })
				: null;
			const stage = clamp(raw.stage_title, 120);
			return ref(
				`Revision of ${clampOr(raw.title, 120, "a ticket")}`,
				[stage, project].filter(Boolean).join(" · ") || null,
				href,
			);
		}
		case "invoices": {
			const start = raw.period_start ? Date.parse(raw.period_start) : NaN;
			const stage = clamp(raw.stage_title, 120);
			const label = raw.invoice_type === "consolidated_monthly"
				? Number.isFinite(start)
					? `Invoice for ${INVOICE_MONTH.format(new Date(start))}`
					: "Monthly invoice"
				: stage
				? `Invoice for ${stage}`
				: "Invoice";
			const due = raw.due_at ? dateLabel(raw.due_at, nowMs) : "";
			return ref(
				label,
				due ? `Due ${due}` : null,
				opens ? workspaceHref("business", ctx.handle, "billing") : null,
			);
		}
		default: {
			const to = raw.owner_type === "team"
				? "To a team wallet"
				: raw.owner_type === "business"
				? "To a business wallet"
				: raw.owner_type
				? "To a personal wallet"
				: null;
			return ref("Transfer", to, opens ? walletHrefFor("business", ctx.businessId) : null);
		}
	}
}

/**
 * A business's spend policy — the buyer-side editor's whole state, mapped from the detail's spend
 * block. The database decided who approves and contributes, which envelopes and requests the viewer
 * may read, and every figure on them; this only resolves faces and formats. The ledger is attributed
 * where the money path recorded an actor and left as the business itself where it did not. The
 * editor's flags — whose rows the viewer may change, whether nobody but the owner approves, whether
 * a ceiling is plan-gated — and what each request is for are the SQL's too (Decision #246); `ctx` only
 * addresses the links.
 */
export function buildSpendPolicy(
	raw: RawBusinessSpend,
	members: readonly SpendMember[],
	people: ReadonlyMap<string, Person>,
	verification: VerificationState,
	nowMs: number,
	ctx: SpendRefContext,
): BusinessSpendPolicy {
	const currency = (raw.currency || "USD").toUpperCase();
	const threshold = minorOrNull(raw.approval_threshold_minor);
	const platform = minorOrNull(raw.platform_threshold_minor);
	const byUser = new Map(members.map((m) => [m.userId, m]));
	const memberIdsOf = (userIds: readonly string[] | null) =>
		(userIds ?? []).flatMap((id) => byUser.get(id) ?? []);
	const approvers = memberIdsOf(raw.approver_user_ids);
	const contributors = memberIdsOf(raw.contributor_user_ids);
	const handleOf = (m: SpendMember) => clamp(m.person?.username, 40);

	const entryOf = (userId: string | null) => {
		const person = userId ? people.get(userId) : undefined;
		const member = userId ? byUser.get(userId) : undefined;
		return {
			memberId: member?.memberId ?? null,
			handle: person ? clamp(person.username, 40) : null,
			name: person ? clampOr(person.name, 120, "Member") : null,
			avatar: person ? avatarOf(person.avatar) || null : null,
		};
	};
	const entries: (PoolEntry & { sortAt: number })[] = [
		...(raw.contributions ?? []).map((c) => ({
			id: c.id,
			kind: "contribution" as const,
			...entryOf(c.actor_user_id),
			amount: moneyOf(minorOf(c.amount_minor), c.currency),
			reason: clampOr(c.note, 160, c.kind === "card_topup" ? "Added by card" : "Added funds"),
			at: clamp(dateLabel(c.at, nowMs), 40),
			approvedBy: null,
			sortAt: Date.parse(c.at) || 0,
		})),
		...(raw.debits ?? []).map((d) => ({
			id: d.id,
			kind: "spend" as const,
			memberId: null,
			handle: null,
			name: null,
			avatar: null,
			amount: moneyOf(minorOf(d.amount_minor), d.currency),
			reason: clamp(reasonMeta(d.reason, "debit").label, 160),
			at: clamp(dateLabel(d.at, nowMs), 40),
			approvedBy: null,
			sortAt: Date.parse(d.at) || 0,
		})),
	];
	entries.sort((a, b) => b.sortAt - a.sortAt);

	const requestOf = (row: RawApproval): SpendRequest => {
		const requester = people.get(row.requested_by);
		const decider = row.approver_user_id ? people.get(row.approver_user_id) : undefined;
		const state = spendRequestState(row.status, row.expires_at, nowMs);
		return {
			id: row.id,
			memberId: byUser.get(row.requested_by)?.memberId ?? row.requested_by,
			handle: clamp(requester?.username, 40),
			name: clampOr(requester?.name, 120, "A member"),
			avatar: avatarOf(requester?.avatar),
			amount: moneyOf(minorOf(row.amount_minor), row.currency),
			reason: clampOr(row.reason, 160, "Spend request"),
			state,
			raisedAt: clamp(relativeLabel(row.created_at, nowMs), 40),
			approvers: approvers
				.filter((m) => m.userId !== row.requested_by)
				.map((m) => clampOr(m.person?.name, 120, "Member")),
			decidedBy: decider ? clampOr(decider.name, 120, "Member") : null,
			decidedAt: row.decided_at ? clamp(relativeLabel(row.decided_at, nowMs), 40) || null : null,
			expiresLabel: state === "pending" ? expiryLabel(row.expires_at, nowMs) : null,
			ref: spendRefOf(row.ref_table, row.ref_id, row.ref, ctx, nowMs),
			consumed: row.consumed === true,
		};
	};
	const memberIds = new Set(members.map((m) => m.memberId));

	return {
		currency,
		approvalThresholdMinor: threshold !== null && threshold > 0 ? threshold : null,
		approvalThreshold: threshold !== null && threshold > 0 ? moneyOf(threshold, currency) : null,
		platformThresholdMinor: platform !== null && platform > 0 ? platform : null,
		platformThreshold: platform !== null && platform > 0 ? moneyOf(platform, currency) : null,
		editableMemberIds: (raw.editable_member_ids ?? []).filter((id) => memberIds.has(id)),
		approverGap: raw.approver_gap === true,
		limitsPlanGated: raw.limits_plan_gated === true,
		approverIds: approvers.map((m) => m.memberId),
		approverHandles: approvers.map(handleOf),
		limits: (raw.limits ?? []).map((l) => toSpendLimit(l, people.get(l.user_id), currency)),
		contributorIds: contributors.map((m) => m.memberId),
		contributorHandles: contributors.map(handleOf),
		entries: entries.slice(0, ENTRY_LIMIT).map(({ sortAt: _sortAt, ...entry }) => entry),
		approvals: {
			pending: (raw.approvals?.pending ?? []).map(requestOf),
			decided: (raw.approvals?.decided ?? []).map(requestOf),
		},
		verification,
		verificationPrompt: verificationPrompt("business", verification),
	};
}

/** One currency's tiles, formatted in that currency. */
export function toMoneyTile(raw: RawMoneyTile): BusinessMoneyTile {
	const currency = (raw.currency || "USD").toUpperCase();
	return {
		currency,
		available: moneyOf(minorOf(raw.available_minor), currency),
		pending: moneyOf(minorOf(raw.pending_minor), currency),
		committed: moneyOf(minorOf(raw.committed_minor), currency),
		awaitingApproval: moneyOf(minorOf(raw.awaiting_approval_minor), currency),
		spent30d: moneyOf(minorOf(raw.spent_30d_minor), currency),
	};
}

const VIEWER_CAN_KEYS = {
	editPolicy: "edit_policy",
	decide: "decide",
	requestSpend: "request_spend",
	payInvoice: "pay_invoice",
	startKyb: "start_kyb",
	hire: "hire",
	purchase: "purchase",
	manageProjects: "manage_projects",
	archive: "archive",
} as const satisfies Record<keyof BusinessViewerCan, string>;

/** The viewer's flags — `true` only where the database said so; a missing flag is a refusal. */
export function toViewerCan(raw: RawViewerCan | null | undefined): BusinessViewerCan {
	const out = {} as BusinessViewerCan;
	for (const [key, sqlKey] of Object.entries(VIEWER_CAN_KEYS)) {
		out[key as keyof BusinessViewerCan] = raw?.[sqlKey] === true;
	}
	return out;
}

const KYB_REQUIREMENTS = new Set<string>(KybRequirement.options);

/**
 * The business's KYB picture. The resume link is the Connect refresh door
 * (`GET /api/finance/connect/refresh`), which mints a fresh single-use link for the EXISTING account
 * and redirects — so it is offered only to a `startKyb` holder whose business has an account; one
 * without starts at `POST /api/finance/verify/kyb`, which needs the registration country.
 * `processorConnected` is the environment's (`isPaymentsLive`), passed in so this stays pure.
 */
export function toKyb(
	raw: RawKyb | null | undefined,
	businessId: string,
	canStart: boolean,
	processorConnected: boolean,
): BusinessKyb {
	const status = raw?.status === "verified" || raw?.status === "pending"
		? raw.status
		: "unverified";
	const params = new URLSearchParams({ scope: "business", businessId, back: "settings" });
	return {
		status,
		verifiedAt: raw?.verified_at ? isoOf(raw.verified_at) || null : null,
		connectOnboardingUrl: canStart && raw?.has_account === true
			? `/api/finance/connect/refresh?${params}`
			: null,
		requirementsDue: (raw?.requirements_due ?? []).filter((code): code is KybRequirement =>
			KYB_REQUIREMENTS.has(code)
		),
		processorConnected,
	};
}

// #endregion

// #region Business — the draft preview

/**
 * The envelopes a draft spend-policy patch WOULD produce (`finance.preview_spend_envelope`, read-only,
 * `manage_finances`), with faces resolved in one party-card batch. The patch is the same one
 * `finance.save_spend_policy` takes, so the preview and the save cannot read a draft differently.
 */
export async function previewSpendEnvelope(
	input: UpdateSpendInput,
	actor: LiveActor,
	io: {
		rpc: typeof callRpc;
		partyCards: (actor: LiveActor, ids: readonly string[]) => Promise<Map<string, PartyCard>>;
	} = { rpc: callRpc, partyCards: (a, ids) => fetchPartyCards(clientFor(a), ids) },
): Promise<ServiceResult<SpendEnvelopePreview>> {
	if (!isUuid(input.workspaceId)) return badId("workspaceId", "business");
	const res = await io.rpc<RawEnvelopePreview>(actor, "finance", "preview_spend_envelope", {
		p_business_id: input.workspaceId,
		p_patch: spendPatch(input),
	});
	if (!res.ok) return res.refusal;
	const raw = res.data;
	const currency = (raw?.currency || input.currency || "USD").toUpperCase();
	const limits = raw?.limits ?? [];
	const cards = await io.partyCards(actor, limits.map((l) => l.user_id));
	return ok({
		currency,
		limits: limits.map((l) => {
			const card = cards.get(l.user_id);
			return toSpendLimit(
				l,
				card ? { username: card.username, name: card.name, avatar: card.avatar } : undefined,
				currency,
			);
		}),
	});
}

// #endregion

// #region Finance tiles

/**
 * A sparkline accent from the wallet's flow series: what the entity EARNS (team) or SPENDS (business),
 * normalised to 0–1. Empty when nothing moved — a flat line would draw a trend nobody recorded.
 */
export function trendOf(kind: WorkspaceKind, flow: readonly FlowPoint[]): number[] {
	const values = flow.map((p) => (kind === "team" ? p.inMinor : p.outMinor));
	const max = Math.max(0, ...values);
	if (max <= 0) return [];
	return values.map((v) => Math.max(0, Math.min(1, v / max)));
}

/**
 * The console's money tiles, from the `/wallet` entity-scope projection (in the entity's own
 * currency). Throws when the entity's wallet is not among the caller's wallets — the wallet scope
 * falls back to the PERSONAL wallet in that case, and the console must never show a member's own
 * balance as the entity's.
 */
export async function readFinanceTiles(
	actor: LiveActor,
	kind: WorkspaceKind,
	id: string,
): Promise<WorkspaceFinance> {
	const ctx = await resolveWalletContext({ wallet: `${kind}:${id}` }, actor);
	if (
		!ctx || ctx.target === "aggregate" || ctx.target.scope !== kind ||
		ctx.target.id !== id.toLowerCase()
	) {
		throw new Error(`the ${kind} wallet ${id} is not visible to this member`);
	}
	const overview = await overviewOf(ctx);
	return {
		available: overview.available,
		locked: overview.locked,
		pending: overview.pending,
		walletHref: walletHrefFor(kind, id),
		trend: trendOf(kind, overview.flow),
		delta: null,
	};
}

// #endregion
