import { currencyExponent, formatMoney, type MoneyView } from "@projective/types/finance";
import {
	type ActivityEntry,
	type IncomingInvite,
	kindCopy,
	type MemberFace,
	type SetupStep,
	type SplitModel,
	type VerificationState,
	type WorkspaceCapability,
	WorkspaceCapability as WorkspaceCapabilityEnum,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceProject,
	type WorkspaceRole,
	WorkspaceRole as WorkspaceRoleEnum,
	type WorkspaceRoleDef,
	type WorkspaceStat,
	type WorkspaceStatus,
	WorkspaceStatus as WorkspaceStatusEnum,
} from "@projective/types/workspace";
import { clamp, clampOr } from "../../core/text.ts";

/**
 * mappers — the PURE half of the live workspace console: every rule that turns the raw facts the
 * definer reads return (`org.get_workspace_roster`, `org.get_workspace_detail`) into the
 * `@projective/types/workspace` projections, with no I/O and an injected clock.
 *
 * The reads deliberately return RAW facts — ids, file ids, codes, instants — so the mapping happens
 * once, here, where it can be unit-tested (`mappers.test.ts`). Nothing in this module invents a value:
 * a missing picture is `""`, a missing name falls back to what the row does say, and a figure nobody
 * recorded is rendered as absent rather than as a plausible zero.
 */

// #region Raw shapes (as the definer reads return them)

/** One entity on `org.get_workspace_roster`. */
export interface RawRosterItem {
	id: string;
	name: string;
	handle: string;
	avatar_file_id: string | null;
	headline: string | null;
	status: string;
	role: string;
	is_owner: boolean;
	created_at: string;
	verification: string;
	member_count: number;
	face_user_ids: string[];
	pending_invites: number;
	active_projects: number;
	money_30d: { currency: string; minor: number }[];
	setup: { logo: boolean; bio: boolean; money: boolean };
	has_update: boolean;
}

/** One invitation addressed to the viewer, on the roster read. */
export interface RawIncomingInvite {
	id: string;
	entity_id: string;
	entity_name: string;
	entity_handle: string;
	entity_avatar_file_id: string | null;
	from_user_id: string;
	role_name: string;
	note: string | null;
	created_at: string;
	expires_at: string | null;
}

/** The whole roster read. */
export interface RawRoster {
	items: RawRosterItem[];
	invitations: RawIncomingInvite[];
	create_limit: number | null;
	create_used: number;
}

/** One active member on the detail read. */
export interface RawMember {
	id: string;
	user_id: string;
	role_id: string;
	role: string;
	status: string;
	granted: string[] | null;
	revoked: string[] | null;
	joined_at: string;
	title: string | null;
	reports_to: string | null;
	is_self: boolean;
	email: string | null;
	workload_current: number | null;
	workload_max: number | null;
	availability: string | null;
}

/** One role row on the detail read, capabilities already RESOLVED by `org.fn_role_capabilities`. */
export interface RawRole {
	id: string;
	name: string;
	summary: string | null;
	preset: string | null;
	base_preset: string;
	capabilities: string[] | null;
	member_count: number;
}

/** One outgoing invitation on the detail read (empty unless the viewer holds `invite_members`). */
export interface RawOutgoingInvite {
	id: string;
	target_user_id: string | null;
	target_handle: string | null;
	target_email: string | null;
	role_id: string;
	note: string | null;
	created_at: string;
	expires_at: string | null;
}

/** One project on the detail read. */
export interface RawProject {
	slug: string;
	title: string;
	status: string;
	client_business_id: string | null;
	owner_user_id: string | null;
	stage_name: string | null;
	stage_status: string | null;
	due: string | null;
	stages_total: number;
	stages_done: number;
}

/** One activity event on the detail read. */
export type RawActivity =
	| { kind: "member"; event: string; actor_user_id: string | null; at: string }
	| {
		kind: "money";
		event: string;
		actor_user_id: string | null;
		amount_minor: number;
		currency: string;
		at: string;
	};

/** The detail read when the caller may open the console. */
export interface RawDetail {
	status: "ok";
	id: string;
	name: string;
	handle: string;
	avatar_file_id: string | null;
	banner_file_id: string | null;
	headline: string | null;
	entity_status: string;
	owner_user_id: string;
	created_at: string;
	verification: string;
	viewer: { member_id: string; role_id: string; capabilities: string[] | null };
	members: RawMember[];
	roles: RawRole[];
	invites: RawOutgoingInvite[];
	standing: string | null;
	projects: RawProject[];
	activity: RawActivity[];
	setup: { logo: boolean; bio: boolean; invite: boolean; money: boolean };
}

/** Every answer `org.get_workspace_detail` can give. */
export type RawDetailAnswer = RawDetail | { status: "not_found" } | {
	status: "forbidden";
	id: string;
};

/** A person as the console shows them — the party-card projection a read resolved. */
export interface Person {
	username: string;
	name: string;
	/** The `sm` avatar URL, or `null` for the initials fallback. */
	avatar: string | null;
}

// #endregion

// #region Vocabulary parsing

/** A lifecycle status the SSOT knows; an unknown code reads as `draft` (the least-promising state). */
export function parseStatus(raw: string | null | undefined): WorkspaceStatus {
	const parsed = WorkspaceStatusEnum.safeParse(raw);
	return parsed.success ? parsed.data : "draft";
}

/** A verification state; anything unrecognised is `unverified` — never a claim the row did not make. */
export function parseVerification(raw: string | null | undefined): VerificationState {
	return raw === "verified" || raw === "pending" ? raw : "unverified";
}

/** A preset role, or `null` when the code is not one. */
export function parseRole(raw: string | null | undefined): WorkspaceRole | null {
	const parsed = WorkspaceRoleEnum.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

/** The recognised capabilities of a raw list, in enum order, de-duplicated. */
export function parseCapabilities(
	raw: readonly string[] | null | undefined,
): WorkspaceCapability[] {
	const set = new Set(raw ?? []);
	return WorkspaceCapabilityEnum.options.filter((c) => set.has(c));
}

/**
 * The coarse availability signal. `busy` — the value the freelancer profile actually stores alongside
 * `available` — is a limited signal, not an available one; any other unknown value (or none) reads
 * as `available`, the column's own default.
 */
export function availabilityOf(
	raw: string | null | undefined,
): "available" | "limited" | "unavailable" {
	switch (raw) {
		case "limited":
		case "busy":
			return "limited";
		case "unavailable":
		case "away":
			return "unavailable";
		default:
			return "available";
	}
}

/** Current commitment as a whole percentage of capacity, clamped 0–100; `0` with no capacity known. */
export function workloadPercent(
	current: number | null | undefined,
	max: number | null | undefined,
): number {
	const cur = Number(current ?? 0);
	const cap = Number(max ?? 0);
	if (!Number.isFinite(cur) || !Number.isFinite(cap) || cap <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round((100 * cur) / cap)));
}

// #endregion

// #region Money & time

/** A stored amount in its OWN currency — no conversion, so the view carries no origin. */
export function moneyOf(minor: number, currency: string): MoneyView {
	const code = (currency || "USD").trim().toUpperCase();
	const amount = Math.trunc(Number(minor) || 0);
	return { minor: amount, currency: code, display: formatMoney(amount, code), origin: null };
}

/**
 * The largest of several per-currency totals, compared in MAJOR units so a JPY figure is not read as a
 * hundred times a USD one. Never a converted sum: adding pounds to dollars is a figure nobody earned.
 */
export function largestAmount(
	amounts: readonly { currency: string; minor: number }[] | null | undefined,
): { currency: string; minor: number } | null {
	let best: { currency: string; minor: number } | null = null;
	let bestMajor = -Infinity;
	for (const a of amounts ?? []) {
		const minor = Number(a.minor) || 0;
		if (minor <= 0 || !a.currency) continue;
		const major = minor / 10 ** currencyExponent(a.currency);
		if (major > bestMajor) {
			best = { currency: a.currency.toUpperCase(), minor };
			bestMajor = major;
		}
	}
	return best;
}

const DAY_MS = 86_400_000;

/** `12 Aug`, or `12 Aug 2025` outside the current year — UTC, so SSR and a refetch agree. */
export function dateLabel(iso: string | null | undefined, nowMs: number): string {
	if (!iso) return "";
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	const sameYear = at.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
	return at.toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
		timeZone: "UTC",
	});
}

/**
 * A relative age ("2 days ago") against one per-request clock. Day granularity keeps the server's
 * answer and a client refetch a few seconds later in the same bucket; past eight weeks it is a date.
 */
export function relativeLabel(iso: string | null | undefined, nowMs: number): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const days = Math.floor(Math.max(0, nowMs - then) / DAY_MS);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days} days ago`;
	const weeks = Math.floor(days / 7);
	if (weeks <= 8) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
	return dateLabel(iso, nowMs);
}

/** An instant as ISO, or `""` when it does not parse. */
export function isoOf(raw: string | null | undefined): string {
	if (!raw) return "";
	const ms = Date.parse(raw);
	return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

// #endregion

// #region Roster

/** The Earned/Spent stat's value: the largest currency's figure, or an em dash when nothing moved. */
function periodValue(amounts: RawRosterItem["money_30d"]): string {
	const best = largestAmount(amounts);
	return best ? clamp(moneyOf(best.minor, best.currency).display, 24) : "—";
}

/**
 * The three stats a roster card carries, chosen per kind so each number means something: a team's
 * members · live projects · what it earned in 30 days; a business's members · live projects · what it
 * spent. `delta` is always `null` — no honest period-over-period comparison is recorded.
 */
export function rosterStats(
	kind: WorkspaceKind,
	item: Pick<RawRosterItem, "member_count" | "active_projects" | "money_30d">,
): WorkspaceStat[] {
	return [
		{ label: "Members", value: String(Number(item.member_count) || 0), delta: null },
		{ label: "Active projects", value: String(Number(item.active_projects) || 0), delta: null },
		{
			label: kind === "team" ? "Earned (30d)" : "Spent (30d)",
			value: periodValue(item.money_30d),
			delta: null,
		},
	];
}

/** Whether the viewer's plan admits another entity of this kind (`null` limit = unlimited). */
export function canCreateMore(
	limit: number | null | undefined,
	used: number | null | undefined,
): boolean {
	return limit === null || limit === undefined || (Number(used) || 0) < limit;
}

/** Why creating another entity is refused — the plan's own number, kind-worded — or `null`. */
export function createBlockedReason(
	kind: WorkspaceKind,
	limit: number | null | undefined,
	used: number | null | undefined,
): string | null {
	if (canCreateMore(limit, used)) return null;
	const n = Number(limit) || 0;
	const copy = kindCopy(kind);
	const noun = n === 1 ? copy.noun : copy.plural;
	return `Your plan includes ${n} ${noun} — archive one or upgrade to create another.`;
}

/** A face on the roster card's stack, from a resolved person. */
export function faceOf(person: Person | undefined): MemberFace | null {
	if (!person) return null;
	return {
		handle: clamp(person.username, 40),
		name: clampOr(person.name, 120, "Member"),
		avatar: avatarOf(person.avatar),
	};
}

/** An avatar URL that fits the projections' 400-character bound, else `""` (drawn as initials). */
export function avatarOf(url: string | null | undefined): string {
	return url && url.length <= 400 ? url : "";
}

// #endregion

// #region Setup checklist

/** The facts the Draft-First checklist is decided on. */
export interface SetupFacts {
	logo: boolean;
	bio: boolean;
	invite: boolean;
	money: boolean;
	verified: boolean;
}

/**
 * The "Finish setting up" checklist, worded by kind. Identity steps (mark, one-liner) are edited in the
 * entity's public profile editor — the media pipeline is the only door a picture may use — so they link
 * to `/@handle/edit`; the rest link to their console module.
 */
export function setupSteps(kind: WorkspaceKind, handle: string, facts: SetupFacts): SetupStep[] {
	const copy = kindCopy(kind);
	const edit = `/@${handle}/edit`;
	return [
		{
			id: "logo",
			label: "Add a mark",
			note: `A logo makes the ${copy.noun} recognisable everywhere it appears.`,
			done: facts.logo,
			href: edit,
		},
		{
			id: "bio",
			label: "Say what you do",
			note: "One line clients can scan before they decide to talk to you.",
			done: facts.bio,
			href: edit,
		},
		{
			id: "invite",
			label: "Invite someone",
			note: kind === "team"
				? "Two active members unlocks proposals — a solo team cannot bid."
				: "Bring in the people who will approve and spend alongside you.",
			done: facts.invite,
			href: workspaceHref(kind, handle, "invitations"),
		},
		{
			id: "money",
			label: kind === "team" ? "Set the split" : "Set an approval threshold",
			note: kind === "team"
				? "Decide how a release divides before the first one lands."
				: "A threshold and per-person limits keep the pooled wallet predictable.",
			done: facts.money,
			href: workspaceHref(kind, handle, kind === "team" ? "payouts" : "spend"),
		},
		{
			id: "verification",
			label: `Finish ${copy.verification}`,
			note: kind === "team"
				? "The owner's verified identity unlocks withdrawals from the vault."
				: "Verification unlocks the pooled wallet so you can hire.",
			done: facts.verified,
			href: workspaceHref(kind, handle, "verification"),
		},
	];
}

/** Completion 0–1 over the checklist (the same arithmetic as the SSOT's `setupProgress`). */
export function setupCompletion(steps: readonly SetupStep[]): number {
	if (steps.length === 0) return 1;
	return steps.filter((s) => s.done).length / steps.length;
}

/**
 * What clears the verification lock, or `null` once verified. A team's verification is its OWNER's
 * identity check (the person accountable for the team); a business's is the company's KYB.
 */
export function verificationPrompt(kind: WorkspaceKind, state: VerificationState): string | null {
	if (state === "verified") return null;
	if (kind === "team") {
		return state === "pending"
			? "The owner's identity check is under review — withdrawals unlock once it clears."
			: "Verify the owner's identity so the team can withdraw what it earns.";
	}
	return state === "pending"
		? "KYB is under review — the pooled wallet unlocks once it clears."
		: "Start KYB to unlock the pooled wallet and hire providers.";
}

// #endregion

// #region Roles & members

/** One role row as the SSOT carries it. */
export function toRoleDef(raw: RawRole): WorkspaceRoleDef {
	const preset = parseRole(raw.preset);
	const base = parseRole(raw.base_preset) ?? preset ?? "member";
	return {
		id: raw.id,
		name: clampOr(raw.name, 48, "Role"),
		summary: clamp(raw.summary, 160),
		preset,
		basePreset: base,
		capabilities: parseCapabilities(raw.capabilities),
		memberCount: Math.max(0, Number(raw.member_count) || 0),
	};
}

/** The preset a member RANKS as: the row's synced rank, else their role's base, else `member`. */
export function memberPreset(
	raw: Pick<RawMember, "role" | "role_id">,
	roles: readonly WorkspaceRoleDef[],
): WorkspaceRole {
	return parseRole(raw.role) ?? roles.find((r) => r.id === raw.role_id)?.basePreset ?? "member";
}

// #endregion

// #region Invitations

/** An outgoing invitation, with the invitee's public face when they are on the platform. */
export function toOutgoingInvite(
	raw: RawOutgoingInvite,
	person: Person | undefined,
	nowMs: number,
) {
	const email = raw.target_email ? clamp(raw.target_email, 160) : null;
	const handle = person?.username ?? raw.target_handle ?? "";
	return {
		id: raw.id,
		handle: clamp(handle, 40),
		name: clampOr(person?.name ?? email ?? (handle ? `@${handle}` : ""), 120, "Invitee"),
		avatar: avatarOf(person?.avatar),
		email,
		roleId: raw.role_id,
		note: raw.note ? clamp(raw.note, 400) : null,
		sentAt: clamp(relativeLabel(raw.created_at, nowMs), 40),
		expiresAt: raw.expires_at ? isoOf(raw.expires_at) || null : null,
	};
}

/** An invitation addressed to the viewer — the roster index's strip. */
export function toIncomingInvite(
	kind: WorkspaceKind,
	raw: RawIncomingInvite,
	from: Person | undefined,
	avatar: string,
	nowMs: number,
): IncomingInvite {
	return {
		id: raw.id,
		workspaceId: raw.entity_id,
		workspaceName: clampOr(raw.entity_name, 120, kindCopy(kind).Noun),
		workspaceHandle: clamp(raw.entity_handle, 40),
		workspaceAvatar: avatarOf(avatar),
		kind,
		fromName: clampOr(from?.name, 120, "A member"),
		fromHandle: clamp(from?.username, 40),
		roleLabel: clampOr(raw.role_name, 48, "Member"),
		sentAt: clamp(relativeLabel(raw.created_at, nowMs), 40),
	};
}

// #endregion

// #region Projects

const STAGE_LABEL: Readonly<Record<string, string>> = {
	open: "Open",
	assigned: "Assigned",
	in_progress: "In progress",
	submitted: "In review",
	approved: "Approved",
	revisions: "Revisions",
	paid: "Paid",
	cancelled: "Cancelled",
};

const PROJECT_LABEL: Readonly<Record<string, string>> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
	archived: "Archived",
};

/** A project's console state: live work, finished work, or everything not yet (or no longer) live. */
export function projectState(status: string | null | undefined): WorkspaceProject["state"] {
	if (status === "active" || status === "on_hold") return "active";
	if (status === "completed") return "completed";
	return "proposal";
}

/**
 * The short status word: the current stage's status while the project is active (it says where the
 * work is), else the project's own status.
 */
export function projectStatusLabel(
	status: string | null | undefined,
	stageStatus: string | null | undefined,
): string {
	if (status === "active" && stageStatus && STAGE_LABEL[stageStatus]) {
		return STAGE_LABEL[stageStatus];
	}
	return PROJECT_LABEL[status ?? ""] ?? "Project";
}

/** Completion 0–1: approved-or-paid stages over all stages. */
export function progressOf(
	done: number | null | undefined,
	total: number | null | undefined,
): number {
	const t = Number(total) || 0;
	if (t <= 0) return 0;
	return Math.max(0, Math.min(1, (Number(done) || 0) / t));
}

/** One project row, with its counterparty already resolved by the caller. */
export function toProject(
	raw: RawProject,
	counterparty: { name: string; avatar: string },
	nowMs: number,
): WorkspaceProject {
	return {
		id: clamp(raw.slug, 64),
		title: clampOr(raw.title, 160, "Untitled project"),
		href: clamp(`/projects/${raw.slug}`, 200),
		counterparty: clamp(counterparty.name, 120),
		counterpartyAvatar: avatarOf(counterparty.avatar),
		state: projectState(raw.status),
		statusLabel: clamp(projectStatusLabel(raw.status, raw.stage_status), 32),
		progress: progressOf(raw.stages_done, raw.stages_total),
		due: raw.due ? clamp(dateLabel(raw.due, nowMs), 40) || null : null,
	};
}

// #endregion

// #region Activity

const MONEY_VERB: Readonly<Record<string, string>> = {
	add_funds: "added",
	spend: "spent",
	distribute: "distributed",
	withdraw: "withdrew",
	transfer: "moved",
};

/** The one-line text of an activity event, e.g. "Priya Raman added $60,000.00". */
export function activityText(raw: RawActivity, actorName: string): string {
	if (raw.kind === "member") return `${actorName} joined`;
	const verb = MONEY_VERB[raw.event] ?? "moved";
	return `${actorName} ${verb} ${moneyOf(raw.amount_minor, raw.currency).display}`;
}

/** One activity line. */
export function toActivity(
	raw: RawActivity,
	index: number,
	person: Person | undefined,
	nowMs: number,
): ActivityEntry {
	const name = clampOr(person?.name, 120, "A member");
	return {
		id: clamp(`${raw.kind}-${raw.event}-${index}-${Date.parse(raw.at) || 0}`, 64),
		kind: raw.kind === "member" ? "member" : "money",
		text: clamp(activityText(raw, name), 200),
		actor: person ? name : null,
		actorAvatar: person ? avatarOf(person.avatar) || null : null,
		at: clamp(relativeLabel(raw.at, nowMs), 40),
		href: null,
	};
}

// #endregion

// #region Team split

/**
 * How a split reads. `equal` when every UNHELD stake among the given (active) stakes is within one
 * basis point of every other — an even split of 10 000 over three people is 3334/3333/3333, which is
 * still an equal split. Anything else is `custom`. Derived, never stored.
 */
export function deriveSplitModel(
	stakes: readonly { shareBp: number; held: boolean }[],
): SplitModel {
	const unheld = stakes.filter((s) => !s.held).map((s) => s.shareBp);
	if (unheld.length === 0) return "custom";
	return Math.max(...unheld) - Math.min(...unheld) <= 1 ? "equal" : "custom";
}

/**
 * An even split over the given members: `floor(10 000 / n)` each, with the integer remainder on the
 * owner so the total is exactly 10 000 (the owner absorbs dust everywhere else in the split model too).
 * When the owner is not among them the remainder lands on the first member.
 */
export function evenSplit(
	memberIds: readonly string[],
	ownerMemberId: string | null,
): { memberId: string; shareBp: number }[] {
	if (memberIds.length === 0) return [];
	const base = Math.floor(10_000 / memberIds.length);
	const remainder = 10_000 - base * memberIds.length;
	const target = ownerMemberId && memberIds.includes(ownerMemberId) ? ownerMemberId : memberIds[0];
	return memberIds.map((memberId) => ({
		memberId,
		shareBp: memberId === target ? base + remainder : base,
	}));
}

/**
 * What one stake receives from a members' pool — floored, exactly as `finance.fn_team_split_plan`
 * divides it, so a template's projection agrees with the plan the release runs.
 */
export function projectedShare(poolMinor: number, shareBp: number): number {
	const pool = Math.max(0, Math.trunc(Number(poolMinor) || 0));
	const bp = Math.max(0, Math.min(10_000, Math.trunc(Number(shareBp) || 0)));
	return Math.floor((pool * bp) / 10_000);
}

// #endregion

// #region Spend requests

/**
 * A spend request's state. The database's `rejected` is the SSOT's `declined`; a `pending` request
 * whose expiry has passed IS expired (the row is only re-stamped when somebody next decides it), so it
 * is never offered as decidable.
 */
export function spendRequestState(
	status: string | null | undefined,
	expiresAt: string | null | undefined,
	nowMs: number,
): "pending" | "approved" | "declined" | "expired" {
	switch (status) {
		case "approved":
			return "approved";
		case "rejected":
			return "declined";
		case "expired":
			return "expired";
		default: {
			const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
			return Number.isFinite(expiry) && expiry <= nowMs ? "expired" : "pending";
		}
	}
}

/**
 * Whether a spending-limit row's `spent` still counts. A period that has reset (`resets_at` passed on
 * a non-`total` limit) has spent nothing yet — the same rule `finance.request_spend_approval` applies.
 */
export function spentInPeriod(
	spent: number | null | undefined,
	period: string | null | undefined,
	resetsAt: string | null | undefined,
	nowMs: number,
): number {
	const value = Math.max(0, Number(spent) || 0);
	if (period === "total" || !resetsAt) return value;
	const at = Date.parse(resetsAt);
	return Number.isFinite(at) && at <= nowMs ? 0 : value;
}

/** Fraction of a ceiling consumed, 0–1; `0` for no ceiling. */
export function usedFraction(spent: number, limit: number | null | undefined): number {
	if (limit === null || limit === undefined || limit <= 0) return 0;
	return Math.max(0, Math.min(1, spent / limit));
}

// #endregion
