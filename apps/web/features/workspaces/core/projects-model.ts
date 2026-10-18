import { type ProposalAllowanceStatus, TEAM_PROPOSAL_MIN_MEMBERS } from "@projective/types/finance";
import type { SentApplication } from "@projective/types/projects";
import type {
	EngagementAssignee,
	TeamEngagement,
	WorkspaceStatus,
} from "@projective/types/workspace";

/**
 * projects-model — every rule a team console's Projects module composes (Teams work order C5), as pure
 * functions over the server's read: the allowance band and its gate, one engagement row per live stage
 * assignment with each assignee's Wᵢ readout, and the team's pending proposals.
 *
 * The island only paints what this returns, so the rules the module is judged by — the band carries at
 * most ONE filled control, a gate names the fix the viewer can actually make, a Wᵢ warning is words and
 * never colour alone, only a filer or a `bind_seat` holder is offered Withdraw — are unit-tested here
 * (`projects-model.test.ts`). Nothing here guesses a fact: the team's status, head-count and the
 * viewer's `bind_seat` are the allowance read's (`finance.get_proposal_allowance`, folded into
 * `org.get_workspace_detail` by B7, Decision #233), every Wᵢ figure is the read's live sum, and a
 * figure the read did not answer renders as absent.
 *
 * CSS-free and DOM-free (no `@projective/ui` barrel, no dev seam), so `deno test` loads it directly.
 * Teams only: a business's Projects still hands off to `/projects` (Decision #61 — one implementation,
 * team-only rules gated on the kind by the dispatcher).
 */

// #region Shared
/** Where a team with nothing on its books goes to find work: Explore, narrowed to projects. */
export const FIND_PROJECTS_HREF = "/explore?category=projects";

/** The engagement's address — `/projects/prj-…` (Decision #88: a slug, opaque, only encoded). */
export function projectHref(projectSlug: string): string {
	return `/projects/${encodeURIComponent(projectSlug)}`;
}

/**
 * The stage's address — the project's channel namespace, `/projects/prj-…/stg-…`, which resolves a
 * `stg-` segment to the stage itself (Decision #93).
 */
export function stageHref(projectSlug: string, stageSlug: string): string {
	return `${projectHref(projectSlug)}/${encodeURIComponent(stageSlug)}`;
}

/**
 * A Wᵢ figure as the readout prints it: at most two decimals, trailing zeros dropped (`3`, `2.5`,
 * `7.25`). Locale-free on purpose — the server and the client must print the same byte.
 */
export function formatWi(value: number): string {
	if (!Number.isFinite(value)) return "0";
	return String(Number(Math.max(0, value).toFixed(2)));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/** The UTC weekday of an instant (`Mon`), or `null` for an unreadable one. */
export function utcWeekday(iso: string): string | null {
	const at = Date.parse(iso);
	return Number.isFinite(at) ? WEEKDAYS[new Date(at).getUTCDay()] : null;
}

/** The UTC day and month of an instant (`12 Oct`), or `null` for an unreadable one. */
export function utcDayMonth(iso: string): string | null {
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return null;
	const day = new Date(at);
	return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

/** `1 stage` · `3 stages`. */
function counted(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}
// #endregion

// #region The allowance band — its gate
/** Why the team cannot send proposals, as the band names it. `null` — nothing team-level stands in the way. */
export type BandGateReason = "team_not_active" | "team_too_small";

/**
 * The band's one control, when the gate has a fix the viewer can make: a tier-4 outlined link to
 * Settings (where a draft team is published), or the tier-2 monochrome Invite member — the band's one
 * filled control, because adding the second member IS the band's structural commit (§B.8.1).
 */
export type BandAction =
	| { key: "settings"; tier: 4; filled: false; label: string; href: string }
	| { key: "invite"; tier: 2; filled: true; label: string };

/** The gate the band draws under its meter. */
export interface BandGate {
	reason: BandGateReason | null;
	/** The InlineNotice sentence, when a team-level gate applies. */
	notice: string | null;
	/** The fix, when the viewer may make it; `null` otherwise — never a control that would only refuse. */
	action: BandAction | null;
	/**
	 * The viewer-level fact — they may not bind the team (`bind_seat`), so somebody else applies — said
	 * as Meta text, never as a control. Only once no team-level gate applies: the team's own fix comes
	 * first, and "ask a lead" means nothing while no lead could apply either.
	 */
	viewerNote: string | null;
}

/** What the gate is decided from — the allowance read's facts and the viewer's two rights. */
export interface BandGateInput {
	/** `allowance.teamStatus`. */
	status: WorkspaceStatus | null;
	/** `allowance.teamMemberCount` — active members. */
	members: number | null;
	/** `allowance.canBindSeat` — whether the VIEWER may bind the team to work. */
	canBindSeat: boolean | null;
	/** `invite_members` — Invite member does something for this viewer. */
	canInvite: boolean;
	/** `manage_settings` — the Settings module opens for this viewer (where Publish lives). */
	canOpenSettings: boolean;
	/** The team's Settings module address. */
	settingsHref: string;
}

/** The draft team's sentence (Teams C5's wording). */
export const BAND_DRAFT_NOTICE = "Publish the team to send proposals.";
/** The archived team's sentence: an archived team is restored, not published (Decision #250). */
export const BAND_ARCHIVED_NOTICE = "Restore the team to send proposals.";
/** The one-member team's sentence. */
export const BAND_TOO_SMALL_NOTICE =
	`A team needs at least ${TEAM_PROPOSAL_MIN_MEMBERS} active members to send proposals.`;
/** The viewer without `bind_seat` (Teams C5's wording). */
export const BAND_ASK_A_LEAD = "Ask a lead to apply for the team";

/**
 * The band's gate, in `projects.fn_assert_team_can_apply`'s team order — a published team, then two
 * members — with the viewer's own `bind_seat` after them:
 *
 *   - **not `active`** → "Publish the team to send proposals" (an archived team: "Restore …") and a
 *     tier-4 link to Settings for a viewer who may open it;
 *   - **fewer than two active members** → the sentence and the tier-2 Invite member for a viewer who
 *     may invite — the band's one filled control;
 *   - **otherwise**, a viewer without `bind_seat` → Meta "Ask a lead to apply for the team".
 *
 * So the band holds exactly one filled control (a sub-two team, viewed by an inviter) or none.
 */
export function bandGate(input: BandGateInput): BandGate {
	if (input.status !== null && input.status !== "active") {
		return {
			reason: "team_not_active",
			notice: input.status === "archived" ? BAND_ARCHIVED_NOTICE : BAND_DRAFT_NOTICE,
			action: input.canOpenSettings
				? {
					key: "settings",
					tier: 4,
					filled: false,
					label: "Open settings",
					href: input.settingsHref,
				}
				: null,
			viewerNote: null,
		};
	}
	if (input.members !== null && input.members < TEAM_PROPOSAL_MIN_MEMBERS) {
		return {
			reason: "team_too_small",
			notice: BAND_TOO_SMALL_NOTICE,
			action: input.canInvite
				? { key: "invite", tier: 2, filled: true, label: "Invite member" }
				: null,
			viewerNote: null,
		};
	}
	return {
		reason: null,
		notice: null,
		action: null,
		viewerNote: input.canBindSeat === false ? BAND_ASK_A_LEAD : null,
	};
}

/** How many filled controls a gate puts in the band — 0 or 1, never more. */
export function bandFilledCount(gate: BandGate): number {
	return gate.action?.filled ? 1 : 0;
}
// #endregion

// #region The allowance band — its meter
/** The weekly meter. */
export interface AllowanceMeter {
	used: number;
	total: number;
	/** The ProgressBar's fill, 0–100. */
	percent: number;
	/** `12 / 50` — the visible, tabular figure. */
	figure: string;
	/** `12 of 50 proposals used this week` — the bar's accessible name. */
	label: string;
}

/** The band. */
export interface AllowanceBandModel {
	/** "Proposals this week". */
	title: string;
	/** `null` when the read answered no allowance. */
	meter: AllowanceMeter | null;
	/**
	 * The MetaLine facts: the anti-burst buffer and the weekly refill day. The pool's OWNER is not
	 * named: whether a team's proposals draw on a dedicated pool or on its members' is still open
	 * (Decision #154 flag (b), TEAMS_AUDIT A6), so the band shows the read's numbers and no label.
	 */
	meta: string[];
	gate: BandGate;
	/** Said instead of a meter when the read answered no allowance — never a guessed figure. */
	unavailable: string | null;
}

/** The band's inputs: the read's allowance (simulated or not) and the viewer's two rights. */
export interface AllowanceBandInput {
	allowance: ProposalAllowanceStatus | null;
	canInvite: boolean;
	canOpenSettings: boolean;
	settingsHref: string;
}

/** What the band says when the read answered no allowance. */
export const ALLOWANCE_UNAVAILABLE = "The team's proposal allowance couldn't be read just now.";

/** The weekly meter of a status — units used against the week's grant. */
export function allowanceMeter(status: ProposalAllowanceStatus): AllowanceMeter {
	const used = Math.max(0, status.weeklyConsumed);
	const total = Math.max(0, status.weeklyGranted);
	const percent = total > 0 ? Math.min(100, (used / total) * 100) : used > 0 ? 100 : 0;
	return {
		used,
		total,
		percent,
		figure: `${used} / ${total}`,
		label: `${used} of ${total} proposals used this week`,
	};
}

/** The band, decided. */
export function allowanceBand(input: AllowanceBandInput): AllowanceBandModel {
	const title = "Proposals this week";
	const status = input.allowance;
	if (!status) {
		return {
			title,
			meter: null,
			meta: [],
			gate: { reason: null, notice: null, action: null, viewerNote: null },
			unavailable: ALLOWANCE_UNAVAILABLE,
		};
	}
	const refill = utcWeekday(status.weeklyResetsAt);
	return {
		title,
		meter: allowanceMeter(status),
		meta: [
			status.bufferCap > 0 ? `buffer ${status.bufferUnits}/${status.bufferCap}` : null,
			refill ? `refills ${refill}` : null,
		].filter((fact): fact is string => fact !== null),
		gate: bandGate({
			status: status.teamStatus,
			members: status.teamMemberCount,
			canBindSeat: status.canBindSeat,
			canInvite: input.canInvite,
			canOpenSettings: input.canOpenSettings,
			settingsHref: input.settingsHref,
		}),
		unavailable: null,
	};
}
// #endregion

// #region Engagements
/** A `Tag` tone the row's lifecycle status may take. */
export type EngagementTone = "success" | "info" | "warning" | "secondary";

/** The row's lifecycle status as a `Tag`'s words and tone. */
export interface EngagementStatus {
	label: string;
	severity: EngagementTone;
}

/**
 * The row's lifecycle status. A project on hold pauses every seat on it, so that wins; otherwise the
 * seat's own `stage_assignments.status` (PRODUCT_MANAGEMENT — Stage assignment: `pending_funding` →
 * `assigned` → `accepted`). The column is free text, so an unrecognised value falls to a neutral word
 * rather than claiming a state.
 */
export function engagementStatus(
	engagement: Pick<TeamEngagement, "assignmentStatus" | "projectStatus">,
): EngagementStatus {
	if (engagement.projectStatus === "on_hold") return { label: "On hold", severity: "warning" };
	switch (engagement.assignmentStatus) {
		case "accepted":
			return { label: "Accepted", severity: "success" };
		case "assigned":
			return { label: "Assigned", severity: "info" };
		case "pending_funding":
			return { label: "Awaiting funding", severity: "warning" };
		default:
			return { label: "Seated", severity: "secondary" };
	}
}

/** One assignee's Wᵢ on the stage. */
export interface AssigneeReadout {
	handle: string;
	name: string;
	avatar: string | null;
	/** `3 / 10` against the stage's per-person cap, or `3` when the stage sets none. */
	readout: string;
	/** The ProgressBar's fill against the stage cap, 0–100; `null` when there is no cap to size it to. */
	percent: number | null;
	/** The bar's accessible name — words, not the `Wᵢ` glyph. */
	barLabel: string;
	/**
	 * The warning for a member at or over their GLOBAL cap (the soft cap a claim is measured against),
	 * as words — the bar's colour never changes, so this sentence is the whole signal.
	 */
	softCap: string | null;
}

/**
 * One assignee's readout. The bar is sized to the stage's per-person hard cap; a stage cannot be over
 * it (the database refuses the claim), so no over-cap state is drawn — the fill is clamped all the
 * same. The soft-cap warning reads the member's global load (`wi` over `wiCap`).
 */
export function assigneeReadout(
	assignee: EngagementAssignee,
	stageCap: number | null,
): AssigneeReadout {
	const name = assignee.displayName || `@${assignee.handle}`;
	const stage = formatWi(assignee.stageWi);
	const cap = stageCap !== null && stageCap > 0 ? stageCap : null;
	const global = `${formatWi(assignee.wi)} / ${formatWi(assignee.wiCap)}`;
	return {
		handle: assignee.handle,
		name,
		avatar: assignee.avatarUrl || null,
		readout: cap !== null ? `${stage} / ${formatWi(cap)}` : stage,
		percent: cap !== null ? Math.min(100, (Math.max(0, assignee.stageWi) / cap) * 100) : null,
		barLabel: cap !== null
			? `${name}: ${stage} of ${formatWi(cap)} workload on this stage`
			: `${name}: ${stage} workload on this stage`,
		softCap: assignee.wi > assignee.wiCap
			? `Over their workload cap — ${global} across all work`
			: assignee.wi === assignee.wiCap
			? `At their workload cap — ${global} across all work`
			: null,
	};
}

/** One engagement row. */
export interface EngagementRowModel {
	/** Stable key — one live seat per team per stage. */
	key: string;
	projectTitle: string;
	projectHref: string;
	stageTitle: string;
	stageHref: string;
	status: EngagementStatus;
	/** The AvatarStack's people, heaviest first (the read's order). */
	faces: { name: string; avatar: string | null }[];
	/** The stage's facts: the team's Wᵢ on it and the per-person cap. */
	meta: string[];
	assignees: AssigneeReadout[];
	/** Said instead of readouts when nobody on the team holds a live ticket on the stage. */
	idle: string | null;
}

/** What a row with no live tickets says. */
export const ENGAGEMENT_IDLE = "Nobody on the team holds a live ticket on this stage yet.";

/** One live stage assignment as its row. */
export function engagementRow(engagement: TeamEngagement): EngagementRowModel {
	const cap = engagement.stageCap !== null && engagement.stageCap > 0 ? engagement.stageCap : null;
	const assignees = engagement.assignees.map((a) => assigneeReadout(a, cap));
	return {
		key: `${engagement.projectSlug}/${engagement.stageSlug}`,
		projectTitle: engagement.title,
		projectHref: projectHref(engagement.projectSlug),
		stageTitle: engagement.stageTitle,
		stageHref: stageHref(engagement.projectSlug, engagement.stageSlug),
		status: engagementStatus(engagement),
		faces: assignees.map((a) => ({ name: a.name, avatar: a.avatar })),
		meta: [
			`team Wᵢ ${formatWi(engagement.stageWi)}`,
			cap !== null ? `cap ${formatWi(cap)} per person` : "no stage cap",
		],
		assignees,
		idle: assignees.length === 0 ? ENGAGEMENT_IDLE : null,
	};
}

/** The Active view's facts — how many live stages, across how many projects. Empty with none. */
export function engagementsSummary(engagements: readonly TeamEngagement[]): string[] {
	if (engagements.length === 0) return [];
	const projects = new Set(engagements.map((e) => e.projectSlug)).size;
	return [counted(engagements.length, "stage", "stages"), counted(projects, "project", "projects")];
}
// #endregion

// #region Proposals
/** One pending proposal row. */
export interface ProposalRowModel {
	id: string;
	title: string;
	href: string;
	/** Stage · role · when it was sent. */
	meta: string[];
	/** The row's one action — the tier-5 Withdraw — offered only to the filer or a `bind_seat` holder. */
	canWithdraw: boolean;
}

/**
 * The team's proposals awaiting a client's answer, newest first: pending applications filed FOR the
 * team (whoever filed them). The read is already narrowed to the team (`list_my_applications`'
 * `p_team`); the filter is repeated here so a read that was not narrowed can never show a personal
 * proposal on a team's page. Withdraw is the server's `canWithdraw` — the filer, or a member holding
 * `bind_seat` (Decision #154) — and only while pending.
 */
export function teamProposals(
	rows: readonly SentApplication[],
	teamId: string,
): ProposalRowModel[] {
	return rows
		.filter((r) => r.status === "pending" && r.applicantType === "team" && r.teamId === teamId)
		.slice()
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
		.map((r) => {
			const sent = utcDayMonth(r.createdAt);
			return {
				id: r.id,
				title: r.projectTitle,
				href: projectHref(r.projectSlug),
				meta: [r.stageName ?? r.stageSlug, r.roleTitle, sent ? `sent ${sent}` : null].filter(
					(fact): fact is string => !!fact,
				),
				canWithdraw: r.canWithdraw,
			};
		});
}

/** The Proposals view's fact line — how many await an answer. Empty with none. */
export function proposalsSummary(rows: readonly ProposalRowModel[]): string[] {
	return rows.length === 0 ? [] : [`${rows.length} awaiting a reply`];
}
// #endregion
