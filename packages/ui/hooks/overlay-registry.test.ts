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
	/** Stands in for the `data-ui-portal` attribute `BodyPortal` stamps on its container. */
	isPortal: boolean;
	contains(other: unknown): boolean;
	closest(selector: string): FakeNode | null;
}

function node(name: string, parent: FakeNode | null = null): FakeNode {
	const n: FakeNode = {
		name,
		parentNode: parent,
		children: [],
		isPortal: false,
		contains(other: unknown): boolean {
			let cur = other as FakeNode | null;
			while (cur) {
				if (cur === n) return true;
				cur = cur.parentNode;
			}
			return false;
		},
		// Only the one selector the registry actually asks for. A fake that pretended to be a real
		// matcher would be a second, worse CSS engine to keep honest.
		closest(selector: string): FakeNode | null {
			if (selector !== "[data-ui-portal]") return null;
			let cur: FakeNode | null = n;
			while (cur) {
				if (cur.isPortal) return cur;
				cur = cur.parentNode;
			}
			return null;
		},
	};
	parent?.children.push(n);
	return n;
}

/** A `BodyPortal` container: a `document.body` child holding one overlay's backdrop and panel. */
function portal(name: string, parent: FakeNode): FakeNode {
	const n = node(name, parent);
	n.isPortal = true;
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

// #region Nested modals — a child with no trigger of its own
/**
 * The reported bug, in its real shape.
 *
 * A ticket modal's Attachments tab opens the asset picker. Neither is anchored to a control: both are
 * opened from state, so BOTH register `trigger: () => null`. The ownership walk used to abort the
 * moment it met an overlay with no trigger, which reported every click inside the picker as OUTSIDE
 * the ticket modal — so the first click anywhere in the picker closed both.
 */
Deno.test("a click inside a triggerless child modal is inside its opener", () => {
	const body = node("body");
	const ticketLayer = portal("ticketPortal", body);
	const ticketPanel = node("ticketPanel", ticketLayer);
	const pickerLayer = portal("pickerPortal", body);
	const pickerPanel = node("pickerPanel", pickerLayer);
	const closeX = node("closeX", pickerPanel);
	const searchField = node("searchField", pickerPanel);

	const offTicket = registerOverlay("ticket", {
		panel: () => as(ticketPanel),
		trigger: () => null,
	});
	const offPicker = registerOverlay("picker", {
		panel: () => as(pickerPanel),
		trigger: () => null,
	});
	try {
		assert(isWithinOverlay(closeX as unknown as TargetNode, "ticket"), "the X is the ticket's");
		assert(isWithinOverlay(searchField as unknown as TargetNode, "ticket"), "so is a field");
		assert(isWithinOverlay(closeX as unknown as TargetNode, "picker"), "and the picker's own");
	} finally {
		offPicker();
		offTicket();
	}
});

/**
 * A child's backdrop belongs to the child, not to nothing.
 *
 * It is a sibling of the child's panel inside the same portal container, so it lands in no registered
 * PANEL — which is why clicking it used to dismiss every ancestor. The two directions are asymmetric
 * on purpose, and both halves are asserted here: inside for the opener, outside for the owner.
 */
Deno.test("a child's backdrop is inside its opener but outside itself", () => {
	const body = node("body");
	const ticketPanel = node("ticketPanel", body);
	const pickerLayer = portal("pickerPortal", body);
	const backdrop = node("backdrop", pickerLayer);
	const pickerPanel = node("pickerPanel", pickerLayer);

	const offTicket = registerOverlay("ticket", {
		panel: () => as(ticketPanel),
		trigger: () => null,
	});
	const offPicker = registerOverlay("picker", {
		panel: () => as(pickerPanel),
		trigger: () => null,
	});
	try {
		assert(
			isWithinOverlay(backdrop as unknown as TargetNode, "ticket"),
			"the opener must not close on its child's backdrop",
		);
		assertFalse(
			isWithinOverlay(backdrop as unknown as TargetNode, "picker"),
			"but the child itself still dismisses on it",
		);
	} finally {
		offPicker();
		offTicket();
	}
});

/**
 * Dismissing the child leaves the parent intact and independently dismissable.
 *
 * "Intact" is the half that matters: after the child unregisters, a click genuinely outside must
 * still reach the parent. A fix that kept ancestors open by deafening them would pass the bug report
 * and strand every modal underneath.
 */
Deno.test("closing a child modal leaves the parent open and still dismissable", () => {
	const body = node("body");
	const ticketPanel = node("ticketPanel", body);
	const pickerLayer = portal("pickerPortal", body);
	const pickerPanel = node("pickerPanel", pickerLayer);
	const pickerBody = node("pickerBody", pickerPanel);
	const pageButton = node("pageButton", body);

	const offTicket = registerOverlay("ticket", {
		panel: () => as(ticketPanel),
		trigger: () => null,
	});
	const offPicker = registerOverlay("picker", {
		panel: () => as(pickerPanel),
		trigger: () => null,
	});

	assert(isWithinOverlay(pickerBody as unknown as TargetNode, "ticket"));
	offPicker();

	assertFalse(
		isWithinOverlay(pickerBody as unknown as TargetNode, "ticket"),
		"the closed child's stale panel is nobody's",
	);
	assertFalse(
		isWithinOverlay(pageButton as unknown as TargetNode, "ticket"),
		"and the parent still reads a real outside click as outside",
	);
	offTicket();
});

/**
 * Open order is the LAST resort, never an override.
 *
 * An overlay with a live trigger on the page is not a child of whatever happened to be open when it
 * appeared — otherwise a header menu opened over a modal would deafen that modal permanently.
 */
Deno.test("a live trigger outranks open order", () => {
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const pageTrigger = node("pageTrigger", body);
	const menuPanel = node("menuPanel", body);
	const menuItem = node("menuItem", menuPanel);

	const offModal = registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null });
	// Registers while the modal is open, so open order would call it a child — the trigger must win.
	const offMenu = registerOverlay("menu", {
		panel: () => as(menuPanel),
		trigger: () => as(pageTrigger),
	});
	try {
		assertFalse(isWithinOverlay(menuItem as unknown as TargetNode, "modal"));
		assert(isWithinOverlay(menuItem as unknown as TargetNode, "menu"));
	} finally {
		offMenu();
		offModal();
	}
});

/**
 * A host node is the exact link for a surface with no single trigger: the asset picker renders one
 * in place inside the tab that mounted it, so ownership is DOM-derived rather than order-derived.
 * Asserted against a decoy that registered later, which open order alone would have chosen.
 */
Deno.test("a host node names the opener exactly, even out of open order", () => {
	const body = node("body");
	const ticketPanel = node("ticketPanel", body);
	const pickerHost = node("pickerHost", ticketPanel); // rendered in place, inside the ticket
	const decoyPanel = node("decoyPanel", body);
	const pickerPanel = node("pickerPanel", body);
	const pickerRow = node("pickerRow", pickerPanel);

	const offs = [
		registerOverlay("ticket", { panel: () => as(ticketPanel), trigger: () => null }),
		registerOverlay("decoy", { panel: () => as(decoyPanel), trigger: () => null }),
		registerOverlay("picker", {
			panel: () => as(pickerPanel),
			trigger: () => null,
			host: () => as(pickerHost),
		}),
	];
	try {
		assert(
			isWithinOverlay(pickerRow as unknown as TargetNode, "ticket"),
			"the host names the ticket",
		);
		assertFalse(
			isWithinOverlay(pickerRow as unknown as TargetNode, "decoy"),
			"not the overlay that merely opened last",
		);
	} finally {
		offs.reverse().forEach((f) => f());
	}
});

/** Three deep with a triggerless middle link: modal → picker (no trigger) → its own Select. */
Deno.test("ownership survives a triggerless link mid-chain", () => {
	const body = node("body");
	const modalPanel = node("modalPanel", body);
	const pickerPanel = node("pickerPanel", body);
	const selectTrigger = node("selectTrigger", pickerPanel);
	const dropPanel = node("dropPanel", body);
	const option = node("option", dropPanel);

	const offs = [
		registerOverlay("modal", { panel: () => as(modalPanel), trigger: () => null }),
		registerOverlay("picker", { panel: () => as(pickerPanel), trigger: () => null }),
		registerOverlay("drop", { panel: () => as(dropPanel), trigger: () => as(selectTrigger) }),
	];
	try {
		assert(isWithinOverlay(option as unknown as TargetNode, "modal"), "three levels up");
		assert(isWithinOverlay(option as unknown as TargetNode, "picker"), "two levels up");
		assert(isWithinOverlay(option as unknown as TargetNode, "drop"), "own panel");
	} finally {
		offs.reverse().forEach((f) => f());
	}
});

/**
 * The focus counterpart for a triggerless child. Without this the parent's trap treats focus landing
 * in the picker as an escape and yanks it back, making every control in the picker unreachable by
 * keyboard — the same defect as the click bug, one channel over.
 */
Deno.test("containerOwnsNode — a trap stands aside for a triggerless child it opened", () => {
	const body = node("body");
	const ticketPanel = node("ticketPanel", body);
	const pickerPanel = node("pickerPanel", body);
	const pickerInput = node("pickerInput", pickerPanel);

	const offTicket = registerOverlay("ticket", {
		panel: () => as(ticketPanel),
		trigger: () => null,
	});
	const offPicker = registerOverlay("picker", {
		panel: () => as(pickerPanel),
		trigger: () => null,
	});
	try {
		assert(
			containerOwnsNode(
				ticketPanel as unknown as PanelEl,
				pickerInput as unknown as TargetNode,
			),
			"the ticket's trap must release focus into the picker it opened",
		);
	} finally {
		offPicker();
		offTicket();
	}
});
// #endregion
