import { assert, assertEquals, assertThrows } from "@std/assert";
import { buildEmojiDataset, type EmojiDataset } from "./emoji-data.ts";
import { boundedEditDistance, normaliseEmojiQuery, searchEmoji } from "./emoji-search.ts";

const RAW = [
	{
		emoji: "😀",
		label: "grinning face",
		hexcode: "1F600",
		group: 0,
		order: 1,
		version: 1,
		tags: ["face", "grin", "grinning"],
	},
	{
		emoji: "😂",
		label: "face with tears of joy",
		hexcode: "1F602",
		group: 0,
		order: 8,
		version: 0.6,
		tags: ["crying", "face", "happy", "laugh", "lol", "tear"],
		emoticon: ":')",
	},
	{
		emoji: "😢",
		label: "crying face",
		hexcode: "1F622",
		group: 0,
		order: 90,
		version: 0.6,
		tags: ["cry", "face", "sad", "tear"],
		emoticon: [":'(", ":,("],
	},
	{
		emoji: "🎉",
		label: "party popper",
		hexcode: "1F389",
		group: 6,
		order: 1500,
		version: 0.6,
		tags: ["celebration", "party", "popper", "tada"],
	},
	{
		emoji: "🐶",
		label: "dog face",
		hexcode: "1F436",
		group: 3,
		order: 600,
		version: 0.6,
		tags: ["dog", "face", "pet"],
	},
	{ emoji: "🏻", label: "light skin tone", hexcode: "1F3FB", group: 2, order: 400, version: 1 },
	{ emoji: "🇦", label: "regional indicator A", hexcode: "1F1E6" },
	{ emoji: "🫨", label: "shaking face", hexcode: "1FAE8", group: 0, order: 99, version: 15 },
	{
		emoji: "🙂‍↕️",
		label: "head shaking vertically",
		hexcode: "X",
		group: 0,
		order: 100,
		version: 15.1,
	},
	"not a record",
];

const SHORTCODES = { "1F602": "joy", "1F600": ["grinning", "grinning_face"], "1F389": "tada" };

const fixture = (): EmojiDataset => buildEmojiDataset(RAW, SHORTCODES);
const glyphs = (dataset: EmojiDataset, query: string, category = null as never) =>
	searchEmoji(dataset, query, category).map((e) => e.emoji);

Deno.test("buildEmojiDataset keeps pickable records in order and drops the rest", () => {
	const data = fixture();
	assertEquals(data.entries.map((e) => e.emoji), ["😀", "😂", "😢", "🫨", "🐶", "🎉"]);
	assertEquals(data.byCategory.get("smileys")?.length, 4);
	assertEquals(data.byCategory.get("nature")?.map((e) => e.emoji), ["🐶"]);
	assertEquals(data.byCategory.get("people"), []);
	assertEquals(data.entries[1].shortcodes, ["joy"]);
	assertEquals(data.entries[2].emoticons, [":'(", ":,("]);
});

Deno.test("buildEmojiDataset refuses a payload that is not a record list", () => {
	assertThrows(() => buildEmojiDataset({ emoji: "😀" }, {}), TypeError);
});

Deno.test("normaliseEmojiQuery strips shortcode colons and separators", () => {
	assertEquals(normaliseEmojiQuery("  :Thumbs_Up: "), "thumbs up");
	assertEquals(normaliseEmojiQuery("party-popper"), "party popper");
});

Deno.test("sentiment tags find the feeling, the literal hit leading", () => {
	const data = fixture();
	assertEquals(glyphs(data, "crying"), ["😢", "😂"]);
	assertEquals(glyphs(data, "sad"), ["😢"]);
	assertEquals(glyphs(data, "party"), ["🎉"]);
	assertEquals(glyphs(data, "happy")[0], "😂");
	assert(glyphs(data, "happy").includes("😀"), "synonym `grin` reaches the grinning face");
});

Deno.test("shortcodes, labels and emoticons match whole", () => {
	const data = fixture();
	assertEquals(glyphs(data, ":joy:")[0], "😂");
	assertEquals(glyphs(data, ":tada:")[0], "🎉");
	assertEquals(glyphs(data, "grinning face")[0], "😀");
	assertEquals(glyphs(data, ":'("), ["😢"]);
});

Deno.test("every term must match, prefixes count and typos are forgiven", () => {
	const data = fixture();
	assertEquals(glyphs(data, "face dog"), ["🐶"]);
	assertEquals(glyphs(data, "pop"), ["🎉"]);
	assertEquals(glyphs(data, "partty"), ["🎉"]);
	assertEquals(glyphs(data, "zebra"), []);
	assertEquals(glyphs(data, "   "), []);
});

Deno.test("a category narrows the results", () => {
	const data = fixture();
	assertEquals(glyphs(data, "face", "nature" as never), ["🐶"]);
	assertEquals(glyphs(data, "party", "smileys" as never), []);
});

Deno.test("boundedEditDistance counts a transposition as one edit and stops past the cap", () => {
	assertEquals(boundedEditDistance("praty", "party", 1), 1);
	assertEquals(boundedEditDistance("party", "party", 1), 0);
	assertEquals(boundedEditDistance("abcdef", "uvwxyz", 2), 3);
});

Deno.test("the shipped emojibase dataset answers the feelings people search for", async () => {
	const root = new URL("../../../../node_modules/emojibase-data/en/", import.meta.url);
	const data = JSON.parse(await Deno.readTextFile(new URL("data.json", root)));
	const codes = JSON.parse(await Deno.readTextFile(new URL("shortcodes/github.json", root)));
	const dataset = buildEmojiDataset(data, codes);
	assert(dataset.entries.length > 1500, `expected a full set, got ${dataset.entries.length}`);
	for (const category of dataset.byCategory.values()) assert(category.length > 0);
	assertEquals(searchEmoji(dataset, ":joy:")[0].emoji, "😂");
	assertEquals(searchEmoji(dataset, ":thumbsup:")[0].label, "thumbs up");
	assertEquals(searchEmoji(dataset, "red heart")[0].label, "red heart");
	for (
		const [query, expected] of [["crying", "😢"], ["party", "🎉"], ["happy", "😀"], ["sad", "😞"]]
	) {
		const top = searchEmoji(dataset, query).slice(0, 24).map((e) => e.emoji);
		assert(top.includes(expected), `"${query}" should surface ${expected}, got ${top.join(" ")}`);
	}
});
