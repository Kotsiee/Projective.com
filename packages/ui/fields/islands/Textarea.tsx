import type { CSSProperties, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/field.css";
import "../styles/textarea.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

export interface TextareaProps extends BaseFieldProps {
	/** Bound text value — raw string (uncontrolled) or `Signal<string>` (controlled). */
	value?: Bindable<string>;
	/** Fired on every keystroke with the new value. */
	onValueChange?: ValueChange<string>;
	/** Placeholder text. */
	placeholder?: string;
	/** Visible rows (initial height floor). */
	rows?: number;
	/** Grow the control to fit its content height, up to `maxRows`. */
	autoResize?: boolean;
	/** Upper bound (in rows) for `autoResize` before the control starts scrolling. */
	maxRows?: number;
	/** Maximum character length. */
	maxLength?: number;
	/** Surface treatment (§ FieldVariant). */
	variant?: FieldVariant;
	class?: string;
	style?: CSSProperties;
}

/**
 * Textarea — the multiline text control. Signal-first, composing the shared `.ui-field` geometry with
 * a relaxed (auto) block-size so the field can grow. With `autoResize` the element's height is
 * recomputed imperatively on every input to hug its content, capped at `maxRows` before it scrolls.
 * Supports outlined/filled/transparent variants, `fluid` sizing, validation status, and the shared
 * disabled/read-only/required semantics.
 */
export function Textarea(props: TextareaProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder,
		rows = 3,
		autoResize,
		maxRows,
		maxLength,
		variant = "outlined",
		fluid,
		size = "md",
		status = "default",
		id,
		name,
		disabled,
		readOnly,
		required,
		class: className,
		style,
		...aria
	} = props;

	const ctrl = useControllable<string>(value, "", onValueChange);
	const inputId = useId(id, "textarea");
	const ref = useRef<HTMLTextAreaElement>(null);

	// #region Auto-resize
	const resize = () => {
		const el = ref.current;
		if (!el || !autoResize) return;
		el.style.height = "auto";
		let next = el.scrollHeight;
		if (maxRows && maxRows > 0) {
			const cs = globalThis.getComputedStyle(el);
			const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
			const vertical = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
				parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
			const cap = lineHeight * maxRows + vertical;
			if (next > cap) {
				next = cap;
				el.style.overflowY = "auto";
			} else {
				el.style.overflowY = "hidden";
			}
		}
		el.style.height = `${next}px`;
	};

	useEffect(() => {
		resize();
	}, [autoResize, maxRows]);
	// #endregion

	const onInput = (e: JSX.TargetedEvent<HTMLTextAreaElement>) => {
		ctrl.set(e.currentTarget.value);
		resize();
	};

	return (
		<span
			class={cx(
				"ui-field",
				"ui-textarea",
				...fieldModifiers("ui-field", { size, variant, status, fluid, disabled, readOnly }),
				autoResize && "ui-textarea--auto-resize",
				className,
			)}
			style={style && styleVars({}, style)}
		>
			<textarea
				ref={ref}
				id={inputId}
				name={name}
				class="ui-field__input ui-textarea__input"
				value={ctrl.signal.value}
				placeholder={placeholder}
				rows={rows}
				maxLength={maxLength}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onInput={onInput}
				{...aria}
			/>
		</span>
	);
}
