import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/form-control.css";
import { cx } from "../../core/cx.ts";
import { useId } from "../hooks/useId.ts";
import { fieldIds } from "../core/ids.ts";
import { formControlRows } from "../core/form-control-model.ts";
import { AlertMark } from "../components/field-marks.tsx";
import { HintPopover } from "../../feedback/islands/HintPopover.tsx";
import type { FieldStatus } from "../types/mod.ts";

export interface FormControlRenderArgs {
	/** Wire onto the control's `id`. */
	id: string;
	/** Wire onto the control's `aria-describedby`. */
	describedBy: string | undefined;
	/** Pass through so the control reflects the group's validity. */
	status: FieldStatus;
	/** Pass through so the control reflects the required flag. */
	required: boolean | undefined;
	/**
	 * The visible label's id (when there is a label). A control that is not labelable by `<label for>` —
	 * a `role="radiogroup"`, a listbox — names itself with `aria-labelledby={labelId}` instead.
	 */
	labelId: string | undefined;
}

export interface FormControlProps {
	/** Visible label text. Rendered as a real `<label for>` bound to the control. */
	label?: string;
	/** Helper/description text (id wired into `aria-describedby`); shown per {@link hintMode}. */
	hint?: string;
	/**
	 * How the hint shows. `popover` (default, Decision #305): a `HintPopover` "?" beside the label,
	 * the text kept visually hidden for `aria-describedby`. `inline`: a visible line under the
	 * control — only for what the user must see without asking: a live counter, a warning, a reason a
	 * control is locked or empty, an instruction the value must match. Without a label it is inline.
	 */
	hintMode?: "popover" | "inline";
	/** Live text that always shows in the hint row (a character counter); an error replaces it. */
	note?: string;
	/** Error message — when present with `status="invalid"` it replaces the hint and colours red. */
	error?: string;
	/** Validation status forwarded to the render child. */
	status?: FieldStatus;
	/** Marks the control required (adds the required asterisk + forwards the flag). */
	required?: boolean;
	/**
	 * Collapse the reserved hint row when this field has neither hint nor error. Off by default: the
	 * row holds its height so a validation message appearing mid-form cannot shove the fields below
	 * it down the page. Set it only for a one-field form where nothing can shift.
	 */
	collapseHint?: boolean;
	class?: string;
	/**
	 * Either a render function that receives the wired ids/status, or plain children (for which you
	 * wire `id`/`aria-describedby` yourself using the generated ids — the function form is preferred).
	 */
	children: ((args: FormControlRenderArgs) => VNode) | ComponentChildren;
}

/**
 * FormControl — the field wrapper. Owns the label ↔ control ↔ hint/error relationship and the ARIA
 * wiring (`for`, `aria-describedby`, required asterisk), so individual controls stay focused on their
 * own behaviour. A hint sits behind a "?" beside the label unless `hintMode="inline"`; the error row
 * stays reserved either way. Separation via spacing + type weight, never a bordering box (§B.4). Prefer the
 * render-function child so the ids are threaded automatically:
 *
 * ```tsx
 * <FormControl label="Email" hint="We never share it." required>
 *   {({ id, describedBy, required }) => (
 *     <InputText id={id} aria-describedby={describedBy} required={required} fluid />
 *   )}
 * </FormControl>
 * ```
 */
export function FormControl(props: FormControlProps): JSX.Element {
	const {
		label,
		hint,
		hintMode = "popover",
		note,
		error,
		status = "default",
		required,
		collapseHint,
		class: className,
		children,
	} = props;
	const rootId = useId(undefined, "field");
	const ids = fieldIds(rootId);
	const rows = formControlRows({ rootId, label, hint, hintMode, note, error, status });
	const showError = rows.row?.error === true;
	// The row is rendered even when empty so its height is already accounted for.
	const reserveHint = !collapseHint;

	const rendered = typeof children === "function"
		? (children as (a: FormControlRenderArgs) => VNode)({
			id: rootId,
			describedBy: rows.describedBy,
			status,
			required,
			labelId: label ? ids.label : undefined,
		})
		: children;

	return (
		<div
			class={cx("ui-form-control", status !== "default" && `ui-form-control--${status}`, className)}
		>
			{label && (
				<div class="ui-form-control__labelrow">
					<label class="ui-field-label" for={rootId} id={ids.label}>
						{label}
						{required && <span class="ui-field-label__required" aria-hidden="true">*</span>}
					</label>
					{rows.behindHint && (
						<HintPopover label={`About ${label.toLowerCase()}`}>{hint}</HintPopover>
					)}
				</div>
			)}
			<div class="ui-form-control__control">{rendered}</div>
			{rows.behindHint && !showError && (
				<span id={rows.aboutId} class="ui-visually-hidden">{hint}</span>
			)}
			{(rows.row || reserveHint) && (
				<p
					id={rows.row?.id}
					class={cx("ui-field-hint", showError && "ui-field-hint--error")}
					role={showError ? "alert" : undefined}
				>
					{showError && (
						<span class="ui-field-hint__icon" aria-hidden="true">
							<AlertMark />
						</span>
					)}
					{rows.row?.text}
				</p>
			)}
		</div>
	);
}

/**
 * FieldLegend — the one-line explanation an asterisk needs. A form that marks any control `required`
 * renders this once, near its submit action: a lone `*` with nothing to decode it is exactly the
 * anti-pattern the marker is supposed to solve.
 */
export function FieldLegend(props: { text?: string; class?: string }): JSX.Element {
	return (
		<p class={cx("ui-field-legend", props.class)}>
			<span class="ui-field-legend__mark" aria-hidden="true">*</span>{" "}
			{props.text ?? "Required to continue"}
		</p>
	);
}
