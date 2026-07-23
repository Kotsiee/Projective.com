import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import type { MemberPresence, MemberRole, StageAssignment } from "../types/projects-types.ts";
import { ASSIGNMENT_META, PRESENCE_META, roleMeta } from "../core/member-model.ts";
import { ContributorIcon } from "./member-glyphs.tsx";
import { EyeIcon } from "./glyphs.tsx";

/**
 * Member roster badge atoms — the role tag, the icon-only presence dot, and the stage-assignment tag.
 * Zero-JS presentational server components (the Tooltip/Tag they compose bundle their own CSS through
 * this feature's roster island import). Icon-only signals carry a portal Tooltip + `aria-label`, never
 * a native `title` (DESIGN_SYSTEM §B.6); the role/assignment tags already carry a visible label.
 */

// #region Role badge
/** The access-role badge — a subtle tinted tag whose access summary is revealed on hover. */
export function MemberRoleBadge({ role }: { role: MemberRole }): JSX.Element {
	const meta = roleMeta(role);
	return (
		<Tooltip content={meta.blurb} placement="top">
			<Tag
				value={meta.label}
				severity={meta.severity}
				variant="subtle"
				rounded
				class="mem-rolebadge"
			/>
		</Tooltip>
	);
}
// #endregion

// #region Presence dot
/** A tonal presence dot (icon-only) — the label lives only in its hover Tooltip. */
export function PresenceDot({ presence }: { presence: MemberPresence }): JSX.Element {
	const meta = PRESENCE_META[presence];
	return (
		<Tooltip content={meta.label} placement="top">
			<span
				class="mem-presence"
				data-presence={presence}
				role="img"
				aria-label={meta.label}
			/>
		</Tooltip>
	);
}
// #endregion

// #region Assignment tag
/** The Assigned-Contributor / Observer marker for a stage channel (task §1.2). */
export function AssignmentTag({ assignment }: { assignment: StageAssignment }): JSX.Element {
	const meta = ASSIGNMENT_META[assignment];
	const icon = assignment === "contributor" ? ContributorIcon : EyeIcon;
	return (
		<Tag
			value={meta.label}
			severity={meta.severity}
			variant="subtle"
			icon={icon}
			class="mem-assigntag"
		/>
	);
}
// #endregion
