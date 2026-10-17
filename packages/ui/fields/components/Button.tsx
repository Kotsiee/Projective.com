import type { JSX } from "preact";
import "../styles/button.css";
import { cx } from "../../core/cx.ts";
import type { ButtonProps } from "../types/button.ts";

export type {
	ButtonAccentTone,
	ButtonBaseProps,
	ButtonNeutralTone,
	ButtonProps,
	ButtonSemanticTone,
	ButtonSeverity,
	ButtonStructuralTone,
	ButtonVariant,
} from "../types/button.ts";

/**
 * Button — the primary action control. Covers every PrimeNG treatment: filled/outlined/text/link
 * variants across all seven severities, the filled-only amber `accent` commit tier, the filled-only
 * monochrome `structural` tier, the outlined-only `neutral` utility tier, raised/rounded
 * modifiers, icon (+ position) and icon-only forms, a corner badge, and a loading state that shows a
 * spinner and sets `aria-busy`. Fully keyboard-operable via the native `<button>`; disabled/loading
 * remove it from activation.
 */
export function Button(props: ButtonProps): JSX.Element {
	const {
		label,
		severity = "primary",
		variant = "filled",
		structural,
		size = "md",
		raised,
		rounded,
		iconOnly,
		icon,
		iconPos = "left",
		loading,
		badge,
		fluid,
		disabled,
		type = "button",
		class: className,
		children,
		...rest
	} = props;

	const content = label ?? children;
	const showIcon = loading
		? <span class="ui-button__spinner" aria-hidden="true" />
		: icon
		? <span class="ui-button__icon">{icon}</span>
		: null;

	return (
		<button
			type={type as "button"}
			class={cx(
				"ui-button",
				`ui-button--${severity}`,
				`ui-button--${variant}`,
				`ui-button--size-${size}`,
				structural && "ui-button--structural",
				raised && "ui-button--raised",
				rounded && "ui-button--rounded",
				iconOnly && "ui-button--icon-only",
				fluid && "ui-button--fluid",
				loading && "ui-button--loading",
				className as string,
			)}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			data-icon-pos={iconPos}
			{...rest}
		>
			{(iconOnly || iconPos === "left") && showIcon}
			{!iconOnly && content !== undefined && <span class="ui-button__label">{content}</span>}
			{!iconOnly && iconPos === "right" && showIcon}
			{badge !== undefined && <span class="ui-button__badge">{badge}</span>}
		</button>
	);
}
