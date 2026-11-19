import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/saved-lane.css";
import { Icon } from "@projective/ui/icons";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import {
	LaneCollapseButton,
	LaneFooter,
	LaneList,
	LaneSection,
	LaneSections,
} from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import {
	listDialog,
	patchSavedFilter,
	type SavedFilter,
	savedBoards,
	savedFilter,
} from "../core/saved-filter-state.ts";
import {
	categoryEntries,
	listEntries,
	SavedFilterNav,
	type SavedNavEntry,
} from "../components/SavedFilterNav.tsx";

/** Props for {@link SavedLane}. */
export interface SavedLaneProps {
	/** The filter the request's URL addressed; the shared filter takes over once the page mounts. */
	filter: SavedFilter;
}

/**
 * SavedLane — the `/saved` middle-nav lane, laid out like `/notifications`': two sections of `NavItem`
 * rows, each the real address of its filter and answered in place by the page. **Categories** (All ·
 * Services & products · People · Projects · Messages · Files) only filter; **Lists** are the viewer's
 * own named lists, with New list beside the heading. Renders both presentations and lets
 * `.ui-splitter[data-mode="collapsed"]` reveal the icon rail, like every other lane.
 */
export default function SavedLane(props: SavedLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const categoriesOpen = useSignal(true);
	const listsOpen = useSignal(true);
	const filter = savedFilter.value ?? props.filter;

	useEffect(() => {
		const el = document.querySelector<HTMLElement>(".ui-splitter");
		collapsed.value = el?.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	const pick = (entry: SavedNavEntry) => patchSavedFilter(entry.patch);
	const categories = categoryEntries(filter);
	const lists = listEntries(filter, savedBoards.value);
	const newList = () => (listDialog.value = { mode: "new" });

	return (
		<div class="svd-lane">
			<div class="svd-rail">
				<RailGroup label="Categories" entries={categories} onPick={pick} />
				<RailGroup label="Lists" entries={lists} onPick={pick} />
				<div class="svd-rail__bottom">
					<LaneCollapseButton
						collapsed
						icon={<SidebarToggleIcon />}
						tooltipPlacement="right"
						onToggle={() => setCollapsed(false)}
					/>
				</div>
			</div>

			<div class="svd-lane__full">
				<LaneList label="Saved filters">
					<LaneSections>
						<LaneSection
							id="svd-categories"
							icon={<Icon name="grid" />}
							label="Categories"
							open={categoriesOpen.value}
							onToggle={() => (categoriesOpen.value = !categoriesOpen.value)}
						>
							<SavedFilterNav label="Categories" entries={categories} onPick={pick} />
						</LaneSection>
						<LaneSection
							id="svd-lists"
							icon={<Icon name="folder" />}
							label="Lists"
							open={listsOpen.value}
							onToggle={() => (listsOpen.value = !listsOpen.value)}
							action={
								<Tooltip content="New list">
									<Button
										variant="text"
										severity="secondary"
										size="sm"
										rounded
										iconOnly
										icon={<Icon name="plus" />}
										aria-label="New list"
										onClick={newList}
									/>
								</Tooltip>
							}
						>
							<SavedFilterNav label="Lists" entries={lists} onPick={pick} />
						</LaneSection>
					</LaneSections>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
				</LaneFooter>
			</div>
		</div>
	);
}

function RailGroup(
	props: {
		label: string;
		entries: readonly SavedNavEntry[];
		onPick: (entry: SavedNavEntry) => boolean;
	},
): JSX.Element {
	return (
		<nav class="svd-rail__group" aria-label={props.label}>
			{props.entries.map((entry) => (
				<Tooltip key={entry.key} content={entry.label} placement="right">
					<a
						class="svd-rail__item"
						href={entry.href}
						aria-label={entry.name}
						aria-current={entry.active ? "true" : undefined}
						onClick={(event) => {
							if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
							if (props.onPick(entry)) event.preventDefault();
						}}
					>
						{entry.icon}
					</a>
				</Tooltip>
			))}
		</nav>
	);
}
