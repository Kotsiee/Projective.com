/// <reference lib="dom" />

/**
 * The Enter chain — what Enter does inside a wizard step that is not a `<form>`.
 *
 * `/join` renders its steps in a plain `<div>`, so Enter has no implicit submission to fall back
 * on; without a rule it does nothing on every field. The rule: Enter on a field moves focus to the
 * NEXT field of the step, and on the step's last field it does what the Continue button does —
 * the next step, or submission on the final one. A control that owns Enter for its own purposes (a
 * select trigger, an open combobox, a tag draft, an incomplete date) keeps it: the chain only ever
 * acts on an event nothing else claimed (`defaultPrevented` is the whole test), which is why those
 * controls must `preventDefault` exactly when they act and never otherwise.
 *
 * The DOM half lives in `StepForm`; this module is the selector and the pure ordering rule, kept
 * apart so the rule is unit-testable and so the selector is written once.
 */

/**
 * The controls that take part in the chain, in DOM order. Radios are handled separately (a choice
 * card is picked, not stepped past); hidden, disabled and read-only inputs never join it. A select's
 * trigger is a DESTINATION — Enter on the field before it lands on it — but never a SOURCE: Enter
 * on the trigger opens the panel, which is the control's own Enter, so the handler acts only when
 * the event's target is an `<input>`.
 */
export const ENTER_CHAIN_SELECTOR = [
	'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([disabled]):not([readonly])',
	"button.ui-select__trigger:not([disabled])",
].join(",");

/** Where Enter goes from a field, over the step's chain of UNITS (see {@link chainUnitOf}). */
export type EnterMove =
	/** The target is not a chain field at all — leave the event alone. */
	| { kind: "outside" }
	/** Focus the unit at `index`. */
	| { kind: "next"; index: number }
	/** The target ends the chain — advance the wizard. */
	| { kind: "end" };

/**
 * Resolve Enter over a step's units. `units` is one entry per chain field, where fields belonging
 * to one composite control (a segmented date's three inputs) carry the SAME unit, so Enter on any
 * of them skips the whole control rather than walking its segments. Pure and total.
 */
export function resolveEnterMove<T>(units: readonly T[], target: T): EnterMove {
	const i = units.indexOf(target);
	if (i < 0) return { kind: "outside" };
	for (let k = i + 1; k < units.length; k++) {
		if (units[k] !== target) return { kind: "next", index: k };
	}
	return { kind: "end" };
}

/**
 * The unit a chain field belongs to. A segmented `DatePicker` is three `<input>`s inside one
 * `.ui-datepicker__trigger`; Enter on its day segment must not "move on" to its month segment.
 */
export function chainUnitOf(el: Element): Element {
	return el.closest(".ui-datepicker__trigger") ?? el;
}
