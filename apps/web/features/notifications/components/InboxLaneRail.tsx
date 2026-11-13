import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { LaneCollapseButton } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import type { InboxNavEntry } from "./InboxFilterNav.tsx";

/** Props for {@link InboxLaneRail}. */
export interface InboxLaneRailProps {
	views: readonly InboxNavEntry[];
	categories: readonly InboxNavEntry[];
	onPick: (entry: InboxNavEntry) => boolean;
	onExpand: () => void;
}

function RailGroup(
	props: { label: string; entries: readonly InboxNavEntry[]; onPick: InboxLaneRailProps["onPick"] },
): JSX.Element {
	return (
		<nav class="ntf-rail__group" aria-label={props.label}>
			{props.entries.map((entry) => (
				<Tooltip key={entry.key} content={entry.label} placement="right">
					<a
						class="ntf-rail__item"
						href={entry.href}
						aria-label={entry.name}
						aria-current={entry.active ? "true" : undefined}
						onClick={(event) => {
							if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
								return;
							}
							if (props.onPick(entry)) {
								event.preventDefault();
							}
						}}
					>
						{entry.icon}
						{entry.key !== "all" && (entry.count ?? 0) > 0
							? <span class="ntf-rail__dot" aria-hidden="true" />
							: null}
					</a>
				</Tooltip>
			))}
		</nav>
	);
}

/**
 * InboxLaneRail — the `/notifications` lane collapsed to its icon rail: the status views, a hairline,
 * the categories, and the expand toggle docked at the foot. A row with something to count keeps a
 * dot; the figure itself travels in the row's name.
 */
export function InboxLaneRail(props: InboxLaneRailProps): JSX.Element {
	return (
		<div class="ntf-rail">
			<RailGroup label="Notification views" entries={props.views} onPick={props.onPick} />
			<RailGroup label="Categories" entries={props.categories} onPick={props.onPick} />
			<div class="ntf-rail__bottom">
				<LaneCollapseButton
					collapsed
					icon={<SidebarToggleIcon />}
					tooltipPlacement="right"
					onToggle={props.onExpand}
				/>
			</div>
		</div>
	);
}
