import type { IconName } from "../../icons/core/paths.tsx";

// #region Types
/** The nine picker categories, in Unicode group order. */
export type EmojiCategoryId =
	| "smileys"
	| "people"
	| "nature"
	| "food"
	| "activities"
	| "travel"
	| "objects"
	| "symbols"
	| "flags";

/** One category: its id, its accessible label, its bar glyph, and the emojibase group it reads. */
export interface EmojiCategory {
	readonly id: EmojiCategoryId;
	readonly label: string;
	readonly icon: IconName;
	readonly group: number;
}

/** One pickable emoji with its search vocabulary pre-lowered. */
export interface EmojiEntry {
	readonly emoji: string;
	readonly label: string;
	readonly hexcode: string;
	readonly category: EmojiCategoryId;
	readonly order: number;
	readonly tags: readonly string[];
	readonly shortcodes: readonly string[];
	readonly emoticons: readonly string[];
	/** Every word of the label, lowercase. */
	readonly words: readonly string[];
	/** Every word of every shortcode (`thumbs_up` → `thumbs`, `up`). */
	readonly shortcodeWords: readonly string[];
}

/** The loaded dataset: every entry in display order, and the same entries split by category. */
export interface EmojiDataset {
	readonly entries: readonly EmojiEntry[];
	readonly byCategory: ReadonlyMap<EmojiCategoryId, readonly EmojiEntry[]>;
}
// #endregion

// #region Categories
/**
 * Emojibase groups 2 (skin-tone and hair components) and the ungrouped regional indicators are not
 * pickable on their own, so they have no category.
 */
export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
	{ id: "smileys", label: "Smileys & emotion", icon: "smile", group: 0 },
	{ id: "people", label: "People & body", icon: "user", group: 1 },
	{ id: "nature", label: "Animals & nature", icon: "leaf", group: 3 },
	{ id: "food", label: "Food & drink", icon: "coffee", group: 4 },
	{ id: "activities", label: "Activities", icon: "ball", group: 6 },
	{ id: "travel", label: "Travel & places", icon: "car", group: 5 },
	{ id: "objects", label: "Objects", icon: "light-bulb", group: 7 },
	{ id: "symbols", label: "Symbols", icon: "heart", group: 8 },
	{ id: "flags", label: "Flags", icon: "flag", group: 9 },
];

const CATEGORY_BY_GROUP = new Map(EMOJI_CATEGORIES.map((c) => [c.group, c.id]));

/**
 * The newest Unicode emoji version shown. Platforms trail the standard by a year or more, and an
 * emoji the reader's font cannot draw renders as an empty box or as its component parts.
 */
export const MAX_EMOJI_VERSION = 15;
// #endregion

// #region Parsing
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
	return [];
}

function lowerList(values: readonly string[]): string[] {
	return values.map((v) => v.toLowerCase());
}

/**
 * Build the picker's dataset from raw `emojibase-data` JSON: `en/data.json` and a shortcode map
 * keyed by hexcode. Records that are malformed, unpickable, or newer than `maxVersion` are dropped.
 * Throws when `rawData` is not an array, so a wrong file fails loudly instead of rendering empty.
 */
export function buildEmojiDataset(
	rawData: unknown,
	rawShortcodes: unknown,
	maxVersion: number = MAX_EMOJI_VERSION,
): EmojiDataset {
	if (!Array.isArray(rawData)) {
		throw new TypeError("Emoji data must be an array of emojibase records.");
	}
	const shortcodes = isRecord(rawShortcodes) ? rawShortcodes : {};
	const entries: EmojiEntry[] = [];

	for (const record of rawData) {
		if (!isRecord(record)) continue;
		const { emoji, label, hexcode, group, order, version } = record;
		if (typeof emoji !== "string" || typeof label !== "string" || typeof hexcode !== "string") {
			continue;
		}
		if (typeof group !== "number" || typeof order !== "number") continue;
		if (typeof version === "number" && version > maxVersion) continue;
		const category = CATEGORY_BY_GROUP.get(group);
		if (!category) continue;
		const codes = lowerList(stringList(shortcodes[hexcode]));
		entries.push({
			emoji,
			label,
			hexcode,
			category,
			order,
			tags: lowerList(stringList(record.tags)),
			shortcodes: codes,
			emoticons: stringList(record.emoticon),
			words: label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean),
			shortcodeWords: codes.flatMap((code) => code.split(/[_-]+/)).filter(Boolean),
		});
	}

	entries.sort((a, b) => a.order - b.order);
	const byCategory = new Map<EmojiCategoryId, EmojiEntry[]>(
		EMOJI_CATEGORIES.map((c) => [c.id, []]),
	);
	for (const entry of entries) byCategory.get(entry.category)?.push(entry);
	return { entries, byCategory };
}
// #endregion
