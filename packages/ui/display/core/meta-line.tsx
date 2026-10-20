import { type ComponentChildren, Fragment, type JSX } from "preact";
import { cx } from "../../core/cx.ts";

// #region Types
/** One fact on a MetaLine: plain text, or text with a figure / hover-title flag / rendered form. */
export type MetaLineEntry = string | {
	text: string;
	/** A figure that can change (a count, a price, a duration) — `tabular-nums`, §A.4. */
	tabular?: boolean;
	/** Native `title` for a fact whose full form does not fit inline (a full date, a path). */
	title?: string;
	/**
	 * What the item renders IN PLACE of `text`, when a fact is phrasing content rather than a string —
	 * a `MoneyView` pinned to its own currency, a figure in its own isolating span. Inline content
	 * only, never a control (§B.11). `text` stays the fact's plain form, so an entry with no words is
	 * still dropped.
	 */
	node?: ComponentChildren;
};

/** Element a MetaLine renders as. */
export type MetaLineElement = "p" | "span" | "div";

/** Type step of a MetaLine: the Meta register's `--text-sm`, or `--text-xs` for dense rows. */
export type MetaLineSize = "sm" | "xs";

/** Props for `MetaLine`. */
export interface MetaLineProps {
	/**
	 * The facts, in reading order. Falsy entries (`null`, `undefined`, `false`, `""`) are dropped, so a
	 * call site can write `[owner, isPublic && "Public", count]` without filtering first.
	 */
	items: ReadonlyArray<MetaLineEntry | null | undefined | false>;
	/** Rendered element (default `p`); `span` for a line inside inline content. */
	as?: MetaLineElement;
	/** Type step (default `sm`). */
	size?: MetaLineSize;
	class?: string;
}
// #endregion

/**
 * The MetaLine markup, kept free of the stylesheet import so the contract is unit-testable; the
 * public component is `components/MetaLine.tsx`, which adds the stylesheet. Renders nothing when
 * every entry is falsy.
 */
export function MetaLineMarkup(props: MetaLineProps): JSX.Element | null {
	const { items, as: Tag = "p", size = "sm", class: className } = props;
	const entries = items
		.filter((entry): entry is MetaLineEntry => Boolean(entry))
		.map((entry) => typeof entry === "string" ? { text: entry } : entry)
		.filter((entry) => entry.text);
	if (entries.length === 0) return null;

	return (
		<Tag class={cx("ui-meta-line", size === "xs" && "ui-meta-line--xs", className)}>
			{entries.map((entry, i) => (
				<Fragment key={i}>
					{i > 0 && <span class="ui-meta-line__sep" aria-hidden="true">·</span>}
					<span
						class={cx("ui-meta-line__item", entry.tabular && "ui-meta-line__item--tabular")}
						title={entry.title}
					>
						{entry.node ?? entry.text}
					</span>
				</Fragment>
			))}
		</Tag>
	);
}
