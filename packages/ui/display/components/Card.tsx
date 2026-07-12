import type { ComponentChildren, JSX, VNode } from "preact";
import "../styles/card.css";
import { cx } from "../../core/cx.ts";

// #region Types
/** Surface treatment for {@link Card}'s own tonal separation (§B.4 — no four-sided border). */
export type CardVariant = "elevated" | "filled" | "flat";

export interface CardProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "title"> {
	/** Custom header region; overrides `title`/`subtitle` when given. */
	header?: string | VNode;
	/** Plain-text (or node) title, used when no custom `header` is supplied. */
	title?: string | VNode;
	/** Secondary line under the title. */
	subtitle?: string | VNode;
	/** Footer region, separated from the body by a single hairline. */
	footer?: string | VNode;
	/** Top media slot (typically an `<img>`), rendered edge-to-edge above the header. */
	media?: VNode;
	/** Trailing action row (buttons/menu), rendered under the body. */
	actions?: ComponentChildren;
	/** Tonal treatment (default `elevated`). */
	variant?: CardVariant;
	/** Adds a resting shadow on top of the variant's base elevation. */
	raised?: boolean;
	/** Render as a different element (default `div`). */
	as?: keyof JSX.IntrinsicElements;
	class?: string;
	children?: ComponentChildren;
}
// #endregion

/**
 * Card — a non-interactive content container. Separation from its surroundings comes from a tonal
 * surface tint + radius + spacing (§B.4), never a four-sided border. Composes optional `media` (top
 * image), a `header` (or `title`/`subtitle` pair), body `children`, an `actions` row, and a `footer`
 * — the footer is set off from the body by a single hairline, matching {@link Divider}'s convention.
 * Zero client JS.
 */
export function Card(props: CardProps): JSX.Element {
	const {
		header,
		title,
		subtitle,
		footer,
		media,
		actions,
		variant = "elevated",
		raised,
		as = "div",
		class: className,
		children,
		...rest
	} = props;

	const Tag = as as "div";
	const hasHeaderRegion = header !== undefined || title !== undefined || subtitle !== undefined;

	return (
		<Tag
			class={cx("ui-card", `ui-card--${variant}`, raised && "ui-card--raised", className as string)}
			{...rest}
		>
			{media && <div class="ui-card__media">{media}</div>}
			{hasHeaderRegion && (
				<div class="ui-card__header">
					{header ?? (
						<>
							{title !== undefined && <div class="ui-card__title">{title}</div>}
							{subtitle !== undefined && <div class="ui-card__subtitle">{subtitle}</div>}
						</>
					)}
				</div>
			)}
			{children !== undefined && <div class="ui-card__body">{children}</div>}
			{actions !== undefined && <div class="ui-card__actions">{actions}</div>}
			{footer !== undefined && <div class="ui-card__footer">{footer}</div>}
		</Tag>
	);
}
