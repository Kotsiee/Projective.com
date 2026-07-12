import type { CSSProperties, JSX } from "preact";
import { useMemo } from "preact/hooks";
import "../styles/field.css";
import "../styles/input-mask.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

/** Map of mask placeholder character → the RegExp a typed char must satisfy to fill that slot. */
export type MaskDefinitions = Record<string, RegExp>;

/** Default slot definitions: `9` digit, `a` letter, `*` alphanumeric (PrimeNG parity). */
const DEFAULT_DEFINITIONS: MaskDefinitions = {
	"9": /[0-9]/,
	"a": /[A-Za-z]/,
	"*": /[A-Za-z0-9]/,
};

export interface InputMaskProps extends BaseFieldProps {
	/** Bound masked value. */
	value?: Bindable<string>;
	/** Fired whenever the masked value changes. */
	onValueChange?: ValueChange<string>;
	/** Mask pattern, e.g. `"(999) 999-9999"`, `"99/99/9999"`, `"a*-9999"`. */
	mask: string;
	/** Character shown for an unfilled slot (default `_`). */
	slotChar?: string;
	/** Override/extend the slot-character → RegExp definitions. */
	definitions?: MaskDefinitions;
	/** Placeholder (falls back to the empty-slot template when omitted). */
	placeholder?: string;
	/** Surface treatment (§ FieldVariant). */
	variant?: FieldVariant;
	class?: string;
	style?: CSSProperties;
}

/**
 * InputMask — a fixed-pattern text input. Each mask character is either a literal (inserted
 * automatically) or a slot whose {@link MaskDefinitions} RegExp filters typed characters; unfilled
 * slots render the `slotChar`. On every input the raw text is stripped of slot characters and
 * re-applied against the mask, which keeps the value consistent under insertion and backspacing.
 * Composes the shared `.ui-field` geometry with full ARIA + validation status.
 */
export function InputMask(props: InputMaskProps): JSX.Element {
	const {
		value,
		onValueChange,
		mask,
		slotChar = "_",
		definitions,
		placeholder,
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
	const inputId = useId(id, "inputmask");

	const defs = useMemo<MaskDefinitions>(() => ({ ...DEFAULT_DEFINITIONS, ...definitions }), [
		definitions,
	]);

	// #region Mask engine
	/** Re-apply the mask to a sequence of candidate data characters, filling unmatched slots. */
	const format = (raw: string): string => {
		const maskChars = [...mask];
		const dataChars = [...raw];
		let out = "";
		let di = 0;
		for (let mi = 0; mi < maskChars.length; mi++) {
			const mc = maskChars[mi];
			const def = defs[mc];
			if (def) {
				let matched = "";
				while (di < dataChars.length) {
					const c = dataChars[di++];
					if (def.test(c)) {
						matched = c;
						break;
					}
				}
				if (matched) {
					out += matched;
				} else {
					for (; mi < maskChars.length; mi++) {
						out += defs[maskChars[mi]] ? slotChar : maskChars[mi];
					}
					return out;
				}
			} else {
				out += mc;
			}
		}
		return out;
	};

	const emptyTemplate = useMemo(() => format(""), [mask, slotChar, defs]);
	const displayValue = ctrl.signal.value ? format(ctrl.signal.value.split(slotChar).join("")) : "";
	// #endregion

	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		const stripped = e.currentTarget.value.split(slotChar).join("");
		ctrl.set(stripped === "" ? "" : format(stripped));
	};

	const onFocus = (e: JSX.TargetedFocusEvent<HTMLInputElement>) => {
		if (!ctrl.get()) {
			ctrl.set(emptyTemplate);
			const el = e.currentTarget;
			globalThis.requestAnimationFrame(() => {
				const caret = Math.max(0, emptyTemplate.indexOf(slotChar));
				el.setSelectionRange(caret, caret);
			});
		}
	};

	const onBlur = () => {
		if (ctrl.get() === emptyTemplate) ctrl.set("");
	};

	return (
		<span
			class={cx(
				"ui-field",
				"ui-input-mask",
				...fieldModifiers("ui-field", { size, variant, status, fluid, disabled, readOnly }),
				className,
			)}
			style={style && styleVars({}, style)}
		>
			<input
				id={inputId}
				name={name}
				type="text"
				class="ui-field__input ui-input-mask__input"
				value={displayValue}
				placeholder={placeholder ?? emptyTemplate}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onInput={onInput}
				onFocus={onFocus}
				onBlur={onBlur}
				{...aria}
			/>
		</span>
	);
}
