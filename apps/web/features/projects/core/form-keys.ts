/// <reference lib="dom" />

import { getTabbable } from "@projective/ui/hooks";

/**
 * form-keys — what the keyboard does inside a project form, as ONE delegated rule.
 *
 * Every surface that configures a project — the create modal and the owner's Stage-2 workspace —
 * is a long form with no submit button, so on most of its controls the keys a keyboard-first person
 * reaches for are simply dead: Enter on a text field does nothing, Enter on a select re-opens the
 * panel it just closed, and a switch can only be reached by Tab and flipped by Space.
 *
 * The rule, in one sentence per control:
 *
 *  - a single-line input commits on `Enter` and moves to the next control;
 *  - a multiline surface (textarea, rich-text editor) keeps `Enter` for its newline and moves on
 *    `Ctrl`/`Cmd` + `Enter`;
 *  - a select cycles its options on the arrows, and `Enter` picks one AND moves on;
 *  - a switch toggles on ANY arrow, and `Enter` moves on;
 *  - a radio segment selects on the arrows, and `Enter` moves on;
 *  - a number field has its contents selected the moment the keyboard puts focus in it, so the
 *    reader can type over the figure or drive it with the arrows without first clearing it.
 *
 * ## Why this is delegated, and why it is CAPTURE phase
 *
 * Delegated from the form root, a control that mounts later — a stage added mid-session, a field a
 * type change reveals — is covered by construction, and the bail-out rules exist once instead of
 * once per call site where each could be written slightly differently.
 *
 * Capture is what lets this own a key BEFORE the control sees it, which is the whole reason no
 * `@projective/ui` component had to be edited for any of the above. A `ToggleSwitch` binds Enter to
 * its own toggle; intercepting that in capture and calling `stopPropagation` means the switch never
 * receives it, so its behaviour inside a project form changes without its behaviour anywhere else in
 * the product changing at all. The same phase is what protects the step list: the next tabbable
 * after a step's input is that step's own DELETE button, so a row that tried to claim Enter for
 * itself in the bubble phase would find focus already moved and one space bar from destroying the
 * item just written.
 *
 * No store import and no JSX, so the module is safe on both sides of the island boundary and the
 * pure halves below can be reasoned about without a DOM.
 */

// #region Element vocabulary
/**
 * Input types `Enter` may advance out of.
 *
 * An allow-list rather than a deny-list: a type added to HTML tomorrow is one nobody here has
 * reasoned about, and the safe answer for an unknown control is to leave its Enter alone.
 */
const ADVANCEABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
	"text",
	"search",
	"url",
	"tel",
	"email",
	"number",
	"password",
]);

/** Input types whose contents are selected on keyboard entry — the numeric family (§3 of the brief). */
const NUMERIC_INPUT_TYPES: ReadonlySet<string> = new Set(["number", "tel"]);

/**
 * Containers whose descendants own `Enter` for themselves.
 *
 * `.ui-chips` commits the chip being typed; a `combobox` selects its active option; a rich-text
 * editor's contenteditable starts a paragraph; `.psu-tasks` inserts the next step. Each of those is
 * a real interaction that advancing focus would silently replace rather than add to.
 *
 * A combobox is listed here for the PLAIN Enter only — {@link comboboxAdvance} handles it separately,
 * because "select this option" and "move on" are both wanted from the one press.
 */
const ENTER_OWNERS =
	'.ui-chips, [role="combobox"], [contenteditable="true"], .ql-editor, .psu-tasks';

/**
 * Surfaces where `Enter` is a newline and the modified chord is the commit.
 *
 * The rich-text editor is matched by BOTH its Quill class and the generic `contenteditable`, because
 * `RichTextEditor` is the one in use today and a plain contenteditable is what any replacement would
 * be — a selector that only knew about Quill would silently stop working the day it is swapped.
 */
const MULTILINE = 'textarea, [contenteditable="true"], .ql-editor';

/** The nearest boundary an advance may walk within, so focus never leaves the form for the chrome. */
const ADVANCE_SCOPE = "form, .psu, .psu-shell, .pjc__panel";

/** The numeric field families whose `<input>` is auto-selected on keyboard entry. */
const NUMERIC_HOSTS = ".ui-input-number, .ui-number-input, .ui-field--number";

/** Whether this element is a text-shaped control that takes a whole line and nothing more. */
function isAdvanceableInput(el: HTMLElement): el is HTMLInputElement {
	if (!(el instanceof HTMLInputElement)) return false;
	if (el.readOnly || el.disabled) return false;
	if (!ADVANCEABLE_INPUT_TYPES.has(el.type)) return false;
	if (el.getAttribute("role") === "combobox") return false;
	return el.closest(ENTER_OWNERS) === null;
}

/** Whether the caret is inside a surface where a bare `Enter` means "new line". */
function inMultiline(el: HTMLElement): boolean {
	return el.isContentEditable || el.closest(MULTILINE) !== null;
}

/** Whether this element is a numeric field — the one family whose contents are pre-selected. */
function isNumericField(el: Element | null): el is HTMLInputElement {
	if (!(el instanceof HTMLInputElement)) return false;
	if (el.readOnly || el.disabled) return false;
	if (NUMERIC_INPUT_TYPES.has(el.type)) return true;
	// `InputNumber` renders `type="text"` so it can format its own value; the host class is what
	// identifies it, and asking the input alone would miss every currency field on the surface.
	return el.type === "text" && el.closest(NUMERIC_HOSTS) !== null;
}
// #endregion

// #region Focus movement
/**
 * Select a numeric field's contents so the next keystroke replaces the figure.
 *
 * Scoped to the numeric family deliberately. Selecting a NAME on entry means the next keystroke
 * destroys it, which is the opposite of what someone revisiting a written field wants; a figure is
 * almost always replaced wholesale, and the arrows are the other way it is driven — both of which
 * want the value selected rather than a caret parked at one end of it.
 */
export function selectNumericContents(el: Element | null): void {
	if (!isNumericField(el)) return;
	const take = () => {
		// Focus may have moved on between the two attempts below; selecting a field nobody is in would
		// leave a highlight sitting on a control the reader has already left.
		if (document.activeElement !== el) return;
		try {
			el.select();
		} catch {
			// `select()` throws on an input whose type does not support a selection range in some
			// engines. The field still has focus and is still typeable; only the convenience is lost.
		}
	};
	take();
	/*
	 * And again on the next macrotask, because the first attempt is routinely UNDONE.
	 *
	 * `InputNumber` formats its value for display and swaps in an unformatted draft on focus, so the
	 * `<input>`'s `value` changes one render after the caret arrives — and writing `value` collapses
	 * any selection to the end of the new string. Measured: a field holding `1250.00` was selected,
	 * re-rendered to `1250`, and the reader was left with a caret at offset 4 and nothing highlighted.
	 *
	 * A macrotask rather than a microtask: Preact flushes its renders on a microtask, so a microtask
	 * queued here can still run BEFORE the swap it is trying to outlive. `setTimeout` also fires in a
	 * backgrounded tab, where `requestAnimationFrame` does not.
	 */
	setTimeout(take, 0);
}

/**
 * Move focus to the next tabbable control after `from`, within the form it belongs to.
 *
 * Returns whether it moved, so a caller can decide whether the key it intercepted was worth
 * preventing: on the LAST control nothing is prevented and Enter keeps whatever native meaning it
 * had, which on a real `<form>` is submission.
 *
 * `getTabbable` is the package's own resolver, reused rather than reimplemented — a second selector
 * would drift from the one every overlay's focus trap uses, and the two would then disagree about
 * what is reachable on the same page.
 */
export function advanceFrom(from: HTMLElement, host?: HTMLElement | null): boolean {
	// Never `document.body` as a fallback. A control inside no form boundary reached this handler
	// through a portal — an overlay panel rendered out of the tree it was opened from — and walking
	// the whole document from there would step focus out of that overlay entirely.
	const scope = from.closest<HTMLElement>(ADVANCE_SCOPE) ?? host ?? null;
	if (!scope || !scope.contains(from)) return false;

	/*
	 * `getTabbable` selects `button:not([disabled])` unconditionally, so it returns buttons carrying
	 * `tabindex="-1"` — which are, by definition, not in the tab order at all. That is the right
	 * answer for a focus TRAP (everything an overlay may hold focus on) and the wrong one here.
	 *
	 * The difference is not academic: every roving-tabindex control in the product — a `SelectButton`
	 * segment row, the create modal's type cards, a number field's own steppers — parks `-1` on the
	 * members it is not currently on. Without this filter, Enter on the chosen segment of a radio
	 * group advanced to the NEXT SEGMENT of the same group rather than past it, so the keystroke that
	 * should have said "done choosing" silently re-entered the choice. Measured, on the type cards.
	 *
	 * The anchor itself is kept regardless, because a contenteditable may report `tabIndex` -1 while
	 * genuinely holding focus.
	 */
	const order = getTabbable(scope).filter((el) => el.tabIndex >= 0 || el === from);
	// The event's target is not always the element the tab order knows about: a keystroke inside a
	// rich-text editor can be reported against a node the editor owns rather than the editing host
	// itself, and an index of -1 would silently do nothing. Climb to the nearest ancestor the order
	// does know, which is the control the reader is actually in.
	let anchor: HTMLElement | null = from;
	while (anchor && !order.includes(anchor)) {
		anchor = anchor.parentElement;
		if (anchor && !scope.contains(anchor)) return false;
	}
	if (!anchor) return false;

	const next = order[order.indexOf(anchor) + 1];
	if (!next) return false;

	next.focus();
	selectNumericContents(next);
	return true;
}
// #endregion

// #region The delegated handlers
/** The nearest ancestor that is a select/combobox trigger, or `null`. */
function comboboxOf(el: HTMLElement): HTMLElement | null {
	return el.closest<HTMLElement>('[role="combobox"]');
}

/**
 * `Enter` on an OPEN select: let the control choose, then move on once it has.
 *
 * Both halves of the brief's rule are wanted from one press — "Enter selects the option and advances
 * focus to the next input" — and they cannot both be decided synchronously. The selection is the
 * control's own handler, which has not run yet in the capture phase; whether it closed the panel is
 * the only honest signal that a choice was actually made, and that lands a frame later once the
 * island has re-rendered.
 *
 * So the advance is scheduled and then RE-TESTED: it fires only if the panel is now closed and focus
 * came back to the trigger, which is true after a selection and false after an Enter the control
 * ignored (it prevents the key and stays open when no option is active). `Escape` also closes the
 * panel, and is never scheduled here because only `Enter` reaches this function.
 */
function comboboxAdvance(trigger: HTMLElement, host: HTMLElement | null): void {
	requestAnimationFrame(() => {
		if (trigger.getAttribute("aria-expanded") === "true") return;
		if (document.activeElement !== trigger) return;
		advanceFrom(trigger, host);
	});
}

/**
 * The form's keydown rule. Bind ONCE on the form root with `onKeyDownCapture`.
 *
 * Every branch either leaves the event entirely alone or prevents it and does one thing, so a key
 * this rule does not recognise keeps the meaning its control gave it.
 */
export function formKeyNav(event: KeyboardEvent): void {
	// Any keystroke is the reader working by keyboard, so a pointerdown that focused nothing cannot
	// strand its flag and suppress the next Tab's auto-select.
	pointerFocus = false;
	const target = event.target as HTMLElement | null;
	if (!target) return;
	const host = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

	// A switch is a boolean, and a boolean has no direction — so every arrow means "the other one".
	// Driven through `click()` rather than a state setter so `ToggleSwitch` stays untouched and keeps
	// firing its own `onValueChange`; this is a synthetic press, not a second source of truth.
	if (isArrowKey(event.key)) {
		if (target.getAttribute("role") !== "switch") return;
		if (target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return;
		event.preventDefault();
		event.stopPropagation();
		target.click();
		return;
	}

	if (event.key !== "Enter" || event.isComposing) return;

	// `Ctrl`/`Cmd` + Enter is the commit on a surface that keeps plain Enter for its own newline.
	// Checked BEFORE the bare-Enter branch, because the modifier is the whole distinction.
	if (event.ctrlKey || event.metaKey) {
		if (event.shiftKey || event.altKey) return;
		if (!inMultiline(target)) return;
		if (advanceFrom(target, host)) event.preventDefault();
		return;
	}

	// Any other modified Enter is somebody asking for something else entirely; leave it to the browser.
	if (event.shiftKey || event.altKey) return;

	// A newline is the control's own meaning and outranks the chain.
	if (inMultiline(target)) return;

	const role = target.getAttribute("role");

	if (role === "switch") {
		/*
		 * Space stays the toggle (the ARIA switch pattern's own key); Enter is the chain's. Stopping
		 * propagation in capture is what keeps `ToggleSwitch` from also toggling on the way down.
		 *
		 * Prevented UNCONDITIONALLY, unlike the text branch below, and that is the deliberate part: on
		 * the LAST control of a form there is nothing to advance to, and letting Enter fall through
		 * there would toggle — so the one switch at the end of the page would do the opposite of what
		 * every switch above it just taught the reader. Inert is the consistent answer. (Measured: the
		 * deadline-bonus switch IS the last tabbable on the setup form.)
		 */
		event.preventDefault();
		event.stopPropagation();
		advanceFrom(target, host);
		return;
	}

	if (role === "radio" || (target instanceof HTMLInputElement && target.type === "radio")) {
		event.preventDefault();
		event.stopPropagation();
		// A segment reached by Tab may not be the chosen one — a radiogroup with nothing selected puts
		// its roving tabindex on the first segment. Enter then means "this one", and the advance is the
		// next press. Where it IS already chosen, re-selecting it would be a no-op the reader paid a
		// keystroke for.
		if (target.getAttribute("aria-checked") === "false") {
			target.click();
			return;
		}
		if (target instanceof HTMLInputElement && !target.checked) {
			target.click();
			return;
		}
		advanceFrom(target, host);
		return;
	}

	const combobox = comboboxOf(target);
	if (combobox) {
		// Closed, Enter is "open the panel" — the control's own meaning, and the only way in from the
		// keyboard. Open, it is "choose this", and the advance follows the choice.
		if (combobox.getAttribute("aria-expanded") === "true") comboboxAdvance(combobox, host);
		return;
	}

	if (!isAdvanceableInput(target)) return;
	if (advanceFrom(target, host)) event.preventDefault();
}

/**
 * Whether the focus about to land was caused by a POINTER.
 *
 * `:focus-visible` cannot answer this and it is worth saying why, because it is the obvious first
 * try: the selector is specified to match ALWAYS on an element that takes keyboard input, so a text
 * or number field matches it on a mouse click exactly as it does on Tab. Measured — a click into a
 * number field reports `:focus-visible` true. Using it as the gate would have selected the value out
 * from under every reader who clicked into the middle of a figure to fix one digit.
 *
 * A pointerdown is always immediately followed by the focus it causes, so the flag is set and
 * consumed within one interaction. Any keystroke clears it, so a click that focused nothing cannot
 * strand it and suppress the NEXT keyboard entry.
 */
let pointerFocus = false;

/** Bind on the form root with `onPointerDownCapture`. See {@link pointerFocus}. */
export function formPointerDown(): void {
	pointerFocus = true;
}

/**
 * The form's focus rule. Bind ONCE on the form root with `onFocusInCapture`.
 *
 * Covers the `Tab` half of the number-field rule; {@link advanceFrom} covers the `Enter` half by
 * selecting whatever it just focused. A POINTER click into a number field places a caret where the
 * reader aimed it, and selecting the whole value there would discard a deliberate edit position;
 * keyboard entry has no aimed position to discard.
 */
export function formFocusEntry(event: FocusEvent): void {
	const byPointer = pointerFocus;
	pointerFocus = false;
	if (byPointer) return;
	const target = event.target as Element | null;
	selectNumericContents(target);
}

/** The four arrows, as one test. */
function isArrowKey(key: string): boolean {
	return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}
// #endregion
