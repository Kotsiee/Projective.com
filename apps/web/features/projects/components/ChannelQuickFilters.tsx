import type { JSX, VNode } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { MailIcon, RevisionIcon, StarIcon, TicketIcon } from "./glyphs.tsx";

/**
 * ChannelQuickFilters — a compact, icon-ONLY toggle row sitting between the project header and the
 * channel-tree divider. Each button narrows the tree below to a facet (§B.6 icon-first: no text labels,
 * a portal {@link Tooltip} carries the name). Toggles combine with OR — turning several on widens the
 * match set. Dumb: the island owns the active set and re-derives the filtered tree.
 */

/** The four channel facets the row can toggle. */
export type ChannelFilterKey = "starred" | "unread" | "tickets" | "revisions";

interface FilterDef {
	key: ChannelFilterKey;
	label: string;
	icon: VNode;
}

const FILTERS: readonly FilterDef[] = [
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
		<div class="proj-qfilters" role="group" aria-label="Filter channels">
			{FILTERS.map((f) => {
				const on = active.includes(f.key);
				return (
					<Tooltip key={f.key} content={f.label} placement="bottom">
						<button
							type="button"
							class="proj-qfilter"
							data-on={on ? "true" : undefined}
							aria-pressed={on}
							aria-label={`Filter by ${f.label}`}
							onClick={() => onToggle(f.key)}
						>
							<span class="proj-qfilter__icon" aria-hidden="true">{f.icon}</span>
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}
