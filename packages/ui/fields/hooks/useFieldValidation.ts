/**
 * `useFieldValidation` — the field-validation state policy, as a signal (DESIGN_SYSTEM.md §A.7.5).
 *
 * A control's `status` prop is not just paint: `invalid` and `required` also set `aria-invalid`. So
 * deciding WHEN to pass one is an accessibility decision, and every form that answered it privately
 * answered it slightly differently. This hook is the one answer, and it owns exactly the lifecycle
 * that question turns on — has the reader finished with this field, are they inside it right now,
 * and has the form demanded an answer.
 *
 * It adds no rules of its own: the rules live in the pure {@link resolveFieldVerdict}, which is
 * where they can be tested without a DOM. The hook contributes the signals and the two handlers.
 *
 * ```tsx
 * const reveal = useSignal(false);                       // one per FORM, shared by every field
 * const title = useSignal("");
 * const v = useFieldValidation({
 *   problem: () => title.value.trim() === "" ? "A title is required." : null,
 *   reveal,
 * });
 *
 * <FormControl label="Title" status={v.hintStatus.value} error={v.message.value}>
 *   {({ id, describedBy }) => (
 *     <InputText
 *       id={id}
 *       aria-describedby={describedBy}
 *       value={title}
 *       status={v.status.value}
 *       onFocus={v.handlers.onFocus}
 *       onBlur={v.handlers.onBlur}
 *       fluid
 *     />
 *   )}
 * </FormControl>
 * ```
 *
 * On submit the form sets `reveal.value = true`, and every field that has never been touched paints
 * at once — the single moment an untouched field legitimately does, because a refusal with no
 * visible cause is worse than an early warning.
 *
 * **Two status channels, and the difference is the point.** `status` goes to the CONTROL and stands
 * down while the field holds focus, so the focus treatment owns the outline alone. `hintStatus` goes
 * to the MESSAGE ROW and does not, so the sentence explaining the problem is still on screen while
 * the reader acts on it. Passing `status` to both would take the explanation away at the exact
 * moment it is needed.
 */
import { type ReadonlySignal, Signal, useComputed, useSignal } from "@preact/signals";
import { useCallback, useMemo } from "preact/hooks";
import { type FieldVerdict, resolveFieldVerdict } from "../core/field.ts";
import type { FieldStatus } from "../types/mod.ts";

// #region Inputs
/**
 * A verdict source: a fixed value, a signal, or a function evaluated inside the hook's computed —
 * the function form is the usual one, because it subscribes to whatever signals it reads and so
 * re-runs when the value it is judging changes.
 */
export type FieldProblemSource =
	| string
	| null
	| ReadonlySignal<string | null>
	| (() => string | null);

/** A flag that may be supplied raw or as a shared signal (the submit-time reveal). */
export type FieldFlagSource = boolean | ReadonlySignal<boolean>;

/** Options for {@link useFieldValidation}. */
export interface FieldValidationOptions {
	/** What is wrong with the current value, or `null` when nothing is. */
	problem: FieldProblemSource;
	/**
	 * The form has demanded every verdict be shown. One `Signal<boolean>` per form, handed to every
	 * field, set `true` by the submit handler.
	 */
	reveal?: FieldFlagSource;
	/** The status painted for a revealed problem. Default `"invalid"`. */
	problemStatus?: FieldStatus;
	/**
	 * The status painted for a revealed field with nothing wrong. Default `"default"` — a column of
	 * green ticks is noise, so `"success"` is opt-in for the few fields where confirming a hard-won
	 * value genuinely helps.
	 */
	resolvedStatus?: FieldStatus;
	/**
	 * Treat the field as already finished with on first paint. For a form seeded from an existing
	 * record, where every value has been "submitted" before and a problem is a real one, not a field
	 * nobody has reached yet.
	 */
	initiallyTouched?: boolean;
}
// #endregion

// #region Result
/** The live validation state of one field. */
export interface FieldValidation {
	/** The whole verdict, for a caller that wants to destructure it once. */
	verdict: ReadonlySignal<FieldVerdict>;
	/** The status for the CONTROL — cleared while the field holds focus. */
	status: ReadonlySignal<FieldStatus>;
	/** The status for the MESSAGE ROW — survives focus. */
	hintStatus: ReadonlySignal<FieldStatus>;
	/** The sentence to render beneath the control, or `null`. */
	message: ReadonlySignal<string | null>;
	/** Whether the verdict is being shown at all. */
	revealed: ReadonlySignal<boolean>;
	/**
	 * The raw verdict, independent of whether it is being shown. This is what a submit handler asks
	 * — "is this form actually valid" is a different question from "is this field painted red".
	 */
	problem: ReadonlySignal<string | null>;
	/** Finished-with-at-least-once. Writable, for a caller with its own touch source. */
	touched: Signal<boolean>;
	/** Currently focused. Writable, for a control that tracks focus itself. */
	focused: Signal<boolean>;
	/** Focus/blur handlers to hand the control. Stable across renders, so they may be spread. */
	handlers: FieldFocusHandlers;
	/** Return to untouched and unfocused — for a form that has been re-seeded or cleared. */
	reset: () => void;
}

/** The two handlers that drive the lifecycle. Shaped to drop straight onto any control's props. */
export interface FieldFocusHandlers {
	onFocus: () => void;
	onBlur: () => void;
}
// #endregion
// #region Reading the sources
function readProblem(source: FieldProblemSource): string | null {
	if (typeof source === "function") return source();
	// `ReadonlySignal<T>` is invariant in `T`, so `instanceof Signal` narrows the positive branch and
	// not the negative one; both sides are therefore asserted rather than inferred.
	if (source instanceof Signal) return (source as ReadonlySignal<string | null>).value;
	return (source as string | null) ?? null;
}

function readFlag(source: FieldFlagSource | undefined): boolean {
	if (source instanceof Signal) return (source as ReadonlySignal<boolean>).value === true;
	return source === true;
}

/**
 * A stable key over the options that are NOT signals.
 *
 * A computed re-runs only when a signal it read has changed, so an option delivered as a plain value
 * would be read once on the first evaluation and then held forever — a caller that swapped
 * `problemStatus` from `"invalid"` to `"gate"`, or passed `problem` as a bare string, would keep the
 * previous answer with nothing to indicate why. Mirroring those into one signal the computed also
 * reads is what makes an ordinary re-render count as a change. Signal and function sources are
 * excluded deliberately: they are already reactive, and stringifying them here would either subscribe
 * the component to every keystroke or invoke the predicate twice per render.
 */
function plainKeyOf(options: FieldValidationOptions): string {
	const problem = typeof options.problem === "function" || options.problem instanceof Signal
		? null
		: options.problem;
	const reveal = options.reveal instanceof Signal ? null : options.reveal;
	return JSON.stringify([problem, reveal, options.problemStatus, options.resolvedStatus]);
}
// #endregion

// #region The hook
/**
 * @param options The verdict source plus the reveal channel and status choices.
 * @returns Live signals for the two status channels, the message, and the lifecycle handlers.
 */
export function useFieldValidation(options: FieldValidationOptions): FieldValidation {
	const touched = useSignal(options.initiallyTouched === true);
	const focused = useSignal(false);

	// Written during render, never subscribed to here — `peek()` compares without making this
	// component a dependency of its own mirror.
	const plainOptions = useSignal(plainKeyOf(options));
	const plainKey = plainKeyOf(options);
	if (plainOptions.peek() !== plainKey) plainOptions.value = plainKey;

	const verdict = useComputed<FieldVerdict>(() => {
		// Reading the mirror is what registers it as a dependency; the value itself is not wanted.
		plainOptions.value;
		return resolveFieldVerdict({
			problem: readProblem(options.problem),
			touched: touched.value,
			focused: focused.value,
			reveal: readFlag(options.reveal),
			problemStatus: options.problemStatus,
			resolvedStatus: options.resolvedStatus,
		});
	});

	const status = useComputed(() => verdict.value.status);
	const hintStatus = useComputed(() => verdict.value.hintStatus);
	const message = useComputed(() => verdict.value.message);
	const revealed = useComputed(() => verdict.value.revealed);
	const problem = useComputed(() => {
		// Same dependency registration: a plain-string `problem` cannot announce its own change.
		plainOptions.value;
		return readProblem(options.problem);
	});

	// Blur is what makes a field "touched" — the off-click is the moment the reader has finished
	// with it and a verdict has been earned. Focus only lowers the paint; it never un-touches, so a
	// field the reader returns to keeps its message.
	const handlers = useMemo<FieldFocusHandlers>(() => ({
		onFocus: () => {
			focused.value = true;
		},
		onBlur: () => {
			focused.value = false;
			touched.value = true;
		},
	}), [focused, touched]);

	const reset = useCallback(() => {
		touched.value = false;
		focused.value = false;
	}, [touched, focused]);

	return {
		verdict,
		status,
		hintStatus,
		message,
		revealed,
		problem,
		touched,
		focused,
		handlers,
		reset,
	};
}
// #endregion
