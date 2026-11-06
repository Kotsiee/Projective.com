import { computed, signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { FolderColor } from "../types/file-types.ts";

/**
 * folder-colors — the swatches a folder's colour menu offers: the colours a person reaches for, led by
 * the ones they actually picked. The two rows hold twelve cells and the last is the `+`, so eleven
 * colours show. {@link paletteOf} is pure so the order is testable; the recents live in this browser,
 * with the file view's other preferences, because they are a habit and not a fact about a folder.
 *
 * Hues are data rather than tokens: a folder's colour is stored as a value and must look the same to
 * everyone sharing the folder, whatever their theme. Each sits at a mid lightness, so it holds on the
 * light and the dark surfaces alike.
 */

/** The cells in the grid, and how many of them a row holds. */
export const SWATCH_CELLS = 12;
export const SWATCH_COLUMNS = 6;

/** How many colours show beside the `+`. */
const SWATCHES = SWATCH_CELLS - 1;

/** The default set: one of each hue a person sorts by, then a neutral. */
export const FOLDER_COLORS: readonly { hex: string; name: string }[] = [
	{ hex: "#3b82f6", name: "Blue" },
	{ hex: "#22a06b", name: "Green" },
	{ hex: "#e5484d", name: "Red" },
	{ hex: "#f5a524", name: "Amber" },
	{ hex: "#8e5cf0", name: "Violet" },
	{ hex: "#ec5aa5", name: "Pink" },
	{ hex: "#14b8a6", name: "Teal" },
	{ hex: "#f76b15", name: "Orange" },
	{ hex: "#0ea5e9", name: "Sky" },
	{ hex: "#a8703f", name: "Brown" },
	{ hex: "#7c8598", name: "Slate" },
];

/** A swatch's spoken name: a colour from the set by its name, any other as a custom one. */
export function colorName(hex: string): string {
	return FOLDER_COLORS.find((color) => color.hex === hex)?.name ?? `Custom colour ${hex}`;
}

/** The colours to show: the most recent first, then the default set in its order, without repeats. */
export function paletteOf(recent: readonly string[]): string[] {
	const defaults = FOLDER_COLORS.map((color) => color.hex);
	return [...new Set([...recent, ...defaults])].slice(0, SWATCHES);
}

/**
 * The colours for one folder's menu. Its own colour always shows, in the last slot if it has fallen out
 * of the recents, because that swatch is the only way back to the default.
 */
export function paletteFor(palette: readonly string[], own: string | null): string[] {
	return !own || palette.includes(own) ? [...palette] : [...palette.slice(0, -1), own];
}

/** The recents after picking `hex`: it leads, and it appears once. */
export function afterPick(recent: readonly string[], hex: string): string[] {
	return [hex, ...recent.filter((color) => color !== hex)].slice(0, SWATCHES);
}

/** What the store held, keeping only real colours: it is this browser's to edit, and it can be stale. */
export function parseRecent(raw: string | null): string[] {
	try {
		const list: unknown = JSON.parse(raw ?? "[]");
		return Array.isArray(list) ? list.filter((value) => FolderColor.safeParse(value).success) : [];
	} catch {
		return [];
	}
}

const recent = signal<string[] | null>(null);

/** The swatches to draw right now. */
export const folderPalette = computed(() =>
	paletteOf(recent.value ?? parseRecent(readStored("local", LocalKeys.FILES_FOLDER_COLORS)))
);

/** Move a picked colour to the front of the swatches. */
export function rememberFolderColor(hex: string): void {
	const next = afterPick(
		recent.peek() ?? parseRecent(readStored("local", LocalKeys.FILES_FOLDER_COLORS)),
		hex,
	);
	recent.value = next;
	writeStored("local", LocalKeys.FILES_FOLDER_COLORS, JSON.stringify(next));
}
