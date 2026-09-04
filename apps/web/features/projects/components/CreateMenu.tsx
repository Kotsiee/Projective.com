import type { JSX, VNode } from "preact";
import { FormatGlyph } from "./glyphs.tsx";
import type { ProjectCreateFormat } from "../types/projects-types.ts";

/**
 * CreateMenu — the contents of the lane's Create (`+`) popover.
 *
 * Every option launches the same Quick-Init modal and differs only in which work-flow it preselects,
 * so `kind` is the {@link ProjectCreateFormat} SSOT enum rather than a free string. That is the whole
 * point of the narrowing: the previous `kind: string` was folded by the caller with
 * `kind === "one_off" ? "one_off" : "pipeline"`, so every value that was not literally `one_off`
 * — including two options labelled as services — silently produced a pipeline project. A wrong kind
 * is now a compile error instead of a surface that quietly builds the wrong thing.
 *
 * Kept dumb: the parent island owns the modal, so this is a list of choices and nothing else.
 */

export interface CreateOption {
	kind: ProjectCreateFormat;
	label: string;
	hint: string;
	icon: VNode;
}

/**
 * The two commissionable work-flows.
 *
 * There is no service or session entry. A session is a SERVICE a freelancer sells, not a project a
 * client posts — it is authored provider-side in the catalogue composer and only ever reaches
 * `projects.projects` by instantiation — so offering one here would mint an engagement with no
 * seller and no schedule.
 */
const CREATE_OPTIONS: readonly CreateOption[] = [
	{
		kind: "pipeline",
		label: "New project",
		hint: "Ongoing work, ticket by ticket",
		icon: <FormatGlyph format="pipeline" />,
	},
	{
		kind: "one_off",
		label: "Quick brief",
		hint: "One fixed deliverable, one price",
		icon: <FormatGlyph format="one_off" />,
	},
];

export interface CreateMenuProps {
	onPick: (kind: ProjectCreateFormat) => void;
}

/** Render the create choices; each picks a preselected work-flow for the Quick-Init modal. */
export function CreateMenu({ onPick }: CreateMenuProps): JSX.Element {
	return (
		<div class="proj-create" role="menu" aria-label="Create">
			<span class="proj-create__head">Create</span>
			{CREATE_OPTIONS.map((opt) => (
				<button
					key={opt.kind}
					type="button"
					role="menuitem"
					class="proj-create__item"
					onClick={() => onPick(opt.kind)}
				>
					<span class="proj-create__icon" aria-hidden="true">{opt.icon}</span>
					<span class="proj-create__text">
						<span class="proj-create__label">{opt.label}</span>
						<span class="proj-create__hint">{opt.hint}</span>
					</span>
				</button>
			))}
		</div>
	);
}
