import { assertEquals } from "@std/assert";
import type { ChatMessage } from "@projective/types/projects";
import {
	clipboardText,
	placeMenu,
	rangeIds,
	replyTargetOf,
	selectableIds,
	stepId,
	toggleId,
} from "./message-selection.ts";

// #region Fixtures
function msg(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id,
		type: "user",
		createdAt: "2026-10-03T10:00:00.000Z",
		timeLabel: "10:00 AM",
		dayLabel: "Today",
		sender: { id: "u-mara", name: "Mara Ellis", avatar: null, handle: "mara" },
		isOwn: false,
		text: `text of ${id}`,
		delta: null,
		replyTo: null,
		attachments: [],
		audio: null,
		system: null,
		reactions: [],
		pinned: false,
		favorited: false,
		...over,
	};
}

const IDS = ["a", "b", "c", "d"];
// #endregion

// #region Navigation
Deno.test("selectableIds skips system notices — nothing on them can be replied to or copied", () => {
	const list = [msg("a"), msg("s", { type: "system", sender: null }), msg("b")];
	assertEquals(selectableIds(list), ["a", "b"]);
});

Deno.test("stepId moves one message and clamps at both ends", () => {
	assertEquals(stepId(IDS, "b", -1), "a");
	assertEquals(stepId(IDS, "b", 1), "c");
	assertEquals(stepId(IDS, "a", -1), "a");
	assertEquals(stepId(IDS, "d", 1), "d");
});

Deno.test("stepId starts at the newest message when there is no usable cursor", () => {
	assertEquals(stepId(IDS, null, -1), "d");
	assertEquals(stepId(IDS, "gone", 1), "d");
	assertEquals(stepId([], null, 1), null);
});

Deno.test("rangeIds covers both ends inclusively, in feed order, whichever end is first", () => {
	assertEquals(rangeIds(IDS, "b", "d"), ["b", "c", "d"]);
	assertEquals(rangeIds(IDS, "d", "b"), ["b", "c", "d"]);
	assertEquals(rangeIds(IDS, "c", "c"), ["c"]);
	// An anchor that left the loaded window degrades to the clicked message alone.
	assertEquals(rangeIds(IDS, "gone", "b"), ["b"]);
});

Deno.test("toggleId adds and removes, keeping feed order rather than click order", () => {
	assertEquals(toggleId(IDS, ["c"], "a"), ["a", "c"]);
	assertEquals(toggleId(IDS, ["a", "c"], "a"), ["c"]);
	assertEquals(toggleId(IDS, ["a"], "a"), []);
});
// #endregion

// #region Copy
Deno.test("one copied message is exactly its own words", () => {
	assertEquals(clipboardText([msg("a"), msg("b")], ["b"]), "text of b");
});

Deno.test("several copied messages read as a transcript with who and when", () => {
	const list = [msg("a"), msg("b", { isOwn: true, text: "mine" })];
	assertEquals(
		clipboardText(list, ["a", "b"]),
		"Mara Ellis · Today 10:00 AM\ntext of a\n\nYou · Today 10:00 AM\nmine",
	);
});

Deno.test("a text-less message still contributes a line to a copy", () => {
	const memo = msg("v", {
		text: "",
		audio: { url: "", durationMs: 1000, durationLabel: "0:01", peaks: [] },
	});
	const file = msg("f", {
		text: "",
		attachments: [{
			id: "x",
			kind: "pdf",
			url: "/x",
			name: "brief.pdf",
			ext: "pdf",
			width: null,
			height: null,
		}],
	});
	assertEquals(clipboardText([memo], ["v"]), "[Voice message]");
	assertEquals(clipboardText([file], ["f"]), "[brief.pdf]");
});
// #endregion

// #region Reply target
Deno.test("replyTargetOf quotes the sender, a one-line excerpt and what a text-less original was", () => {
	assertEquals(replyTargetOf(msg("a", { text: "line one\n\nline   two" })), {
		id: "a",
		senderName: "Mara Ellis",
		isOwn: false,
		excerpt: "line one line two",
		media: "none",
	});
	const memo = msg("v", {
		text: "",
		isOwn: true,
		audio: { url: "", durationMs: 1000, durationLabel: "0:01", peaks: [] },
	});
	assertEquals(replyTargetOf(memo).media, "audio");
	assertEquals(replyTargetOf(memo).isOwn, true);
});
// #endregion

// #region Menu placement
const VIEWPORT = { width: 1200, height: 800 };
const MENU = { width: 200, height: 240 };

Deno.test("the menu opens beside another person's bubble, on its outer side", () => {
	const anchor = { left: 100, top: 300, right: 400, bottom: 340 };
	assertEquals(placeMenu(anchor, MENU, false, VIEWPORT), { x: 408, y: 300 });
});

Deno.test("the menu opens to the left of the viewer's own bubble", () => {
	const anchor = { left: 700, top: 300, right: 1100, bottom: 340 };
	assertEquals(placeMenu(anchor, MENU, true, VIEWPORT), { x: 492, y: 300 });
});

Deno.test("beside the bubble, the menu slides up rather than leave the viewport", () => {
	const anchor = { left: 100, top: 700, right: 400, bottom: 740 };
	assertEquals(placeMenu(anchor, MENU, false, VIEWPORT).y, 800 - 240 - 8);
});

Deno.test("with no room beside the bubble the menu drops below it, or above when below is off-screen", () => {
	const narrow = { width: 380, height: 800 };
	const low = { left: 20, top: 600, right: 300, bottom: 640 };
	const high = { left: 20, top: 100, right: 300, bottom: 140 };
	assertEquals(placeMenu(high, MENU, false, narrow), { x: 20, y: 148 });
	assertEquals(placeMenu(low, MENU, false, narrow), { x: 20, y: 600 - 8 - 240 });
});
// #endregion
