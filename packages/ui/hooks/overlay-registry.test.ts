/**
 * Tests for the portalled-overlay containment model.
 *
 * The scenario these exist for is the one that cannot be expressed with `Node.contains()`: a modal
 * whose child dropdown is portalled to `document.body`, i.e. is the modal's DOM SIBLING. Ownership
 * has to come from the trigger, which is the only part of a portalled overlay that stays where the
 * author wrote it.
 *
 * `isWithinOverlay` touches exactly three DOM affordances — `contains`, `parentNode` and identity —
 * so a tiny node fake exercises the real logic without a DOM implementation.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { containerOwnsNode, isWithinOverlay, registerOverlay } from "./overlay-registry.ts";

// #region Node fake
// The DOM lib is not in scope for `deno test`, so the DOM types are derived from the functions under
// test rather than named directly. That keeps the test honest — it is typed against the real
// signatures — without pulling a `lib` the rest of the package test run does not have.
type TargetNode = Parameters<typeof isWithinOverlay>[0];
type PanelEl = ReturnType<Parameters<typeof registerOverlay>[1]["panel"]>;

interface FakeNode {
	name: string;
	parentNode: FakeNode | null;
	children: FakeNode[];
	contains(other: unknown): boolean;
}

function node(name: string, parent: FakeNode | null = null): FakeNode {
	const n: FakeNode = {
		name,
		parentNode: parent,
		children: [],
		contains(other: unknown): boolean {
			let cur = other as FakeNode | null;
			while (cur) {
				if (cur === n) return true;
				cur = cur.parentNode;
			}
			return false;
		},
	};
	parent?.children.push(n);
	return n;
}

const as = (n: FakeNode | null) => n as unknown as PanelEl;
// #endregion

/**
 * The reported bug, as a test.
 *
 * body ├─ modalPanel ─ selectTrigger        ← trigger stays inside the modal
 *      └─ dropdownPanel ─ optionRow         ← panel is portalled OUT, a sibling of the modal
 *
 * `modalPanel.contains(optionRow)` is false, which is what made the modal treat a click on its own
 * dropdown as an outside click and close itself.
 */
Deno.test("a portalled child dropdown's option counts as inside its opener", () => {
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const selectTrigger = node("selectTrigger", modalPanel);
	const dropdownPanel = node("dropdownPanel", body);
	const optionRow = node("optionRow", dropdownPanel);

	// Ancestry alone says "outside" — this is the whole problem.
	assertFalse(modalPanel.contains(optionRow));

	const offModal = registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null });
	const offDrop = registerOverlay("dropdown", {
		panel: () => as(dropdownPanel),
		trigger: () => as(selectTrigger),
	});

	try {
		assert(
			isWithinOverlay(optionRow as unknown as TargetNode, "modal"),
			"option is inside the modal",
		);
		assert(
			isWithinOverlay(optionRow as unknown as TargetNode, "dropdown"),
			"and inside the dropdown",
		);
	} finally {
		offModal();
		offDrop();
	}
});

Deno.test("a genuinely outside click is still outside", () => {
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const pageButton = node("pageButton", body);

	const off = registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null });
	try {
		assertFalse(isWithinOverlay(pageButton as unknown as TargetNode, "modal"));
	} finally {
		off();
	}
});

Deno.test("an unrelated sibling overlay is NOT inside the modal", () => {
	// Two independently-opened overlays must not deafen each other: a click in a toast's menu is a
	// real outside click for a modal that did not open it.
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const otherTrigger = node("otherTrigger", body); // opened from the PAGE, not from the modal
	const otherPanel = node("otherPanel", body);
	const otherItem = node("otherItem", otherPanel);

	const offA = registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null });
	const offB = registerOverlay("other", {
		panel: () => as(otherPanel),
		trigger: () => as(otherTrigger),
	});
	try {
		assertFalse(isWithinOverlay(otherItem as unknown as TargetNode, "modal"));
		assert(isWithinOverlay(otherItem as unknown as TargetNode, "other"));
	} finally {
		offA();
		offB();
	}
});

Deno.test("ownership is transitive through three levels", () => {
	// modal → popover → dropdown. The dropdown's option must count as inside the MODAL, or a
	// three-deep chain (which the ticket modal genuinely builds) collapses on the first selection.
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const popTrigger = node("popTrigger", modalPanel);
	const popPanel = node("popPanel", body);
	const dropTrigger = node("dropTrigger", popPanel);
	const dropPanel = node("dropPanel", body);
	const option = node("option", dropPanel);

	const offs = [
		registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null }),
		registerOverlay("pop", { panel: () => as(popPanel), trigger: () => as(popTrigger) }),
		registerOverlay("drop", { panel: () => as(dropPanel), trigger: () => as(dropTrigger) }),
	];
	try {
		assert(isWithinOverlay(option as unknown as TargetNode, "modal"), "three levels up");
		assert(isWithinOverlay(option as unknown as TargetNode, "pop"), "two levels up");
		assert(isWithinOverlay(option as unknown as TargetNode, "drop"), "own panel");
	} finally {
		offs.forEach((f) => f());
	}
});

Deno.test("unregistering on close stops the relationship", () => {
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const trigger = node("trigger", modalPanel);
	const dropPanel = node("dropPanel", body);
	const option = node("option", dropPanel);

	const offModal = registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null });
	const offDrop = registerOverlay("drop", {
		panel: () => as(dropPanel),
		trigger: () => as(trigger),
	});
	assert(isWithinOverlay(option as unknown as TargetNode, "modal"));

	offDrop();
	// With the dropdown closed its stale panel is nobody's child again.
	assertFalse(isWithinOverlay(option as unknown as TargetNode, "modal"));
	offModal();
});

Deno.test("a self-owning overlay terminates instead of looping", () => {
	// Pathological but cheap to guard: a trigger rendered inside its own panel would make the
	// ownership walk cycle forever inside a pointerdown handler.
	const body = node("body");
	const panel = node("panel", body);
	const trigger = node("trigger", panel); // its own trigger lives in its own panel
	const other = node("otherPanel", body);
	const target = node("target", other);

	const offs = [
		registerOverlay("self", { panel: () => as(panel), trigger: () => as(trigger) }),
		registerOverlay("other", { panel: () => as(other), trigger: () => as(trigger) }),
	];
	try {
		assertEquals(isWithinOverlay(target as unknown as TargetNode, "unrelated"), false);
	} finally {
		offs.forEach((f) => f());
	}
});

Deno.test("containerOwnsNode — a focus trap sees a panel its own subtree opened", () => {
	// The focus counterpart of the containment bug. A trap testing `container.contains(activeElement)`
	// reads focus landing in a portalled child panel as an ESCAPE and yanks it back, which made every
	// control in that panel unreachable by keyboard.
	const body = node("body");
	const dialogPanel = node("dialogPanel", body);
	const trigger = node("trigger", dialogPanel); // the picker's trigger lives inside the dialog
	const pickerPanel = node("pickerPanel", body); // its panel is portalled OUT, a sibling
	const hourColumn = node("hourColumn", pickerPanel);

	assertFalse(dialogPanel.contains(hourColumn), "ancestry alone calls it an escape");

	const off = registerOverlay("picker", {
		panel: () => as(pickerPanel),
		trigger: () => as(trigger),
	});
	try {
		assert(
			containerOwnsNode(dialogPanel as unknown as PanelEl, hourColumn as unknown as TargetNode),
			"the trap must stand aside for a panel it opened",
		);
	} finally {
		off();
	}
});

Deno.test("containerOwnsNode — an unrelated overlay is still an escape", () => {
	// The trap must keep working: focus in an overlay opened from the PAGE is a genuine escape and
	// still has to be pulled back, or the dialog stops being modal.
	const body = node("body");
	const dialogPanel = node("dialogPanel", body);
	const pageTrigger = node("pageTrigger", body); // opened from outside the dialog
	const otherPanel = node("otherPanel", body);
	const item = node("item", otherPanel);

	const off = registerOverlay("other", {
		panel: () => as(otherPanel),
		trigger: () => as(pageTrigger),
	});
	try {
		assertFalse(
			containerOwnsNode(dialogPanel as unknown as PanelEl, item as unknown as TargetNode),
		);
	} finally {
		off();
	}
});

Deno.test("a null target is never inside anything", () => {
	const body = node("body");
	const panel = node("panel", body);
	const off = registerOverlay("x", { panel: () => as(panel), trigger: () => null });
	try {
		assertFalse(isWithinOverlay(null, "x"));
	} finally {
		off();
	}
});
