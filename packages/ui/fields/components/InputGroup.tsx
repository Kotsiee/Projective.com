import type { ComponentChildren, JSX } from "preact";
import "../styles/input-group.css";
import { cx } from "../../core/cx.ts";
import type { FieldSize } from "../types/mod.ts";

export interface InputGroupProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "size"> {
	/** Size ramp applied to the group and its addons (default `md`). */
	size?: FieldSize;
	/** Stretch to fill the parent's inline size. */
	fluid?: boolean;
	children?: ComponentChildren;
}

/**
 * InputGroup — wraps an input together with leading/trailing {@link InputGroupAddon}s (text, icons,
 * buttons, checkboxes) as one seamless control. Zero JS. Children's outer radii are flattened so the
 * group reads as a single unit; the whole group shares one focus ring via `:focus-within`.
 */
export function InputGroup(props: InputGroupProps): JSX.Element {
	const { size = "md", fluid, class: className, children, ...rest } = props;
	return (
		<div
			role="group"
			class={cx(
				"ui-input-group",
				`ui-input-group--size-${size}`,
				fluid && "ui-input-group--fluid",
				className as string,
			)}
			{...rest}
		>
			{children}
		</div>
	);
}

export interface InputGroupAddonProps extends JSX.HTMLAttributes<HTMLSpanElement> {
	/** Render as a tonal/filled addon (default) or a plain transparent one. */
	variant?: "filled" | "plain";
	children?: ComponentChildren;
}

/**
 * InputGroupAddon — a leading/trailing segment of an {@link InputGroup}: static text, an icon, a
 * button, or a checkbox/radio. Non-interactive addons are `aria-hidden` decoration; interactive
 * children (buttons, inputs) keep their own semantics.
 */
export function InputGroupAddon(props: InputGroupAddonProps): JSX.Element {
	const { variant = "filled", class: className, children, ...rest } = props;
	return (
		<span
			class={cx(
				"ui-input-group__addon",
				variant === "plain" && "ui-input-group__addon--plain",
				className as string,
			)}
			{...rest}
		>
			{children}
		</span>
	);
}
