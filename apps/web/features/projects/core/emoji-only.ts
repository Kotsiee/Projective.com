/**
 * emoji-only — whether a message body is nothing but emoji, and how large to draw it.
 *
 * Counted in graphemes, so a ZWJ family, a skin-toned hand, a flag or a keycap is one emoji, as a
 * reader would count it. Whitespace between emoji is allowed; any other character disqualifies the
 * body. A grapheme counts only when it presents as an emoji: `Emoji_Presentation` by default, or a
 * pictograph forced to emoji style with VS16, a keycap, or a regional-indicator flag — so a bare
 * digit, `#` or `©` is text.
 */

// #region Model
/** Size step for an emoji-only body: 1 is the largest (a single emoji). */
export type EmojiOnlyTier = 1 | 2 | 3 | 4;

/** An emoji-only body: how many emoji it holds and the size step that count earns. */
export interface EmojiOnly {
	count: number;
	tier: EmojiOnlyTier;
}

const EMOJI_GRAPHEME =
	/^(?:[#*0-9]️?⃣|\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)[\s\S]*)$/u;

const WHITESPACE = /^\s+$/u;

/** The size step for `count` emoji: 1 · 2–3 · 4–6 · 7+. */
export function emojiOnlyTier(count: number): EmojiOnlyTier {
	if (count <= 1) return 1;
	if (count <= 3) return 2;
	if (count <= 6) return 3;
	return 4;
}

/** The emoji-only reading of `text`, or null when it holds any non-emoji character (or none). */
export function emojiOnly(text: string): EmojiOnly | null {
	const trimmed = text.trim();
	if (!trimmed || typeof Intl.Segmenter !== "function") return null;
	let count = 0;
	for (
		const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)
	) {
		if (WHITESPACE.test(segment)) continue;
		if (!EMOJI_GRAPHEME.test(segment)) return null;
		count++;
	}
	return count > 0 ? { count, tier: emojiOnlyTier(count) } : null;
}
// #endregion
