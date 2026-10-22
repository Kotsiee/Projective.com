/// <reference lib="dom" />
import { buildEmojiDataset, type EmojiDataset } from "./emoji-data.ts";
import { EMOJIBASE_DATA_URL, EMOJIBASE_SHORTCODES_URL } from "./emoji-vendor.ts";

let pending: Promise<EmojiDataset> | null = null;
let loaded: EmojiDataset | null = null;

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Emoji data request failed (${response.status}): ${url}`);
	}
	return await response.json();
}

async function fetchDataset(): Promise<EmojiDataset> {
	const [data, shortcodes] = await Promise.all([
		fetchJson(EMOJIBASE_DATA_URL),
		fetchJson(EMOJIBASE_SHORTCODES_URL),
	]);
	loaded = buildEmojiDataset(data, shortcodes);
	return loaded;
}

/**
 * Fetch (or re-use) the emoji dataset. One request pair per page; a failure clears the memo so the
 * next call retries. Browser-only: call it from an effect or an event handler.
 */
export function loadEmojiDataset(): Promise<EmojiDataset> {
	pending ??= fetchDataset().catch((error: unknown) => {
		pending = null;
		throw error;
	});
	return pending;
}

/** The dataset if it has already arrived, so a reopened picker renders without a loading frame. */
export function loadedEmojiDataset(): EmojiDataset | null {
	return loaded;
}
