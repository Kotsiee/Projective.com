import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/button.css";
import { cx } from "../../core/cx.ts";
import type { FieldSize, Severity } from "../types/mod.ts";

export type ButtonVariant = "filled" | "outlined" | "text" | "link";

/**
 * Button colour ramp: the shared {@link Severity} set plus two Button-only tiers of the Interaction
 * Matrix (§B.8.1) — `accent`, the amber terminal financial/conversion commit (`--accent` /
 * `--on-accent`), and `neutral`, the outlined utility action (`--on-surface` ink on a
 * `--hairline-strong` border). Neither is a status, so neither reaches Tag/Badge/Alert/Message/Toast.
 */
export type ButtonSeverity = Severity | "accent" | "neutral";

/** Props shared by every Button regardless of colour ramp. */
export interface ButtonBaseProps
	extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "icon" | "loading"> {
	/** Button label. Optional for icon-only buttons (pass `aria-label` then). */
	label?: string;
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

/** A status or brand ramp: every fill treatment is legal. */
export interface ButtonSemanticTone {
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Fill treatment (default `filled`). `text`/`link` are low-emphasis; `outlined` is medium. */
	variant?: ButtonVariant;
}

/**
 * The amber terminal-commit ramp. Filled only: `--accent` is contrast-checked as a fill under
 * `--on-accent`, not as ink on a page surface, so an outlined/text/link label would be unreadable.
 */
export interface ButtonAccentTone {
	/** Terminal financial / conversion commit (Pay, Hire, Fund escrow). */
	severity: "accent";
	/** Only `filled` is legal for the accent ramp. */
	variant?: "filled";
}

/**
 * The neutral utility ramp — tier 4 of the Interaction Matrix (Upload, Message, Follow). Outlined
 * only: the tier is defined as a hairline-bordered control, so a neutral fill would read as tier 2.
 */
export interface ButtonNeutralTone {
	/** Utility action, inked in `--on-surface` rather than a brand or status hue. */
	severity: "neutral";
	/** Only `outlined` is legal for the neutral ramp. */
	variant: "outlined";
}

/** Button props: the shared base plus exactly one colour-ramp contract. */
export type ButtonProps =
	& ButtonBaseProps
	& (ButtonSemanticTone | ButtonAccentTone | ButtonNeutralTone);

/**
 * Button — the primary action control. Covers every PrimeNG treatment: filled/outlined/text/link
 * variants across all seven severities, the filled-only amber `accent` commit tier, the outlined-only
 * `neutral` utility tier, raised/rounded
 * modifiers, icon (+ position) and icon-only forms, a corner badge, and a loading state that shows a
 * spinner and sets `aria-busy`. Fully keyboard-operable via the native `<button>`; disabled/loading
 * remove it from activation.
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
			{(iconOnly || iconPos === "left") && showIcon}
			{!iconOnly && content !== undefined && <span class="ui-button__label">{content}</span>}
			{!iconOnly && iconPos === "right" && showIcon}
			{badge !== undefined && <span class="ui-button__badge">{badge}</span>}
		</button>
	);
}
