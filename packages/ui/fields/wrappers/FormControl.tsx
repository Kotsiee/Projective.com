import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/form-control.css";
import { cx } from "../../core/cx.ts";
import { useId } from "../hooks/useId.ts";
import { describedBy, fieldIds } from "../core/ids.ts";
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
}

export interface FormControlProps {
	/** Visible label text. Rendered as a real `<label for>` bound to the control. */
	label?: string;
	/** Helper/description text under the control (id wired into `aria-describedby`). */
	hint?: string;
	/** Error message — when present with `status="invalid"` it replaces the hint and colours red. */
	error?: string;
	/** Validation status forwarded to the render child. */
	status?: FieldStatus;
	/** Marks the control required (adds the required asterisk + forwards the flag). */
	required?: boolean;
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
 * own behaviour. Separation via spacing + type weight, never a bordering box (§B.4). Prefer the
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
	const { label, hint, error, status = "default", required, class: className, children } = props;
	const rootId = useId(undefined, "field");
	const ids = fieldIds(rootId);
	const showError = status === "invalid" && !!error;
	const description = showError ? error : hint;
	const descId = showError ? ids.error : hint ? ids.hint : undefined;

	const rendered = typeof children === "function"
		? (children as (a: FormControlRenderArgs) => VNode)({
			id: rootId,
			describedBy: describedBy(descId),
			status,
			required,
		})
		: children;

	return (
		<div
			class={cx("ui-form-control", status !== "default" && `ui-form-control--${status}`, className)}
		>
			{label && (
				<label class="ui-field-label" for={rootId} id={ids.label}>
					{label}
					{required && <span class="ui-field-label__required" aria-hidden="true">*</span>}
				</label>
			)}
			<div class="ui-form-control__control">{rendered}</div>
			{description && (
				<p
					id={descId}
					class={cx("ui-field-hint", showError && "ui-field-hint--error")}
					role={showError ? "alert" : undefined}
				>
					{description}
				</p>
			)}
		</div>
	);
}
