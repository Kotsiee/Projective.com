import type { JSX, VNode } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { AllRolesIcon, OwnerRoleIcon, WorkerRoleIcon } from "./glyphs.tsx";
import type { ProjectInvolvement } from "../types/projects-types.ts";

/**
 * RoleToggle — the ownership (involvement) switch at the head of the lane. It splits the acting user's
 * engagements along the authority axis, orthogonal to the Projects/Services tab:
 *
 *  - **All**      — no narrowing (the resting default).
 *  - **Owner**    — engagements the actor owns / commissions / administers (owner · client · admin).
 *                   Projects can be owned by an individual or a business.
 *  - **Working**  — engagements the actor performs work on as a freelancer / contributor.
 *
 * A freelancer who both owns projects (as a client) and works on other clients' projects switches
 * cleanly between the two. Rendered as one calm segmented control (a sliding highlight, not per-option
 * boxes — §B.4): a single-choice `radiogroup`; the active segment carries the tint. Now **icon-only**
 * (§B.6) so the involvement row never outgrows the narrow lane — each segment is a glyph described by a
 * floating `@projective/ui` {@link Tooltip} + `aria-label` (never a native `title`). Token-only + BEM.
 */

const SEGMENTS: readonly { value: ProjectInvolvement; label: string; tip: string; icon: VNode }[] =
	[
		{ value: "all", label: "All", tip: "Every engagement", icon: AllRolesIcon },
		{
			value: "owner",
			label: "Owner",
			tip: "Projects you own, commission, or administer",
			icon: OwnerRoleIcon,
		},
		{
			value: "worker",
			label: "Working",
			tip: "Projects you contribute work to",
			icon: WorkerRoleIcon,
		},
	];

export interface RoleToggleProps {
	value: ProjectInvolvement;
	onSelect: (value: ProjectInvolvement) => void;
}

export function RoleToggle({ value, onSelect }: RoleToggleProps): JSX.Element {
	return (
		<div class="proj-roletoggle" role="radiogroup" aria-label="Your involvement">
			{SEGMENTS.map((seg) => {
				const selected = value === seg.value;
				return (
					<Tooltip key={seg.value} content={seg.tip} placement="bottom">
						<button
							type="button"
							role="radio"
							aria-checked={selected}
							aria-label={seg.label}
							class="proj-roletoggle__seg"
							data-on={selected ? "true" : undefined}
							onClick={() => onSelect(seg.value)}
						>
							<span class="proj-roletoggle__icon" aria-hidden="true">{seg.icon}</span>
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}
