import { assert, assertEquals } from "@std/assert";
import {
	initialTagCombo,
	normaliseTag,
	reduceTagCombo,
	type TagComboAction,
	type TagComboState,
	tagCount,
} from "./tag-combobox.ts";

const run = (state: TagComboState, ...actions: TagComboAction[]) =>
	actions.reduce((s, a) => reduceTagCombo(s, a).state, state);
const key = (k: string): TagComboAction => ({ type: "key", key: k });
const typed = (value: string): TagComboAction => ({ type: "input", value });

Deno.test("Enter commits the typed text; an empty Enter is left to the form", () => {
	const s = run(initialTagCombo([], 10), typed("  brand   design "), key("Enter"));
	assertEquals(s.tags, ["brand design"]);
	assertEquals(s.query, "");
	const empty = reduceTagCombo(initialTagCombo([], 10), key("Enter"));
	assertEquals(empty.handled, false);
});

Deno.test("a comma commits, typed or pressed", () => {
	assertEquals(run(initialTagCombo([], 10), typed("logo,")).tags, ["logo"]);
	const r = reduceTagCombo(run(initialTagCombo([], 10), typed("logo")), key(","));
	assertEquals(r.state.tags, ["logo"]);
	assertEquals(r.handled, true);
	assertEquals(reduceTagCombo(initialTagCombo([], 10), key(",")).handled, true);
});

Deno.test("↑/↓ move the active suggestion with wrap, and Enter commits it", () => {
	let s = run(initialTagCombo([], 10), typed("de"), {
		type: "options",
		options: ["design", "dev", "deco"],
	});
	assert(s.open);
	s = run(s, key("ArrowDown"));
	assertEquals(s.active, 0);
	s = run(s, key("ArrowUp"));
	assertEquals(s.active, 2);
	s = run(s, key("ArrowDown"), key("ArrowDown"));
	assertEquals(s.active, 1);
	s = run(s, key("Enter"));
	assertEquals(s.tags, ["dev"]);
	assertEquals(s.open, false);
});

Deno.test("suggestions already chosen are not offered", () => {
	const s = run(initialTagCombo(["Design"], 10), typed("de"), {
		type: "options",
		options: ["design", "dev"],
	});
	assertEquals(s.options, ["dev"]);
});

Deno.test("duplicates are refused regardless of case", () => {
	const s = run(initialTagCombo(["Logo"], 10), typed("logo"), key("Enter"));
	assertEquals(s.tags, ["Logo"]);
	assert(s.notice.includes("already"));
});

Deno.test("the cap refuses a further tag and says so", () => {
	const s = run(initialTagCombo(["a", "b"], 2), typed("c"), key("Enter"));
	assertEquals(s.tags, ["a", "b"]);
	assertEquals(s.notice, "You can add up to 2 tags.");
	assertEquals(tagCount(s), "2 of 2");
});

Deno.test("Backspace on an empty query removes the last tag; with text it is the input's", () => {
	const s = reduceTagCombo(initialTagCombo(["a", "b"], 10), key("Backspace"));
	assertEquals(s.state.tags, ["a"]);
	assertEquals(s.handled, true);
	const typing = reduceTagCombo(run(initialTagCombo(["a"], 10), typed("x")), key("Backspace"));
	assertEquals(typing.handled, false);
	assertEquals(typing.state.tags, ["a"]);
});

Deno.test("Escape closes the list, then clears the query, then passes", () => {
	let s = run(initialTagCombo([], 10), typed("de"), { type: "options", options: ["design"] });
	let r = reduceTagCombo(s, key("Escape"));
	assertEquals([r.state.open, r.state.query, r.handled], [false, "de", true]);
	s = r.state;
	r = reduceTagCombo(s, key("Escape"));
	assertEquals([r.state.query, r.handled], ["", true]);
	r = reduceTagCombo(r.state, key("Escape"));
	assertEquals(r.handled, false);
});

Deno.test("Tab closes without being consumed; a pointer pick commits", () => {
	const s = run(initialTagCombo([], 10), typed("de"), { type: "options", options: ["design"] });
	const tab = reduceTagCombo(s, key("Tab"));
	assertEquals([tab.state.open, tab.handled], [false, false]);
	assertEquals(run(s, { type: "pick", index: 0 }).tags, ["design"]);
	assertEquals(run(initialTagCombo(["a", "b"], 10), { type: "remove", index: 0 }).tags, ["b"]);
});

Deno.test("tags are trimmed, single-spaced, comma-free and capped", () => {
	assertEquals(normaliseTag("  a ,  b  ", 40), "a b");
	assertEquals(normaliseTag("x".repeat(50), 40).length, 40);
});
