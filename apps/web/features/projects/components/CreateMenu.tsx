import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	PROJECT_TYPE_HINT,
	PROJECT_TYPE_LABEL,
	ProjectTypeChoice,
} from "../types/projects-types.ts";

/**
 * CreateMenu — the contents of the lane's Create (`+`) popover.
 *
 * Every option launches the same {@link ProjectCreateModal} and differs only in which type it
 * preselects, so `kind` is the {@link ProjectTypeChoice} SSOT enum rather than a free string. That is
 * the whole point of the narrowing: this was once a `kind: string` that the caller folded with
 * `kind === "one_off" ? "one_off" : "pipeline"`, so every value that was not literally `one_off` —
 * including two options labelled as services — silently produced a pipeline project. A wrong kind is
 * a compile error now instead of a surface that quietly builds the wrong thing.
 *
 * Three entries, not two. The menu used to offer "New project" and "Quick brief" — two labels for
 * two of the three things a client can actually commission, with the third (a Task) reachable only
 * from a seller's profile. The rows now name the three types themselves, which is the same
 * vocabulary the modal, the settings selector and the feed card all use.
 *
 * There is no service or session entry. A session is a SERVICE a freelancer sells — authored
 * provider-side in the catalogue composer, reaching `projects.projects` only by instantiation — so
 * offering one here would mint an engagement with no seller and no schedule.
 *
 * Kept dumb: the parent island owns the modal, so this is a list of choices and nothing else.
 */

/** The glyph each type leads with — the registry's own, never a hand-authored `<svg>` (§B.7). */
const TYPE_ICON: Record<ProjectTypeChoice, IconName> = {
	task: "ticket",
	one_off: "submission",
	pipeline: "stages",
};

/** Derived from the SSOT enum's own members, so a fourth type could never go unofferable here. */
const CREATE_OPTIONS: readonly ProjectTypeChoice[] = ProjectTypeChoice.options;

export interface CreateMenuProps {
	onPick: (kind: ProjectTypeChoice) => void;
}

/** Render the create choices; each picks a preselected type for the create modal. */
export function CreateMenu({ onPick }: CreateMenuProps): JSX.Element {
	return (
		<div class="proj-create" role="menu" aria-label="Create">
			<span class="proj-create__head">Create</span>
			{CREATE_OPTIONS.map((kind) => (
				<button
					key={kind}
					type="button"
					role="menuitem"
					class="proj-create__item"
					onClick={() => onPick(kind)}
				>
					<span class="proj-create__icon" aria-hidden="true">
						<Icon name={TYPE_ICON[kind]} size="md" />
					</span>
					<span class="proj-create__text">
						<span class="proj-create__label">{PROJECT_TYPE_LABEL[kind]}</span>
						<span class="proj-create__hint">{PROJECT_TYPE_HINT[kind]}</span>
					</span>
				</button>
			))}
		</div>
	);
}
