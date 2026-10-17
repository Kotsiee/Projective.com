import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link DocumentLayout}. */
export interface DocumentLayoutProps {
	/** The top of the document — usually a `DocumentHeader` (whose `<h1>` names the article). */
	header?: ComponentChildren;
	/**
	 * The table of contents — usually the `TableOfContents` island. Passing one reserves its rail
	 * from the first byte, so nothing shifts when it hydrates.
	 */
	toc?: ComponentChildren;
	/** Secondary facts beside the reading column from `--bp-xl` (below it, after the body). */
	meta?: ComponentChildren;
	/** The meta rail's accessible name (default "About this document"). */
	metaLabel?: string;
	/** Pinned under the site header — usually the `ReadingProgress` island. */
	progress?: ComponentChildren;
	/** After the body, inside the article — related links, a feedback prompt. */
	footer?: ComponentChildren;
	/** The article's id (default `doc-article`) — the reading-progress island measures it. */
	id?: string;
	/** The id of the element that names the article (default `doc-title`, DocumentHeader's `<h1>`). */
	labelledBy?: string;
	/** Extra class(es) on the frame. */
	class?: string;
	/** The body — usually a `DocumentBody`. */
	children: ComponentChildren;
}
// #endregion

/** Whether a slot was given something to render (`false` / `null` / `undefined` mean "no slot"). */
function present(slot: ComponentChildren): boolean {
	return slot !== undefined && slot !== null && slot !== false;
}

/**
 * DocumentLayout — the editorial reading frame shared by the legal, help, changelog and article
 * surfaces: an `<article>` (named by its title) whose reading column is capped at `--measure`, with
 * an optional table-of-contents rail and an optional meta rail.
 *
 * The frame is a named container (`ui-doc`), so the columns follow the space the frame actually has —
 * the same document beside the signed-in rail and full-bleed for a guest — never the viewport:
 * one column below `--bp-lg`, TOC rail + reading column from `--bp-lg`, and the meta rail on the far
 * side from `--bp-xl`. Each rail's width is reserved by the grid as soon as its slot is passed.
 *
 * It renders no `<main>`: the shell owns the page's one main landmark (and its skip link), and a
 * document inside it is an `<article>`. The table of contents is a `<nav aria-label="On this page">`
 * of its own; the meta rail is an `<aside>` scoped to the article. Zero-JS and stylesheet-free
 * (document-layout.css via the editorial aggregate), so the contract is unit-testable.
 */
export function DocumentLayout(props: DocumentLayoutProps): JSX.Element {
	const {
		header,
		toc,
		meta,
		metaLabel = "About this document",
		progress,
		footer,
		id = "doc-article",
		labelledBy = "doc-title",
		class: className,
		children,
	} = props;
	const hasToc = present(toc);
	const hasMeta = present(meta);
	return (
		<div class={cx("ui-doc", className)}>
			{progress}
			<article
				id={id}
				class={cx(
					"ui-doc__article",
					hasToc && "ui-doc__article--toc",
					hasMeta && "ui-doc__article--meta",
				)}
				aria-labelledby={present(header) ? labelledBy : undefined}
			>
				{present(header) ? <div class="ui-doc__header">{header}</div> : null}
				{hasToc ? <div class="ui-doc__toc">{toc}</div> : null}
				<div class="ui-doc__body">{children}</div>
				{hasMeta
					? (
						<aside class="ui-doc__meta" aria-label={metaLabel}>
							<div class="ui-doc__meta-inner">{meta}</div>
						</aside>
					)
					: null}
				{present(footer) ? <div class="ui-doc__footer">{footer}</div> : null}
			</article>
		</div>
	);
}
