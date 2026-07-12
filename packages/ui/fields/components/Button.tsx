import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/button.css";
import { cx } from "../../core/cx.ts";
import type { FieldSize, Severity } from "../types/mod.ts";

export type ButtonVariant = "filled" | "outlined" | "text" | "link";

export interface ButtonProps
	extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "icon" | "loading"> {
	/** Button label. Optional for icon-only buttons (pass `aria-label` then). */
	label?: string;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Fill treatment (default `filled`). `text`/`link` are low-emphasis; `outlined` is medium. */
	variant?: ButtonVariant;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Elevated (raised) surface with a resting shadow. */
	raised?: boolean;
	/** Pill / fully-rounded corners. */
	rounded?: boolean;
	/** Icon-only square button (requires `aria-label`). */
	iconOnly?: boolean;
	/** Leading/trailing icon node. */
	icon?: VNode;
	/** Icon placement (default `left`). */
	iconPos?: "left" | "right";
	/** Loading state — swaps the icon for a spinner and blocks activation. */
	loading?: boolean;
	/** Optional badge value shown at the top-right corner. */
	badge?: string | number;
	/** Stretch to fill the parent's inline size. */
	fluid?: boolean;
	children?: ComponentChildren;
}

/**
 * Button — the primary action control. Covers every PrimeNG treatment: filled/outlined/text/link
 * variants across all seven severities, raised/rounded modifiers, icon (+ position) and icon-only
 * forms, a corner badge, and a loading state that shows a spinner and sets `aria-busy`. Fully
 * keyboard-operable via the native `<button>`; disabled/loading remove it from activation.
 */
export function Button(props: ButtonProps): JSX.Element {
	const {
		label,
		severity = "primary",
		variant = "filled",
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
			{iconPos === "left" && showIcon}
			{!iconOnly && content !== undefined && <span class="ui-button__label">{content}</span>}
			{iconOnly && showIcon}
			{iconPos === "right" && !iconOnly && showIcon}
			{badge !== undefined && <span class="ui-button__badge">{badge}</span>}
		</button>
	);
}
