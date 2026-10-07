/// <reference lib="dom" />

/**
 * details-keys — Enter walks the Details form forward, and Enter on its last field submits it.
 *
 * A checkout form is filled top to bottom in one sitting, so Enter is given the meaning a buyer
 * reaches for: "this one is done, take me to the next". Shift+Tab stays the native way back — nothing
 * here intercepts it — and Tab keeps its native order, which is the same DOM order.
 *
 * **Pickers are fields too, but they own an Enter of their own.** A select trigger opens its list on
 * Enter. So the rule for a picker is: while its list is OPEN, Enter belongs to the list (it chooses
 * the active option); a picker that already holds a value is stepped over like a filled text field;
 * an EMPTY required picker is left to open, because the buyer still has to answer it and stepping past
 * it would only send them back to it from the missing-fields summary.
 *
 * That is the one deliberate difference from `/join`'s Enter chain (`auth/core/enter-chain.ts`),
 * where a select trigger is only ever a DESTINATION. Here the address — and so the form — ends on the
 * Country picker, so a filled picker must also be a SOURCE, or Enter could never reach Continue.
 *
 * The decision ({@link enterOutcome}) is pure so it can be tested without a DOM; the adapter
 * ({@link handleDetailsEnter}) reads the live controls in DOM order at the moment of the key press,
 * so a field that appears mid-flow (a State control once a country that uses one is chosen) is in the
 * order the instant it renders.
 */

// #region Decision
/** One control in the form's Enter order, as far as Enter cares. */
export interface EnterStep {
	/** A picker (a `role="combobox"` trigger) rather than a text input. */
	picker: boolean;
	/** The picker's list is open — Enter belongs to the list. */
	open: boolean;
	/** The control holds a value. */
	filled: boolean;
	/** The control must be answered before the form can go anywhere. */
	required: boolean;
}

/** What Enter does on the control at a given position. */
export type EnterOutcome =
	| { kind: "native" }
	| { kind: "focus"; index: number }
	| { kind: "submit" };

/**
 * The outcome of Enter on `steps[at]`.
 *
 * `native` leaves the key to the control (an open list, an empty required picker, or a control that
 * is not part of the walk at all); `focus` moves to the next control; `submit` is Enter on the last.
 */
export function enterOutcome(steps: readonly EnterStep[], at: number): EnterOutcome {
	const step = steps[at];
	if (!step) return { kind: "native" };
	if (step.picker && (step.open || (step.required && !step.filled))) return { kind: "native" };
	return at + 1 < steps.length ? { kind: "focus", index: at + 1 } : { kind: "submit" };
}
// #endregion

// #region DOM adapter
/** Every control that takes part in the walk: text-like inputs and picker triggers. */
const STEP_SELECTOR = [
	'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])' +
	':not([type="button"]):not([type="submit"]):not([type="reset"])',
	'button[role="combobox"]',
].join(", ");

/**
 * Controls deliberately outside the walk: the phone's dial-code prefix (a default the number sits
 * beside, not a field of its own) and the invoicing block (a separate, account-level decision whose
 * controls are a switch and a day — not the next line of an address).
 */
const SKIP_SELECTOR = ".ckod-phone__dial, .ckod-inv";

/** The form's walkable controls, in DOM order — rendered and enabled ones only. */
export function enterStepsOf(form: HTMLFormElement): HTMLElement[] {
	return [...form.querySelectorAll<HTMLElement>(STEP_SELECTOR)].filter((element) =>
		!element.closest(SKIP_SELECTOR) &&
		!(element as HTMLInputElement | HTMLButtonElement).disabled &&
		element.getClientRects().length > 0
	);
}

/** Read one live control as an {@link EnterStep}. */
function describe(element: HTMLElement): EnterStep {
	const picker = element.getAttribute("role") === "combobox";
	const filled = picker
		? element.closest("[data-filled]")?.getAttribute("data-filled") === "true"
		: (element as HTMLInputElement).value.trim() !== "";
	return {
		picker,
		open: element.getAttribute("aria-expanded") === "true",
		filled,
		required: element.getAttribute("aria-required") === "true" ||
			(element as HTMLInputElement).required === true,
	};
}

/**
 * The form's capture-phase key handler.
 *
 * Capture, not bubble: a picker's own handler sits on its trigger and would open the list before a
 * bubbling handler ever saw the key, so stepping over a filled picker has to be decided first.
 * Modified presses (Shift, Alt, Ctrl, Meta) and IME composition are never touched.
 */
export function handleDetailsEnter(event: KeyboardEvent, form: HTMLFormElement | null): void {
	if (!form || event.key !== "Enter" || event.isComposing) return;
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;

	const elements = enterStepsOf(form);
	const outcome = enterOutcome(
		elements.map(describe),
		elements.indexOf(event.target as HTMLElement),
	);
	if (outcome.kind === "native") return;

	event.preventDefault();
	event.stopPropagation();
	if (outcome.kind === "focus") elements[outcome.index]?.focus();
	else form.requestSubmit();
}
// #endregion
