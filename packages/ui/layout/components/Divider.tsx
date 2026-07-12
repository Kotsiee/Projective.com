import type { HTMLAttributes, JSX } from "preact";
import "../styles/divider.css";
import { cx } from "../../core/cx.ts";

export type Orientation = "horizontal" | "vertical";

export interface DividerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
	/** Line orientation (default `horizontal`). */
	orientation?: Orientation;
	/**
	 * Decorative (default `true`) → hidden from assistive tech. Set `false` for a semantic separator
	 * that conveys a real content boundary (`role="separator"`). See {@link Separator}.
	 */
	decorative?: boolean;
	/** Optional centered caption (horizontal only). Forces semantic (non-decorative) rendering. */
	label?: string;
}

/**
 * Divider — a single hairline separating content. Decorative by default (§B.4: reserve full borders
 * for interactive elements; use one thin line here).
 */
export function Divider(props: DividerProps): JSX.Element {
	const { orientation = "horizontal", decorative = true, label, class: className, ...rest } = props;

	if (label) {
		return (
			<div
				class={cx("ui-divider", "ui-divider--labelled", className as string)}
				role="separator"
				aria-orientation="horizontal"
				{...rest}
			>
				<span>{label}</span>
			</div>
		);
	}

	return (
		<div
			class={cx("ui-divider", `ui-divider--${orientation}`, className as string)}
			role={decorative ? undefined : "separator"}
			aria-orientation={decorative ? undefined : orientation}
			aria-hidden={decorative ? "true" : undefined}
			{...rest}
		/>
	);
}
