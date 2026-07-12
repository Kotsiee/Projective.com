import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX } from "preact";
import "../styles/container.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

export type ContainerSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ContainerProps extends Omit<HTMLAttributes<HTMLElement>, "style" | "ref"> {
	as?: keyof JSX.IntrinsicElements;
	/** Max-width preset (maps to `--container-*`). `full` removes the cap. Default `lg`. */
	size?: ContainerSize;
	style?: CSSProperties;
	children?: ComponentChildren;
}

/** Container — centers content and constrains it to a readable max-width with fluid gutters. */
export function Container(props: ContainerProps): JSX.Element {
	const { as = "div", size = "lg", class: className, style, children, ...rest } = props;
	const vars: Record<string, string | undefined> = {};
	if (size !== "full") vars["--container-max"] = `var(--container-${size})`;
	const Tag = as as "div";
	return (
		<Tag
			class={cx("ui-container", size === "full" && "ui-container--full", className as string)}
			style={styleVars(vars, style)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
