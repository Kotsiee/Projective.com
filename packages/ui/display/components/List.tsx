import type { ComponentChildren, JSX } from "preact";
import "../styles/list.css";
import { cx } from "../../core/cx.ts";

/** Semantic list element rendered by {@link List} (default `unordered`). */
export type ListOrder = "unordered" | "ordered";

export interface ListProps<T = unknown> {
	/** Native list semantics — `ul` vs `ol` (default `unordered`). */
	order?: ListOrder;
	/** Data-driven rendering: paired with `itemTemplate`, generates one row per item. */
	items?: T[];
	/** Row renderer for `items`; receives the row and its index. */
	itemTemplate?: (item: T, index: number) => ComponentChildren;
	/** Tighter row padding. */
	dense?: boolean;
	/** Accessible label for the list when no visible heading precedes it. */
	"aria-label"?: string;
	class?: string;
	/** {@link ListItem} elements — used instead of `items`/`itemTemplate` for static content. */
	children?: ComponentChildren;
}

/**
 * List — a semantic `role="list"` container (`ul`/`ol`) for {@link ListItem} rows. Accepts either
 * static `children` (typically `ListItem`s) or a data-driven `items` + `itemTemplate` pair. Rows are
 * separated by a single hairline (§B.4); `dense` tightens vertical rhythm. Zero client JS.
 */
export function List<T = unknown>(props: ListProps<T>): JSX.Element {
	const {
		order = "unordered",
		items,
		itemTemplate,
		dense,
		"aria-label": ariaLabel,
		class: className,
		children,
	} = props;

	const Tag = order === "ordered" ? "ol" : "ul";

	return (
		<Tag
			class={cx("ui-list", dense && "ui-list--dense", className)}
			role="list"
			aria-label={ariaLabel}
		>
			{items && itemTemplate
				? items.map((item, i) => (
					<li class="ui-list__item" key={i}>
						{itemTemplate(item, i)}
					</li>
				))
				: children}
		</Tag>
	);
}
