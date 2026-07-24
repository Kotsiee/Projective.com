import type { JSX } from "preact";
import { type LaneToggleOption, LaneToggleRow } from "@projective/ui/navigation";
import { MailIcon, RevisionIcon, StarIcon, TicketIcon } from "./glyphs.tsx";

/**
 * ChannelQuickFilters — a compact, icon-ONLY toggle row sitting between the project header and the
 * channel-tree divider. Each button narrows the tree below to a facet. Toggles combine with OR —
 * turning several on widens the match set. Dumb: the island owns the active set and re-derives the
 * filtered tree.
 *
 * A domain adapter over the shared `@projective/ui/navigation` {@link LaneToggleRow}, so this row, the
 * `/projects` feed shortcuts, and the `/messages` quick filters are ONE control (§B.6 icon-first: no
 * text labels, a portal Tooltip carries the name).
 */

/** The four channel facets the row can toggle. */
export type ChannelFilterKey = "starred" | "unread" | "tickets" | "revisions";

const FILTERS: readonly LaneToggleOption<ChannelFilterKey>[] = [
	{ key: "starred", label: "Starred", icon: StarIcon },
	{ key: "unread", label: "Unread", icon: MailIcon },
	{ key: "tickets", label: "New tickets", icon: TicketIcon },
	{ key: "revisions", label: "Revisions", icon: RevisionIcon },
];

export interface ChannelQuickFiltersProps {
	/** Currently-active facets. */
	active: ChannelFilterKey[];
	onToggle: (key: ChannelFilterKey) => void;
}

export function ChannelQuickFilters(
	{ active, onToggle }: ChannelQuickFiltersProps,
): JSX.Element {
	return (
		<LaneToggleRow
			label="Filter channels"
			options={FILTERS}
			active={active}
			onToggle={onToggle}
		/>
	);
}
