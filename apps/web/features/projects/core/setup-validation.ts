import { type ComponentChildren, h, type JSX } from "preact";
import { signal } from "@preact/signals";
import { getTabbable } from "@projective/ui/hooks";
import type { FieldStatus } from "@projective/ui/fields";

/**
 * setup-validation — when the owner's Stage-2 workspace is allowed to tell them a field is wrong,
 * and what the Enter key does on it.
 *
 * Two rules live here, and both exist because the setup surface is a form somebody types into for
 * twenty minutes rather than one they submit in ten seconds.
 *
 * **Blur-gated verdicts.** A field is only ever marked while the person is NOT in it and has already
 * left it once. Painting `required` on an empty Project name the instant the page loads accuses the
 * owner of an omission they have not had a chance to make, and re-painting it on every keystroke
 * while they are halfway through typing is worse — the control flickers between wrong and right as
 * a direct function of how fast they type. The verdict itself is still computed by the caller from
 * the SSOT; this module only decides WHEN it is allowed to show.
 *
 * **Enter advances focus.** On a single-line input Enter has no native meaning inside a form with no
 * submit button, so it is dead. Making it step to the next control is what a keyboard-first person
 * expects from a long configuration form. It is deliberately conservative: an allow-list of input
 * types, and a bail-out for every element where Enter already means something (a textarea's newline,
 * a rich-text editor's paragraph, a button's press, a chip editor's commit, a combobox's selection).
 * Advancing out of one of those would DESTROY an interaction rather than adding one.
 *
 * No `@server/*` import and no JSX beyond the one wrapper, so the module is safe on both sides of the
 * island boundary and the two rules can be reasoned about without a DOM.
 */

// #region The touched / focused model
/**
 * Fields the owner has entered and left, keyed by the caller's own field key.
 *
 * A `Set` inside a signal rather than a signal per field: the key space is open (a stage's name key
 * carries the stage id, and a stage can be added at any time), so a fixed record of signals could
 * not be declared ahead of the rows it has to describe.
 */
const touchedKeys = signal<ReadonlySet<string>>(new Set<string>());

/** The field the caret is in right now, or `null`. Exactly one, because focus is singular. */
const focusedKey = signal<string | null>(null);

/**
 * Record that the owner has left a field, so its verdict may now be shown.
 *
 * Idempotent, and it writes a NEW set rather than mutating the held one — a mutated set is the same
 * object, so the signal would not notify and the field that was just left would keep reading as
 * untouched until something else re-rendered it.
 */
export function markTouched(fieldKey: string): void {
	if (touchedKeys.value.has(fieldKey)) return;
	const next = new Set(touchedKeys.value);
	next.add(fieldKey);
	touchedKeys.value = next;
}

/** Whether the owner has entered and left this field. Reads the signal, so callers re-render. */
export function isTouched(fieldKey: string): boolean {
	return touchedKeys.value.has(fieldKey);
}

/** Record which field the caret is in; `null` on leaving without entering another. */
export function markFocused(fieldKey: string | null): void {
	if (focusedKey.value !== fieldKey) focusedKey.value = fieldKey;
}

/** Whether the caret is in this field right now. */
export function isFocused(fieldKey: string): boolean {
	return focusedKey.value === fieldKey;
}

/**
 * The status a control may actually render, given the verdict its data supports.
 *
 * `default` while the field is focused or has never been left; the caller's verdict otherwise. The
 * `default` case is returned rather than the verdict being suppressed at the call site so there is
 * ONE rule: a control that forgot to ask would show its verdict immediately, and the inconsistency
 * would read as a bug in whichever field happened to be written last.
 *
 * A `success` verdict is passed through unconditionally — confirming a field is fine is never an
 * accusation, and withholding it until the second visit makes the tick look like it depends on
 * something other than the value.
 */
export function fieldStatus(fieldKey: string, verdict: FieldStatus): FieldStatus {
	if (verdict === "default" || verdict === "success") return verdict;
	if (isFocused(fieldKey)) return "default";
	return isTouched(fieldKey) ? verdict : "default";
}

/**
 * Forget every touch and the current focus.
 *
 * Called when the surface unmounts, because the keys carry stage and role ids: a second engagement
 * opened in the same session would otherwise inherit the first one's touched set and mark a brand
 * new stage's name as an omission the moment it is added.
 */
export function resetFieldValidation(): void {
	touchedKeys.value = new Set<string>();
	focusedKey.value = null;
}
// #endregion

// #region Enter advances focus
/**
 * Input types Enter may advance out of.
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

/**
 * Containers whose descendants own Enter for themselves.
 *
 * `.ui-chips` commits the chip being typed; anything with `role="combobox"` selects the active
 * option; a rich-text editor's contenteditable starts a paragraph. Each of those is a real
 * interaction that advancing focus would silently replace.
 */
const ENTER_OWNERS = '.ui-chips, [role="combobox"], [contenteditable="true"], .ql-editor';

/** The nearest boundary the advance may walk within, so Enter never leaves the form for the chrome. */
const ADVANCE_SCOPE = "form, .psu, .psu-shell";

/** Whether Enter on this element means "I am done here", as opposed to something of its own. */
function acceptsEnterAdvance(el: HTMLElement): boolean {
	if (el.isContentEditable) return false;
	if (!(el instanceof HTMLInputElement)) return false;
	if (el.readOnly || el.disabled) return false;
	if (!ADVANCEABLE_INPUT_TYPES.has(el.type)) return false;
	if (el.getAttribute("role") === "combobox") return false;
	return el.closest(ENTER_OWNERS) === null;
}

/**
 * Move focus to the next tabbable control when Enter is pressed on a single-line input.
 *
 * Wired ONCE, in the capture phase, on the form root — rather than per field. A control that mounts
 * later (a stage added mid-session) is covered by construction, and there is one implementation of
 * the bail-out rules instead of one per call site that could each be written slightly differently.
 *
 * `getTabbable` is the package's own tabbable resolver, reused rather than reimplemented: a second
 * selector would drift from the one every overlay's focus trap uses, and the two would then disagree
 * about what is reachable on the same page.
 *
 * Nothing is prevented unless a next control is actually found, so on the last field Enter keeps
 * whatever native meaning it had (submitting a real form, or nothing).
 */
export function advanceOnEnter(event: KeyboardEvent): void {
	if (event.key !== "Enter" || event.isComposing) return;
	// A modified Enter is somebody asking for something else entirely; leave it to the browser.
	if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;

	const target = event.target as HTMLElement | null;
	if (!target || !acceptsEnterAdvance(target)) return;

	// Never `document.body` as a fallback. A control that is inside no form boundary reached this
	// handler through a portal — an overlay panel rendered out of the tree it was opened from — and
	// walking the whole document from there would step focus out of that overlay entirely.
	const host = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
	const scope = target.closest<HTMLElement>(ADVANCE_SCOPE) ?? host;
	if (!scope || !scope.contains(target)) return;

	const order = getTabbable(scope);
	const index = order.indexOf(target);
	if (index === -1) return;

	const next = order[index + 1];
	if (!next) return;

	event.preventDefault();
	next.focus();
}
// #endregion

// #region The focus wrapper
/**
 * Props for {@link FieldGuard}.
 */
export interface FieldGuardProps {
	/** The key this subtree's control is tracked under. */
	fieldKey: string;
	/** Class applied to the wrapper element, so the guard can BE the field's own box. */
	class?: string;
	children: ComponentChildren;
}

/**
 * A wrapper that reports when the control inside it is entered and left.
 *
 * It exists because almost none of the `@projective/ui` field controls expose `onFocus`/`onBlur` —
 * they own their internal focus handling — and `packages/ui` is not this partition's to edit. The
 * CAPTURE variants are mandatory rather than stylistic: `focus` and `blur` do not bubble, so a
 * bubble-phase listener on an ancestor never fires. Capture runs from the root down to the target,
 * so it does.
 *
 * A move BETWEEN two elements inside the same guard — a number field and its own stepper — is not a
 * departure, so `relatedTarget` is checked before the field is marked touched. Without that, nudging
 * a spinner would flag the field the person is still working in.
 *
 * Built with `h` rather than JSX so this module stays a `.ts` file beside the two pure rules it
 * guards; one small element does not justify splitting the WHEN of a verdict away from the WHO of it.
 */
export function FieldGuard(
	{ fieldKey, class: className, children }: FieldGuardProps,
): JSX.Element {
	const onFocusCapture = () => markFocused(fieldKey);

	const onBlurCapture = (event: JSX.TargetedFocusEvent<HTMLDivElement>) => {
		const moving = event.relatedTarget as Node | null;
		if (moving && event.currentTarget.contains(moving)) return;
		if (focusedKey.value === fieldKey) markFocused(null);
		markTouched(fieldKey);
	};

	return h("div", { class: className, onFocusCapture, onBlurCapture }, children);
}
// #endregion
