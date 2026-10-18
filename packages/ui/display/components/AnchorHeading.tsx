import type { ComponentChildren, JSX } from "preact";
import { useContext } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { EditorialGlyphContext } from "../core/editorial-glyphs.ts";

// #region Props
/** Props for {@link AnchorHeading}. */
export interface AnchorHeadingProps {
	/** The heading level: `2` for a section, `3` for a sub-heading. */
	level: 2 | 3;
	/** The anchor id — the heading's own `id` and its link's `#fragment`. */
	id: string;
	/** A clause number (`2.1`) shown before the text, when the document is numbered. */
	number?: string;
	/** Extra class(es) on the heading. */
	class?: string;
	/** The heading text. */
	children: ComponentChildren;
}
// #endregion

/**
 * AnchorHeading — a heading whose text is a real `<a href="#id">` to itself, so every section of a
 * document has a shareable address that works without JavaScript: activating it puts `#id` in the
 * address bar, and the browser's own "copy link" works on it.
 *
 * The link's accessible name is the heading text (a clause number, when present, is part of it, as
 * it is on the page); the trailing link glyph, revealed on hover and keyboard focus — shown at rest
 * on touch screens, where there is no hover — is decorative and `aria-hidden`, drawn from the
 * editorial glyph context. The id sits on the heading, which carries the chrome-clearing scroll
 * margin. Zero-JS and stylesheet-free (prose.css, via the editorial aggregate).
 */
export function AnchorHeading(
	{ level, id, number, class: className, children }: AnchorHeadingProps,
): JSX.Element {
	const glyphs = useContext(EditorialGlyphContext);
	const Tag = level === 2 ? "h2" : "h3";
	return (
		<Tag id={id} class={cx("ui-anchor-heading", `ui-anchor-heading--${level}`, className)}>
			<a class="ui-anchor-heading__link" href={`#${id}`}>
				{number ? <span class="ui-anchor-heading__num">{number}</span> : null}
				<span class="ui-anchor-heading__text">{children}</span>
				{glyphs.anchor
					? <span class="ui-anchor-heading__glyph" aria-hidden="true">{glyphs.anchor()}</span>
					: null}
			</a>
		</Tag>
	);
}
