import { assertEquals } from "@std/assert";
import type { ShortcutKey, ShortcutTarget } from "@features/shell/core/shortcuts.ts";
import { pickSearchTarget, type SearchCandidate, searchIntentOf } from "./search-targets.ts";

const key = (patch: Partial<ShortcutKey>): ShortcutKey => ({
	key: "/",
	code: "Slash",
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	repeat: false,
	defaultPrevented: false,
	...patch,
});

const field: ShortcutTarget = { tagName: "INPUT", closest: () => ({}) };
const button: ShortcutTarget = { tagName: "BUTTON", closest: () => null };

const slot = (
	name: string,
	role: SearchCandidate["role"],
	patch: Partial<SearchCandidate> = {},
): SearchCandidate & { name: string } => ({
	name,
	role,
	priority: 0,
	seq: 0,
	available: true,
	...patch,
});

Deno.test("searchIntentOf — `/` asks for the page's search, never from inside a field", () => {
	assertEquals(searchIntentOf(key({}), button), { role: "page", shortcut: "focus-search" });
	assertEquals(searchIntentOf(key({}), null), { role: "page", shortcut: "focus-search" });
	assertEquals(searchIntentOf(key({}), field), null);
});

Deno.test("searchIntentOf — the two chords fire from a field too", () => {
	assertEquals(
		searchIntentOf(key({ ctrlKey: true }), field),
		{ role: "header", shortcut: "focus-header-search" },
	);
	assertEquals(
		searchIntentOf(key({ key: "?", ctrlKey: true, shiftKey: true }), field),
		{ role: "lane", shortcut: "focus-lane-search" },
	);
	assertEquals(
		searchIntentOf(key({ key: "?", metaKey: true, shiftKey: true }), button),
		{ role: "lane", shortcut: "focus-lane-search" },
	);
});

Deno.test("searchIntentOf — anything else is not a search shortcut", () => {
	assertEquals(searchIntentOf(key({ key: "k", code: "KeyK", metaKey: true }), button), null);
	assertEquals(searchIntentOf(key({ key: "?", shiftKey: true }), button), null);
	assertEquals(searchIntentOf(key({ altKey: true }), button), null);
});

Deno.test("pickSearchTarget — `/` takes the page's search over the header's", () => {
	const page = slot("page", "page");
	const header = slot("header", "header", { seq: 9 });
	const lane = slot("lane", "lane", { seq: 10 });
	assertEquals(pickSearchTarget("page", [header, lane, page])?.name, "page");
});

Deno.test("pickSearchTarget — a page with no reachable search hands `/` to the header", () => {
	const header = slot("header", "header");
	const hidden = slot("page", "page", { available: false });
	assertEquals(pickSearchTarget("page", [hidden, header])?.name, "header");
	assertEquals(pickSearchTarget("page", [slot("lane", "lane")]), null);
});

Deno.test("pickSearchTarget — the lane and header chords only reach their own role", () => {
	const page = slot("page", "page");
	const header = slot("header", "header");
	const lane = slot("lane", "lane");
	assertEquals(pickSearchTarget("lane", [page, header, lane])?.name, "lane");
	assertEquals(pickSearchTarget("lane", [page, header]), null);
	assertEquals(pickSearchTarget("header", [page, lane]), null);
	assertEquals(pickSearchTarget("header", [page, header, lane])?.name, "header");
});

Deno.test("pickSearchTarget — priority ranks rivals, then the newest registration wins", () => {
	const older = slot("older", "page", { seq: 1 });
	const newer = slot("newer", "page", { seq: 2 });
	const ranked = slot("ranked", "page", { seq: 0, priority: 1 });
	assertEquals(pickSearchTarget("page", [older, newer])?.name, "newer");
	assertEquals(pickSearchTarget("page", [older, newer, ranked])?.name, "ranked");
});

Deno.test("pickSearchTarget — nothing reachable lets the key through", () => {
	assertEquals(pickSearchTarget("page", []), null);
	assertEquals(pickSearchTarget("lane", [slot("lane", "lane", { available: false })]), null);
});
