import type { ComponentChildren, HTMLAttributes, JSX } from "preact";
import "../styles/nav.css";
import { cx } from "../../core/cx.ts";

export interface LinkProps extends Omit<HTMLAttributes<HTMLAnchorElement>, "style" | "ref"> {
	href: string;
	/** Marks the current page (`aria-current="page"`). */
	active?: boolean;
	children?: ComponentChildren;
}

/** Link — a token-styled anchor with an active state. */
export function Link(
	{ href, active, class: className, children, ...rest }: LinkProps,
): JSX.Element {
	return (
		<a
			href={href}
			class={cx("ui-link", active && "ui-link--active", className as string)}
			aria-current={active ? "page" : undefined}
			{...rest}
		>
			{children}
		</a>
	);
}
