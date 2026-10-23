import { assertEquals } from "@std/assert";
import { emojiOnly, emojiOnlyTier } from "./emoji-only.ts";

Deno.test("a body of only emoji is counted in graphemes", () => {
	assertEquals(emojiOnly("😂"), { count: 1, tier: 1 });
	assertEquals(emojiOnly(" 👍🏽 "), { count: 1, tier: 1 });
	assertEquals(emojiOnly("👨‍👩‍👧‍👦"), { count: 1, tier: 1 });
	assertEquals(emojiOnly("🇬🇧🇯🇵"), { count: 2, tier: 2 });
	assertEquals(emojiOnly("❤️ 🔥\n🎉"), { count: 3, tier: 2 });
	assertEquals(emojiOnly("1️⃣☺️🏳️‍🌈🏴󠁧󠁢󠁥󠁮󠁧󠁿"), { count: 4, tier: 3 });
});

Deno.test("any text, or a text-style symbol, disqualifies the body", () => {
	assertEquals(emojiOnly("lol 😂"), null);
	assertEquals(emojiOnly("😂!"), null);
	assertEquals(emojiOnly("123"), null);
	assertEquals(emojiOnly("#"), null);
	assertEquals(emojiOnly("©"), null);
	assertEquals(emojiOnly("   "), null);
	assertEquals(emojiOnly(""), null);
});

Deno.test("the size steps down as the count grows", () => {
	assertEquals([1, 2, 3, 4, 6, 7, 40].map(emojiOnlyTier), [1, 2, 2, 3, 3, 4, 4]);
});
