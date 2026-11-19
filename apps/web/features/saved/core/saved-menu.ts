import type { MenuItem } from "@ui/types/mod.ts";
import type { SavedCollection } from "@projective/types/org";

/** What {@link saveListRows} needs from the island that owns the menu. */
export interface SaveListRowsInput {
	/** The viewer's lists, or `null` before the first read answers. */
	lists: readonly SavedCollection[] | null;
	/** Save the item into one list. */
	onPick: (list: SavedCollection) => void;
	/** Open the picker to name a new list. */
	onNewList: () => void;
}

/**
 * The Save row's submenu on a card or lane menu: one row per list, then New list…. An unread set
 * yields no rows, so the submenu shows its loading label instead of a list that is not there yet.
 */
export function saveListRows({ lists, onPick, onNewList }: SaveListRowsInput): MenuItem[] {
	if (lists === null) return [];
	const rows: MenuItem[] = lists.map((list) => ({
		key: `save-list-${list.id}`,
		label: list.name,
		icon: "folder",
		command: () => onPick(list),
	}));
	if (rows.length > 0) rows.push({ separator: true, key: "save-list-sep" });
	rows.push({ key: "save-list-new", label: "New list…", icon: "plus", command: onNewList });
	return rows;
}
