import type { JSX, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { Icon, type IconName } from "@projective/ui/icons";
import { LaneCreateMenu, type LaneCreateMenuItem } from "@projective/ui/navigation";
import { PROJECT_TYPE_LABEL, ProjectTypeChoice } from "../types/projects-types.ts";

/**
 * CreateMenu — the lane's Create project trigger and the {@link LaneCreateMenu} it opens.
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
	open: Signal<boolean>;
	/** The trigger's glyph. */
	icon: VNode;
	onPick: (kind: ProjectTypeChoice) => void;
}

/** Render the Create project trigger; each choice picks a preselected type for the create modal. */
export function CreateMenu({ open, icon, onPick }: CreateMenuProps): JSX.Element {
	const items: LaneCreateMenuItem[] = CREATE_OPTIONS.map((kind) => ({
		key: kind,
		label: PROJECT_TYPE_LABEL[kind],
		icon: <Icon name={TYPE_ICON[kind]} size="md" />,
		onSelect: () => onPick(kind),
	}));
	return <LaneCreateMenu open={open} label="Create project" icon={icon} items={items} />;
}
