import type { JSX } from "preact";
import { type LaneToggleOption, LaneToggleRow } from "@projective/ui/navigation";
import { HourglassIcon, MailIcon, RevisionIcon, StarIcon, TicketIcon } from "./glyphs.tsx";
import type { ProjectQuickFilter } from "../types/projects-types.ts";

/**
 * UtilityShortcuts — the permanent quick-filter row that sits right above the content list. The
 * high-frequency involvement modifiers (Starred · Unread · New tickets · Revision requested · Pending
 * review) are icon-only toggles for instantaneous feedback.
 *
 * A thin domain adapter over the shared `@projective/ui/navigation` {@link LaneToggleRow}: the quiet
 * circular hover, the engaged `--primary` tint + glyph fill, and the portal Tooltip all come from the
 * package, so this row and the `/messages` quick filters are ONE control (§B.6 icon-first).
 */

/** The permanent quick-filter toggles, in display order. */
const QUICK_TOGGLES: readonly LaneToggleOption<ProjectQuickFilter>[] = [
	{ key: "starred", label: "Starred", icon: StarIcon },
	{ key: "unread", label: "Unread", icon: MailIcon },
	{ key: "new_ticket", label: "New tickets", icon: TicketIcon },
	{ key: "revision_requested", label: "Revision requested", icon: RevisionIcon },
	{ key: "pending_review", label: "Pending review", icon: HourglassIcon },
];

export interface UtilityShortcutsProps {
	quick: readonly ProjectQuickFilter[];
	onToggleQuick: (key: ProjectQuickFilter) => void;
}

export function UtilityShortcuts(props: UtilityShortcutsProps): JSX.Element {
	return (
		<LaneToggleRow
			label="Quick filters"
			options={QUICK_TOGGLES}
			active={props.quick}
			onToggle={props.onToggleQuick}
		/>
	);
}
