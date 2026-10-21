import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import type {
	InviteStatus,
	MemberPresence,
	MemberRole,
	SessionAttendance,
} from "../types/projects-types.ts";
import {
	ATTENDANCE_META,
	holdsAuthority,
	INVITE_STATUS_META,
	PRESENCE_META,
	roleMeta,
} from "../core/member-model.ts";
import { CrownIcon } from "./member-glyphs.tsx";

/**
 * Member roster atoms — the role line, the authority crown, the presence dot and the two lifecycle
 * tags. Zero-JS presentational components (the Tooltip/Tag they compose bundle their CSS through the
 * roster island's import).
 *
 * A role is what a person IS on the engagement, not a state, so it renders as text in the card's
 * headline register rather than a chip (DESIGN_SYSTEM §B.11); its access summary lives in the hover
 * Tooltip, never inline. Only an invitation's status and an attendee's standing — states that change —
 * take a container. Every hover target here is lifted above the card's stretched profile link by the
 * `mem-hint` class so the Tooltip can be reached.
 */

// #region Role
/**
 * The role as text, its access summary in the Tooltip. A delegated project manager the business client
 * let manage tickets (Decision #294) carries that as inline secondary text after the role — a fact
 * about the seat, not a control, so never a chip.
 */
export function RoleText(
	{ role, managesTickets = false }: { role: MemberRole; managesTickets?: boolean },
): JSX.Element {
	const meta = roleMeta(role);
	return (
		<>
			<Tooltip content={meta.blurb} placement="top">
				<span class="mem-hint mem-role">{meta.label}</span>
			</Tooltip>
			{managesTickets && (
				<>
					<span class="mem-dot" aria-hidden="true">·</span>
					<span class="mem-role-note">Manages tickets</span>
				</>
			)}
		</>
	);
}

/**
 * The authority crown beside an owner's or client's name — the roster's one distinct accent, so the
 * person with final say is found at a glance. Renders nothing for any other role.
 */
export function AuthorityMark(
	{ role, label: given }: {
		role: MemberRole;
		/** The crown's words where the roster is not a project's ("Team owner"). */
		label?: string;
	},
): JSX.Element | null {
	if (!holdsAuthority(role)) return null;
	const label = given ??
		(role === "owner" ? "Project owner" : "Client — commissioned this project");
	return (
		<Tooltip content={label} placement="top">
			<span class="mem-hint mem-crown" role="img" aria-label={label}>
				<CrownIcon />
			</span>
		</Tooltip>
	);
}
// #endregion

// #region Presence
/** A tonal presence dot (icon-only) — the label lives only in its hover Tooltip. */
export function PresenceDot(
	{ presence, label: given }: {
		presence: MemberPresence;
		/** The dot's words where its tone means something else (a team member's availability). */
		label?: string;
	},
): JSX.Element {
	const label = given ?? PRESENCE_META[presence].label;
	return (
		<Tooltip content={label} placement="top">
			<span
				class="mem-hint mem-presence"
				data-presence={presence}
				role="img"
				aria-label={label}
			/>
		</Tooltip>
	);
}
// #endregion

// #region Lifecycle tags
/** An invitation's lifecycle status — a state that changes, so it may take a container. */
export function InviteStatusTag({ status }: { status: InviteStatus }): JSX.Element {
	const meta = INVITE_STATUS_META[status];
	return (
		<Tooltip content={meta.blurb} placement="top">
			<span class="mem-hint">
				<Tag
					value={meta.label}
					severity={meta.severity}
					variant="subtle"
					rounded
					class="mem-status"
				/>
			</span>
		</Tooltip>
	);
}

/** A session attendee's standing on the sittings. */
export function AttendanceTag({ attendance }: { attendance: SessionAttendance }): JSX.Element {
	const meta = ATTENDANCE_META[attendance];
	return (
		<Tooltip content={meta.blurb} placement="top">
			<span class="mem-hint">
				<Tag
					value={meta.label}
					severity={meta.severity}
					variant="subtle"
					rounded
					class="mem-status"
				/>
			</span>
		</Tooltip>
	);
}
// #endregion
