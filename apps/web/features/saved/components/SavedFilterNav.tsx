import type { JSX } from "preact";
import type { SavedCollection, SavedTab } from "@projective/types/org";
import { NavItem } from "@projective/ui/navigation";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	SAVED_TABS,
	savedHref,
	TAB_LABEL,
	tabHasCollections,
	UNFILED_LABEL,
} from "../core/saved-model.ts";
import type { SavedFilter } from "../core/saved-filter-state.ts";

/** A category filter's lane glyph. */
const TAB_ICON: Readonly<Record<SavedTab, IconName>> = {
	all: "bookmark",
	listings: "service",
	people: "user",
	projects: "projects",
	messages: "message",
	files: "attachment",
};

/** One row of the `/saved` lane: a real address, answered in place by the page when it is mounted. */
export interface SavedNavEntry {
	key: string;
	label: string;
	icon: JSX.Element;
	href: string;
	active: boolean;
	count: number | null;
	/** The row's accessible name, with its count. */
	name: string;
	patch: Partial<SavedFilter>;
}

/** The category filters, which narrow whatever list is open (or every save). */
export function categoryEntries(filter: SavedFilter): SavedNavEntry[] {
	return SAVED_TABS.map((tab: SavedTab) => {
		const collection = tabHasCollections(tab) ? filter.collection : undefined;
		return {
			key: tab,
			label: TAB_LABEL[tab],
			icon: <Icon name={TAB_ICON[tab]} size="md" />,
			href: savedHref(tab, collection),
			active: filter.tab === tab,
			count: null,
			name: TAB_LABEL[tab],
			patch: { tab, collection },
		};
	});
}

/** Every save, then each of the viewer's lists, then the saves filed in none. */
export function listEntries(
	filter: SavedFilter,
	lists: readonly SavedCollection[] | null,
): SavedNavEntry[] {
	const tab = tabHasCollections(filter.tab) ? filter.tab : "all";
	const entry = (
		key: string,
		label: string,
		icon: JSX.Element,
		collection: string | undefined,
		count: number | null,
	): SavedNavEntry => ({
		key,
		label,
		icon,
		href: savedHref(tab, collection),
		active: filter.collection === collection,
		count,
		name: count === null ? label : `${label}, ${count} ${count === 1 ? "item" : "items"}`,
		patch: { tab, collection },
	});
	return [
		entry("all-saved", "All saved", <Icon name="bookmark" size="md" />, undefined, null),
		...(lists ?? []).map((list) =>
			entry(list.id, list.name, <Icon name="folder" size="md" />, list.id, list.count ?? null)
		),
		entry("unfiled", UNFILED_LABEL, <Icon name="inbox" size="md" />, "unfiled", null),
	];
}

/** Props for {@link SavedFilterNav}. */
export interface SavedFilterNavProps {
	label: string;
	entries: readonly SavedNavEntry[];
	/** Answer a row in place; `true` when it did (the link then does not navigate). */
	onPick: (entry: SavedNavEntry) => boolean;
}

/** A list of lane rows; a modified click still opens the address in a new tab. */
export function SavedFilterNav(props: SavedFilterNavProps): JSX.Element {
	return (
		<nav aria-label={props.label}>
			<ul class="svd-lane__navlist" role="list">
				{props.entries.map((entry) => (
					<li key={entry.key}>
						<NavItem
							href={entry.href}
							label={entry.label}
							aria-label={entry.name}
							icon={entry.icon}
							active={entry.active ? "true" : undefined}
							trailing={entry.count === null
								? undefined
								: <span class="svd-lane__count">{entry.count}</span>}
							onClick={(event) => {
								if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
								if (props.onPick(entry)) event.preventDefault();
							}}
						/>
					</li>
				))}
			</ul>
		</nav>
	);
}
