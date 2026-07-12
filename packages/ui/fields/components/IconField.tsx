import type { ComponentChildren, JSX } from "preact";
import "../styles/icon-field.css";
import { cx } from "../../core/cx.ts";

export interface IconFieldProps {
	/** Icon side relative to the input (default `left`). */
	iconPosition?: "left" | "right";
	class?: string;
	children?: ComponentChildren;
}

/**
 * IconField — positions an {@link InputIcon} inside a text control (PrimeNG parity). Wrap an input
 * and one or more InputIcons; the field reserves inline padding on the icon side so the glyph sits
 * over the input without overlapping the text. Icons may be decorative (default, `aria-hidden`) or
 * interactive (pass `interactive`).
 */
export function IconField(props: IconFieldProps): JSX.Element {
	const { iconPosition = "left", class: className, children } = props;
	return (
		<span class={cx("ui-icon-field", `ui-icon-field--${iconPosition}`, className)}>
			{children}
		</span>
	);
}

export interface InputIconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
	/** Interactive icons (buttons) get pointer events + focus affordance; default is decorative. */
	interactive?: boolean;
	children?: ComponentChildren;
}

/**
 * InputIcon — a single icon slot placed inside an {@link IconField}. Decorative by default
 * (`aria-hidden`); set `interactive` for a clickable glyph (e.g. search submit, clear).
 */
export function InputIcon(props: InputIconProps): JSX.Element {
	const { interactive, class: className, children, ...rest } = props;
	return (
		<span
			class={cx("ui-input-icon", interactive && "ui-input-icon--interactive", className as string)}
			aria-hidden={interactive ? undefined : "true"}
			{...rest}
		>
			{children}
		</span>
	);
}
