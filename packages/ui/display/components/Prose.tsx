import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link Prose}. */
export interface ProseProps {
	/** The element to render (default `div`). */
	as?: "div" | "section";
	/** Extra class(es). */
	class?: string;
	/** Long-form content — usually a `ContentRenderer` or `DocumentBody`'s sections. */
	children: ComponentChildren;
}
// #endregion

/**
 * Prose — the typographic defaults for long-form body copy: the accessibility-swappable reading
 * face at `--text-base` on `--leading-relaxed`, capped at `--measure`, with asymmetric heading
 * spacing (§B.4.1) and the house treatment of links, lists, quotes, code, figures, tables and
 * callouts. A wrapper only — it adds no landmark and no box. Zero-JS and stylesheet-free (prose.css,
 * via the editorial aggregate).
 */
export function Prose({ as = "div", class: className, children }: ProseProps): JSX.Element {
	const Tag = as;
	return <Tag class={cx("ui-prose", className)}>{children}</Tag>;
}
