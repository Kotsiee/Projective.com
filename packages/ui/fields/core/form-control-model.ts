import { describedBy, fieldIds } from "./ids.ts";
import type { FieldStatus } from "../types/mod.ts";

/** What {@link formControlRows} reads from a field. */
export interface FormControlRowsInput {
	rootId: string;
	label?: string;
	hint?: string;
	hintMode?: "popover" | "inline";
	note?: string;
	error?: string;
	status?: FieldStatus;
}

/** Where a field's hint, note and error render, and what its control is described by. */
export interface FormControlRows {
	/** The hint sits behind a `HintPopover` "?" beside the label. */
	behindHint: boolean;
	/** The visually hidden copy of that hint, which the control's description points at. */
	aboutId: string;
	/** The visible row under the control: the error, or the inline hint and note. */
	row: { id: string; text: string; error: boolean } | null;
	/** The control's `aria-describedby`. */
	describedBy: string | undefined;
}

/**
 * The hint, note and error wiring of `FormControl` (Decision #305). A hint goes behind a "?" beside
 * the label unless `hintMode` is `inline` or there is no label; a note (a live counter) always
 * shows; an error — `invalid`, or the `required` creation gate — replaces both and is the only
 * description while it shows.
 */
export function formControlRows(input: FormControlRowsInput): FormControlRows {
	const ids = fieldIds(input.rootId);
	const aboutId = `${input.rootId}-about`;
	const status = input.status ?? "default";
	const showError = (status === "invalid" || status === "required") && !!input.error;
	const behindHint = (input.hintMode ?? "popover") === "popover" && !!input.label && !!input.hint;
	const inline = [behindHint ? undefined : input.hint, input.note].filter(Boolean).join(" ");
	const row = showError
		? { id: ids.error, text: input.error ?? "", error: true }
		: inline
		? { id: ids.hint, text: inline, error: false }
		: null;
	return {
		behindHint,
		aboutId,
		row,
		describedBy: describedBy(row?.id, behindHint && !showError && aboutId),
	};
}
