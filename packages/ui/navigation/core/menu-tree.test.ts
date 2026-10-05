import { assert, assertEquals, assertFalse } from "@std/assert";
import type { MenuItem } from "../../types/mod.ts";
import {
	appendTypeahead,
	type Box,
	closeFrom,
	EMPTY_ROW_KEY,
	escapeStep,
	isAimingAt,
	isEmptyRow,
	isReadable,
	isSubmenu,
	openSubmenu,
	pointInTriangle,
	resolveHover,
	resolveLevels,
	resolveMenuKey,
	submenuRows,
	typeaheadTarget,
} from "./menu-tree.ts";

// #region Fixtures
const stages: MenuItem[] = [
	{ label: "Discovery" },
	{ label: "Design", hint: "Pending invite", disabled: true, disabledReason: "Already invited" },
	{ label: "Delivery" },
];

const model: MenuItem[] = [
	{ label: "Message" },
	{ label: "Invite to stage", items: stages },
	{ label: "Move to", items: [], emptyLabel: "No other stages" },
	{ label: "Archived", items: [{ label: "gone", visible: false }] },
	{ separator: true },
	{ label: "Remove", danger: true },
];
// #endregion

// #region Tree shape
Deno.test("isSubmenu counts visible children or an emptyLabel", () => {
	assert(isSubmenu(model[1]));
	assert(isSubmenu(model[2]), "an empty list with an emptyLabel still opens");
	assertFalse(isSubmenu(model[3]), "only hidden children and no emptyLabel is a leaf");
	assertFalse(isSubmenu({ label: "x", items: [] }));
	assertFalse(isSubmenu(model[0]));
});

Deno.test("submenuRows substitutes one disabled emptyLabel row", () => {
	const rows = submenuRows(model[2]);
	assertEquals(rows.length, 1);
	assertEquals(rows[0].label, "No other stages");
	assert(rows[0].disabled);
	assert(isEmptyRow(rows[0]));
	assertEquals(rows[0].key, EMPTY_ROW_KEY);
	assertEquals(submenuRows(model[1]).length, 3);
});

Deno.test("isReadable keeps disabled rows and drops separators", () => {
	assert(isReadable({ label: "x", disabled: true }));
	assertFalse(isReadable({ separator: true }));
});

Deno.test("resolveLevels follows a path and truncates where it stops resolving", () => {
	const open = resolveLevels(model, [1]);
	assertEquals(open.levels.length, 2);
	assertEquals(open.levels[1].map((i) => i.label), ["Discovery", "Design", "Delivery"]);
	assertEquals(open.path, [1]);

	const stale = resolveLevels(model, [0, 2]);
	assertEquals(stale.levels.length, 1, "row 0 is a leaf, so nothing deeper renders");
	assertEquals(stale.path, []);

	const gone = resolveLevels(model, [9]);
	assertEquals(gone.path, []);

	const disabled = resolveLevels([{ label: "p", disabled: true, items: stages }], [0]);
	assertEquals(disabled.path, [], "a disabled parent never opens");
});

Deno.test("openSubmenu replaces the branch at its depth; closeFrom truncates", () => {
	assertEquals(openSubmenu([], 0, 1), [1]);
	assertEquals(openSubmenu([1, 2, 0], 1, 4), [1, 4]);
	assertEquals(openSubmenu([1], 0, 2), [2], "a sibling replaces the open submenu");
	assertEquals(closeFrom([1, 2, 0], 1), [1]);
	assertEquals(closeFrom([1, 2], 0), []);
	assertEquals(closeFrom([1], -3), []);
});

Deno.test("escapeStep closes the deepest flyout first, then the menu", () => {
	assertEquals(escapeStep([1, 2]), {
		type: "close-level",
		path: [1],
		focus: { depth: 1, index: 2 },
	});
	assertEquals(escapeStep([1]), { type: "close-level", path: [], focus: { depth: 0, index: 1 } });
	assertEquals(escapeStep([]), { type: "close-all" });
});
// #endregion

// #region Keyboard
const root = resolveLevels(model, []).levels[0];
const key = (k: string, index: number, depth = 0, extra: Partial<{ rtl: boolean }> = {}) =>
	resolveMenuKey({ key: k, items: depth === 0 ? root : stages, index, depth, ...extra });

Deno.test("arrows and Home/End rove over readable rows, disabled included", () => {
	assertEquals(key("ArrowDown", 0, 1), { type: "focus", index: 1 });
	assertEquals(key("ArrowDown", 3), { type: "focus", index: 5 }, "skips the separator");
	assertEquals(key("ArrowDown", 5), { type: "focus", index: 0 }, "wraps");
	assertEquals(key("ArrowUp", 0), { type: "focus", index: 5 });
	assertEquals(key("Home", 3), { type: "focus", index: 0 });
	assertEquals(key("End", 0), { type: "focus", index: 5 });
});

Deno.test("Right/Enter/Space open a submenu; Enter/Space activate a leaf", () => {
	assertEquals(key("ArrowRight", 1), { type: "open", index: 1 });
	assertEquals(key("Enter", 1), { type: "open", index: 1 });
	assertEquals(key(" ", 2), { type: "open", index: 2 });
	assertEquals(key("Enter", 0), { type: "activate", index: 0 });
	assertEquals(key("ArrowRight", 0), { type: "none" });
});

Deno.test("disabled rows are readable but inert", () => {
	assertEquals(key("Enter", 1, 1), { type: "none" });
	assertEquals(key(" ", 1, 1), { type: "none" });
	const disabledParent = [{ label: "p", disabled: true, items: stages }];
	assertEquals(
		resolveMenuKey({ key: "ArrowRight", items: disabledParent, index: 0, depth: 0 }),
		{ type: "none" },
	);
});

Deno.test("Left and Escape close one level; Escape at the root closes the menu", () => {
	assertEquals(key("ArrowLeft", 0, 1), { type: "close-level" });
	assertEquals(key("ArrowLeft", 0), { type: "none" });
	assertEquals(key("Escape", 0, 1), { type: "close-level" });
	assertEquals(key("Escape", 0), { type: "close-all" });
	assertEquals(key("Tab", 2, 1), { type: "tab" });
});

Deno.test("right-to-left mirrors the open/close arrows", () => {
	assertEquals(key("ArrowLeft", 1, 0, { rtl: true }), { type: "open", index: 1 });
	assertEquals(key("ArrowRight", 1, 0, { rtl: true }), { type: "none" });
	assertEquals(key("ArrowRight", 0, 1, { rtl: true }), { type: "close-level" });
});

Deno.test("printable keys are typeahead unless a modifier is held", () => {
	assertEquals(key("d", 0, 1), { type: "typeahead", char: "d" });
	assertEquals(
		resolveMenuKey({ key: "d", items: stages, index: 0, depth: 1, modifier: true }),
		{ type: "none" },
	);
	assertEquals(key("Shift", 0), { type: "none" });
});

Deno.test("typeahead accumulates within the window and lands on readable rows", () => {
	let s = appendTypeahead({ buffer: "", at: 0 }, "d", 1000);
	assertEquals(s.buffer, "d");
	s = appendTypeahead(s, "e", 1200);
	assertEquals(s.buffer, "de");
	s = appendTypeahead(s, "x", 2000);
	assertEquals(s.buffer, "x", "silence past the window starts a new buffer");

	assertEquals(typeaheadTarget(stages, 0, "d"), 1, "one character advances");
	assertEquals(typeaheadTarget(stages, 1, "des"), 1, "a longer buffer may stay put");
	assertEquals(typeaheadTarget(stages, 1, "del"), 2);
	assertEquals(typeaheadTarget(stages, 0, "q"), -1);
});
// #endregion

// #region Hover intent
const flyout: Box = { top: 100, bottom: 300, left: 200, right: 400 };

Deno.test("pointInTriangle includes the interior and edges", () => {
	const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, c = { x: 0, y: 10 };
	assert(pointInTriangle({ x: 2, y: 2 }, a, b, c));
	assert(pointInTriangle({ x: 5, y: 0 }, a, b, c));
	assertFalse(pointInTriangle({ x: 8, y: 8 }, a, b, c));
});

Deno.test("isAimingAt accepts moves toward the flyout's near edge only", () => {
	assert(isAimingAt({ x: 150, y: 120 }, { x: 160, y: 125 }, flyout), "diagonal toward it");
	assertFalse(isAimingAt({ x: 150, y: 120 }, { x: 150, y: 140 }, flyout), "straight down");
	assertFalse(isAimingAt({ x: 150, y: 120 }, { x: 140, y: 120 }, flyout), "away from it");
	assertFalse(isAimingAt({ x: 150, y: 120 }, { x: 150, y: 120 }, flyout), "at rest");
	assert(isAimingAt({ x: 150, y: 120 }, { x: 250, y: 150 }, flyout), "already inside");
});

Deno.test("isAimingAt mirrors for a flyout on the left", () => {
	const left: Box = { top: 100, bottom: 300, left: 0, right: 100 };
	assert(isAimingAt({ x: 150, y: 200 }, { x: 140, y: 205 }, left));
	assertFalse(isAimingAt({ x: 150, y: 200 }, { x: 160, y: 205 }, left));
});

Deno.test("resolveHover: the open parent idles; a parent opens after a delay", () => {
	const trail = [{ x: 10, y: 10 }];
	assertEquals(
		resolveHover({ index: 1, item: model[1], openIndex: 1, submenu: flyout, trail }),
		{ type: "idle" },
	);
	assertEquals(
		resolveHover({ index: 1, item: model[1], openIndex: -1, submenu: null, trail }),
		{ type: "open", index: 1, delay: 100 },
	);
	assertEquals(
		resolveHover({ index: 0, item: model[0], openIndex: -1, submenu: null, trail }),
		{ type: "idle" },
		"nothing is open and a leaf has nothing to open",
	);
});

Deno.test("resolveHover: a sibling closes the open flyout unless the pointer aims at it", () => {
	const aimed = [{ x: 150, y: 120 }, { x: 160, y: 125 }];
	const away = [{ x: 150, y: 120 }, { x: 150, y: 140 }];
	assertEquals(
		resolveHover({ index: 0, item: model[0], openIndex: 1, submenu: flyout, trail: aimed }),
		{ type: "defer", delay: 250 },
	);
	assertEquals(
		resolveHover({ index: 0, item: model[0], openIndex: 1, submenu: flyout, trail: away }),
		{ type: "close", delay: 100 },
	);
	assertEquals(
		resolveHover({ index: 2, item: model[2], openIndex: 1, submenu: flyout, trail: away }),
		{ type: "open", index: 2, delay: 100 },
		"a sibling parent switches the submenu",
	);
	assertEquals(
		resolveHover({
			index: 0,
			item: model[0],
			openIndex: 1,
			submenu: flyout,
			trail: [aimed[1]],
		}),
		{ type: "close", delay: 100 },
		"re-deciding with the pointer at rest releases the hold",
	);
});

Deno.test("resolveHover: a disabled parent never opens", () => {
	const item: MenuItem = { label: "p", disabled: true, items: stages };
	assertEquals(
		resolveHover({ index: 0, item, openIndex: -1, submenu: null, trail: [] }),
		{ type: "idle" },
	);
});
// #endregion
