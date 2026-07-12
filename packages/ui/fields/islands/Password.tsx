import type { CSSProperties, JSX, VNode } from "preact";
import { useState } from "preact/hooks";
import "../styles/field.css";
import "../styles/password.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import { describedBy } from "../core/ids.ts";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

export interface PasswordProps extends BaseFieldProps {
	/** Bound secret value. */
	value?: Bindable<string>;
	/** Fired on every keystroke with the new value. */
	onValueChange?: ValueChange<string>;
	/** Placeholder text. */
	placeholder?: string;
	/** Render a show/hide button that toggles the input between `password` and `text`. */
	toggleMask?: boolean;
	/** Render a live strength meter beneath the control. */
	feedback?: boolean;
	/** Autocomplete hint (default `current-password`). */
	autoComplete?: string;
	/** Surface treatment (§ FieldVariant). */
	variant?: FieldVariant;
	class?: string;
	style?: CSSProperties;
}

const EYE: VNode = (
	<svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true" fill="none">
		<path
			d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
			stroke="currentColor"
			stroke-width="1.4"
		/>
		<circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.4" />
	</svg>
);
const EYE_OFF: VNode = (
	<svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true" fill="none">
		<path
			d="M1.5 10S4.5 4 10 4c1.6 0 3 .5 4.2 1.2M18.5 10s-3 6-8.5 6c-1.6 0-3-.5-4.2-1.2"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
		/>
		<path d="M3 3l14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
	</svg>
);

type StrengthTier = "empty" | "weak" | "medium" | "strong";

/** Score a password 0..4 from length thresholds plus distinct character-class coverage. */
function scorePassword(pw: string): number {
	if (!pw) return 0;
	let score = 0;
	if (pw.length >= 8) score += 1;
	if (pw.length >= 12) score += 1;
	let classes = 0;
	if (/[a-z]/.test(pw)) classes += 1;
	if (/[A-Z]/.test(pw)) classes += 1;
	if (/[0-9]/.test(pw)) classes += 1;
	if (/[^A-Za-z0-9]/.test(pw)) classes += 1;
	score += Math.max(0, classes - 1);
	return Math.min(4, score);
}

function tierFor(score: number): StrengthTier {
	if (score <= 0) return "empty";
	if (score <= 1) return "weak";
	if (score === 2) return "medium";
	return "strong";
}

const TIER_LABEL: Record<StrengthTier, string> = {
	empty: "Enter a password",
	weak: "Weak password",
	medium: "Medium strength",
	strong: "Strong password",
};

/**
 * Password — a masked secret field. An optional real `<button>` toggles visibility (swapping the
 * input type, reflecting state via `aria-pressed` and a descriptive `aria-label`). With `feedback`, a
 * strength meter scores the value 0..4 from length and character-class coverage and renders a tonal
 * bar (weak → `--danger`, medium → `--warning`, strong → `--success`) plus an `aria-live` label.
 * Composes the shared `.ui-field` geometry with validation status and the standard field semantics.
 */
export function Password(props: PasswordProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder,
		toggleMask,
		feedback,
		autoComplete = "current-password",
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
		"aria-describedby": ariaDescribedBy,
		...aria
	} = props;

	const ctrl = useControllable<string>(value, "", onValueChange);
	const inputId = useId(id, "password");
	const meterId = `${inputId}-strength`;
	const [visible, setVisible] = useState(false);

	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		ctrl.set(e.currentTarget.value);
	};

	const currentValue = ctrl.signal.value;
	const score = feedback ? scorePassword(currentValue) : 0;
	const tier = tierFor(score);

	return (
		<div class={cx("ui-password", fluid && "ui-password--fluid", className)}>
			<span
				class={cx(
					"ui-field",
					"ui-password__control",
					...fieldModifiers("ui-field", { size, variant, status, fluid, disabled, readOnly }),
				)}
				style={style && styleVars({}, style)}
			>
				<input
					id={inputId}
					name={name}
					type={visible ? "text" : "password"}
					class="ui-field__input ui-password__input"
					value={currentValue}
					placeholder={placeholder}
					disabled={disabled}
					readOnly={readOnly}
					required={required}
					autoComplete={autoComplete}
					aria-invalid={ariaInvalid(status)}
					aria-required={required || undefined}
					aria-describedby={describedBy(ariaDescribedBy, feedback && meterId)}
					onInput={onInput}
					{...aria}
				/>
				{toggleMask && (
					<button
						type="button"
						class="ui-password__toggle"
						aria-pressed={visible}
						aria-label={visible ? "Hide password" : "Show password"}
						aria-controls={inputId}
						disabled={disabled}
						onClick={() => setVisible((v) => !v)}
					>
						<span class="ui-password__toggle-icon">{visible ? EYE_OFF : EYE}</span>
					</button>
				)}
			</span>
			{feedback && (
				<div
					class={cx("ui-password__meter", tier !== "empty" && `ui-password__meter--${tier}`)}
					style={styleVars({ "--pw-fill": `${(score / 4) * 100}%` })}
				>
					<div class="ui-password__meter-track" role="presentation">
						<div class="ui-password__meter-fill" />
					</div>
					<span id={meterId} class="ui-password__strength-text" aria-live="polite">
						{TIER_LABEL[tier]}
					</span>
				</div>
			)}
		</div>
	);
}
