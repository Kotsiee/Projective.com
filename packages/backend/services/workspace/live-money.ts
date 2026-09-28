import type { FlowPoint } from "@projective/types/finance";
import {
	type BusinessSpendPolicy,
	type PoolEntry,
	type SpendLimit,
	type SpendRequest,
	type SplitStake,
	type SplitTemplate,
	type TeamPayoutPolicy,
	type VerificationState,
	walletHrefFor,
	type WorkspaceCapability,
	type WorkspaceFinance,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { clamp, clampOr } from "../../core/text.ts";
import { overviewOf } from "../finance/live-wallet.ts";
import { reasonMeta } from "../finance/wallet-ledger.ts";
import { resolveWalletContext } from "../finance/wallet-scope.ts";
import { clientFor, type LiveActor } from "./live-support.ts";
import {
	avatarOf,
	dateLabel,
	deriveSplitModel,
	evenSplit,
	moneyOf,
	type Person,
	projectedShare,
	relativeLabel,
	spendRequestState,
	spentInPeriod,
	usedFraction,
	verificationPrompt,
} from "./mappers.ts";

/**
 * live-money — the Money modules of the console: a team's payout split, a business's spend policy, and
 * the finance tiles both share.
 *
 * Every read runs under the caller's own session (`finance.*` RLS: a member sees their entity's wallets,
 * split agreements, limits, audit and approvals), and every figure is a stored amount in its OWN
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

// #endregion

// #region Team — raw reads

/** `finance.preview_team_split`'s answer. */
export interface RawSplitPreview {
	gross_minor: number | null;
	currency: string | null;
	fee_minor: number | null;
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
	rule: { rule_type: string; vault_bp: number } | null;
}

/** Read a team's split agreements, its release projection, its vault currency and its split rule. */
export async function readTeamMoney(actor: LiveActor, teamId: string): Promise<TeamMoneyFacts> {
	const db = clientFor(actor).schema("finance");
	const [agreementsRes, previewRes, walletsRes, ruleRes] = await Promise.all([
		db.from("contribution_agreements").select("member_user_id, percent_bp, held").eq(
			"team_id",
			teamId,
		),
		db.rpc("preview_team_split", { p_team_id: teamId }),
		db.from("wallets").select("currency, balance_cents").eq("owner_type", "team").eq(
			"owner_id",
			teamId,
		),
		db.from("split_rules").select("rule_type, vault_bp").eq("team_id", teamId).eq("active", true)
			.maybeSingle(),
	]);
	if (agreementsRes.error) {
		throw new Error(`finance.contribution_agreements read failed: ${agreementsRes.error.message}`);
	}
	if (previewRes.error) {
		throw new Error(`finance.preview_team_split failed: ${previewRes.error.message}`);
	}
	if (walletsRes.error) throw new Error(`finance.wallets read failed: ${walletsRes.error.message}`);
	if (ruleRes.error) throw new Error(`finance.split_rules read failed: ${ruleRes.error.message}`);

	const agreements = new Map<string, { bp: number; held: boolean }>();
	for (
		const row of (agreementsRes.data ?? []) as {
			member_user_id: string;
			percent_bp: number;
			held: boolean;
		}[]
	) {
		agreements.set(row.member_user_id, { bp: Number(row.percent_bp) || 0, held: !!row.held });
	}
	const wallets = ((walletsRes.data ?? []) as { currency: string; balance_cents: number }[])
		.sort((a, b) => (Number(b.balance_cents) || 0) - (Number(a.balance_cents) || 0));
	const rule = ruleRes.data as { rule_type: string; vault_bp: number } | null;
	return {
		agreements,
		preview: (previewRes.data ?? null) as RawSplitPreview | null,
		walletCurrency: (wallets[0]?.currency ?? "USD").toUpperCase(),
		rule,
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
	const vaultBp = released && plan
		? Number(plan.vault_bp) || 0
		: facts.rule
		? (facts.rule.rule_type === "benevolent_dictator" ? 10_000 : Number(facts.rule.vault_bp) || 0)
		: 0;

	return {
		model,
		stakes,
		templates,
		projectedRelease: released ? moneyOf(Number(preview.gross_minor) || 0, currency) : null,
		platformFee: released ? moneyOf(Number(preview.fee_minor) || 0, currency) : null,
		vaultBp: Math.max(0, Math.min(10_000, vaultBp)),
		vaultCut: released && plan ? moneyOf(Number(plan.vault_total_minor) || 0, currency) : null,
		withdrawApprovers: members.filter((m) => m.capabilities.includes("withdraw_funds")).map((m) =>
			m.memberId
		),
	};
}

// #endregion

// #region Business — raw reads

/** A `finance.wallets` row of the business. */
export interface BusinessWalletRow {
	id: string;
	currency: string;
	approval_threshold_cents: number | null;
}

/** A `finance.spending_limits` row. */
export interface LimitRow {
	wallet_id: string;
	member_user_id: string;
	cap_cents: number | null;
	per_transaction_cents: number | null;
	period_interval: string | null;
	spent_cents: number | null;
	resets_at: string | null;
}

/** A `finance.ledger_audit` `add_funds` row. */
export interface AuditRow {
	id: string;
	wallet_id: string;
	actor_user_id: string | null;
	amount_cents: number;
	currency: string;
	metadata: { note?: string } | null;
	created_at: string;
}

/** A debit `finance.transactions` row. */
export interface DebitRow {
	id: string;
	wallet_id: string;
	amount_cents: number;
	currency: string;
	reason: string;
	created_at: string;
}

/** A `finance.spend_approvals` row. */
export interface ApprovalRow {
	id: string;
	wallet_id: string;
	requested_by: string;
	amount_cents: number;
	currency: string;
	reason: string;
	status: string;
	approver_user_id: string | null;
	decided_at: string | null;
	expires_at: string | null;
	created_at: string;
}

/** Everything a business's spend policy is built from. */
export interface BusinessMoneyFacts {
	currency: string;
	wallets: BusinessWalletRow[];
	limits: LimitRow[];
	audit: AuditRow[];
	debits: DebitRow[];
	approvals: ApprovalRow[];
}

/**
 * Read a business's wallets, the policy wallet's limits, the attributable ledger and the spend
 * requests. The policy currency is the business's DEFAULT currency, read through the member-gated
 * purchase-owner door (`org.business_profiles` itself has no client policy).
 */
export async function readBusinessMoney(
	actor: LiveActor,
	businessId: string,
): Promise<BusinessMoneyFacts> {
	const db = clientFor(actor).schema("finance");
	const [ownerRes, walletsRes] = await Promise.all([
		db.rpc("get_purchase_owner", { p_owner_type: "business", p_owner_id: businessId }),
		db.from("wallets").select("id, currency, approval_threshold_cents")
			.eq("owner_type", "business").eq("owner_id", businessId),
	]);
	if (walletsRes.error) throw new Error(`finance.wallets read failed: ${walletsRes.error.message}`);
	const wallets = ((walletsRes.data ?? []) as BusinessWalletRow[]).map((w) => ({
		...w,
		currency: w.currency.toUpperCase(),
		approval_threshold_cents: w.approval_threshold_cents === null
			? null
			: Number(w.approval_threshold_cents),
	}));
	const ownerCurrency = ((ownerRes.data as { currency?: string | null } | null)?.currency ?? "")
		.toUpperCase();
	const currency = /^[A-Z]{3}$/.test(ownerCurrency) ? ownerCurrency : wallets[0]?.currency ?? "USD";

	const ids = wallets.map((w) => w.id);
	if (ids.length === 0) {
		return { currency, wallets, limits: [], audit: [], debits: [], approvals: [] };
	}
	const policyWallet = wallets.find((w) => w.currency === currency);
	const [limitsRes, auditRes, debitsRes, approvalsRes] = await Promise.all([
		policyWallet
			? db.from("spending_limits")
				.select(
					"wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval, spent_cents, resets_at",
				)
				.eq("wallet_id", policyWallet.id)
			: Promise.resolve({ data: [], error: null }),
		db.from("ledger_audit").select(
			"id, wallet_id, actor_user_id, amount_cents, currency, metadata, created_at",
		)
			.in("wallet_id", ids).eq("action", "add_funds").order("created_at", { ascending: false })
			.limit(ENTRY_LIMIT),
		db.from("transactions").select("id, wallet_id, amount_cents, currency, reason, created_at")
			.in("wallet_id", ids).eq("direction", "debit").neq("reason", "transfer_out")
			.order("created_at", { ascending: false }).limit(ENTRY_LIMIT),
		db.from("spend_approvals")
			.select(
				"id, wallet_id, requested_by, amount_cents, currency, reason, status, approver_user_id, decided_at, expires_at, created_at",
			)
			.in("wallet_id", ids).order("created_at", { ascending: false }).limit(ENTRY_LIMIT),
	]);
	if (limitsRes.error) {
		throw new Error(`finance.spending_limits read failed: ${limitsRes.error.message}`);
	}
	if (auditRes.error) {
		throw new Error(`finance.ledger_audit read failed: ${auditRes.error.message}`);
	}
	if (debitsRes.error) {
		throw new Error(`finance.transactions read failed: ${debitsRes.error.message}`);
	}
	if (approvalsRes.error) {
		throw new Error(`finance.spend_approvals read failed: ${approvalsRes.error.message}`);
	}
	return {
		currency,
		wallets,
		limits: (limitsRes.data ?? []) as LimitRow[],
		audit: (auditRes.data ?? []) as AuditRow[],
		debits: (debitsRes.data ?? []) as DebitRow[],
		approvals: (approvalsRes.data ?? []) as ApprovalRow[],
	};
}

/** Every user id the business money facts name — for the one party-card batch. */
export function businessMoneyPeople(facts: BusinessMoneyFacts): string[] {
	return [
		...facts.audit.map((a) => a.actor_user_id ?? ""),
		...facts.approvals.map((a) => a.requested_by),
		...facts.approvals.map((a) => a.approver_user_id ?? ""),
	].filter((id) => id.length > 0);
}

// #endregion

// #region Business — the policy

/** A member's spend envelope on the policy wallet: the row's facts, or the no-ceiling defaults. */
export function limitFor(facts: BusinessMoneyFacts, userId: string): LimitRow | undefined {
	const wallet = facts.wallets.find((w) => w.currency === facts.currency);
	return wallet
		? facts.limits.find((l) => l.wallet_id === wallet.id && l.member_user_id === userId)
		: undefined;
}

/** What a member has put into the pool, in the policy currency (a sum in ONE currency only). */
export function contributedBy(facts: BusinessMoneyFacts, userId: string): number {
	return facts.audit
		.filter((a) => a.actor_user_id === userId && a.currency.trim().toUpperCase() === facts.currency)
		.reduce((sum, a) => sum + (Number(a.amount_cents) || 0), 0);
}

/**
 * A business's spend policy — the buyer-side editor's whole state. Approvers, contributors and
 * spenders are the members whose EFFECTIVE capabilities carry `approve_spend`, `contribute_funds` and
 * `spend_funds`; the ledger is attributed where the money path recorded an actor and left as the
 * business itself where it did not.
 */
export function buildSpendPolicy(
	members: readonly MoneyMember[],
	facts: BusinessMoneyFacts,
	people: ReadonlyMap<string, Person>,
	verification: VerificationState,
	nowMs: number,
): BusinessSpendPolicy {
	const currency = facts.currency;
	const wallet = facts.wallets.find((w) => w.currency === currency);
	const threshold =
		wallet && wallet.approval_threshold_cents !== null && wallet.approval_threshold_cents > 0
			? wallet.approval_threshold_cents
			: null;
	const approvers = members.filter((m) => m.capabilities.includes("approve_spend"));
	const byUser = new Map(members.map((m) => [m.userId, m]));

	const limits: SpendLimit[] = members.map((member) => {
		const row = limitFor(facts, member.userId);
		const limitMinor = row && row.cap_cents !== null && row.cap_cents !== undefined
			? Number(row.cap_cents)
			: null;
		const spent = row
			? spentInPeriod(row.spent_cents, row.period_interval, row.resets_at, nowMs)
			: 0;
		return {
			memberId: member.memberId,
			...faceOf(member),
			canSpend: member.capabilities.includes("spend_funds"),
			limitMinor,
			limit: limitMinor === null ? null : moneyOf(limitMinor, currency),
			spent: moneyOf(spent, currency),
			usedFraction: usedFraction(spent, limitMinor),
			perTransactionMinor:
				row && row.per_transaction_cents !== null && row.per_transaction_cents !== undefined
					? Number(row.per_transaction_cents)
					: null,
		};
	});

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
		...facts.audit.map((a) => ({
			id: a.id,
			kind: "contribution" as const,
			...entryOf(a.actor_user_id),
			amount: moneyOf(Number(a.amount_cents) || 0, a.currency),
			reason: clampOr(a.metadata?.note, 160, "Added funds"),
			at: clamp(dateLabel(a.created_at, nowMs), 40),
			approvedBy: null,
			sortAt: Date.parse(a.created_at) || 0,
		})),
		...facts.debits.map((d) => ({
			id: d.id,
			kind: "spend" as const,
			memberId: null,
			handle: null,
			name: null,
			avatar: null,
			amount: moneyOf(Number(d.amount_cents) || 0, d.currency),
			reason: clamp(reasonMeta(d.reason, "debit").label, 160),
			at: clamp(dateLabel(d.created_at, nowMs), 40),
			approvedBy: null,
			sortAt: Date.parse(d.created_at) || 0,
		})),
	];
	entries.sort((a, b) => b.sortAt - a.sortAt);

	const requests: SpendRequest[] = facts.approvals.map((row) => {
		const requester = people.get(row.requested_by);
		const decider = row.approver_user_id ? people.get(row.approver_user_id) : undefined;
		const state = spendRequestState(row.status, row.expires_at, nowMs);
		return {
			id: row.id,
			memberId: byUser.get(row.requested_by)?.memberId ?? row.requested_by,
			handle: clamp(requester?.username, 40),
			name: clampOr(requester?.name, 120, "A member"),
			avatar: avatarOf(requester?.avatar),
			amount: moneyOf(Number(row.amount_cents) || 0, row.currency),
			reason: clampOr(row.reason, 160, "Spend request"),
			state,
			raisedAt: clamp(relativeLabel(row.created_at, nowMs), 40),
			approvers: approvers
				.filter((m) => m.userId !== row.requested_by)
				.map((m) => clampOr(m.person?.name, 120, "Member")),
			decidedBy: decider ? clampOr(decider.name, 120, "Member") : null,
			decidedAt: row.decided_at ? clamp(relativeLabel(row.decided_at, nowMs), 40) || null : null,
		};
	});
	requests.sort((a, b) => (a.state === "pending" ? 0 : 1) - (b.state === "pending" ? 0 : 1));

	return {
		currency,
		approvalThresholdMinor: threshold,
		approvalThreshold: threshold === null ? null : moneyOf(threshold, currency),
		approverIds: approvers.map((m) => m.memberId),
		limits,
		contributorIds: members.filter((m) => m.capabilities.includes("contribute_funds")).map((m) =>
			m.memberId
		),
		entries: entries.slice(0, ENTRY_LIMIT).map(({ sortAt: _sortAt, ...entry }) => entry),
		requests,
		verification,
		verificationPrompt: verificationPrompt("business", verification),
	};
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
