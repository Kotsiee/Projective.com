import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link DocumentHeader}. */
export interface DocumentHeaderProps {
	/** The document title — the page's one `<h1>`. */
	title: string;
	/** A section-header label above the title (`Legal`, `Help · Payments`). */
	eyebrow?: string;
	/** The lead paragraph (a document's `summary`). */
	summary?: string;
	/**
	 * Non-actionable facts, already formatted (`Updated 17 October 2026`, `Version 2.1`, `4 min read`)
	 * — one Meta-register line, middot-separated (§B.11.2).
	 */
	meta?: readonly string[];
	/** The title's id, which names the article (default `doc-title`). */
	titleId?: string;
	/** Extra class(es). */
	class?: string;
	/** Anything under the meta line — a required disclosure (a draft notice), an author line. */
	children?: ComponentChildren;
}
// #endregion

/**
 * DocumentHeader — the top of a document in three of §A.4's registers: an optional section-header
 * eyebrow, the title in the display register (`--text-3xl` / `--fw-medium` / `--tracking-tight`,
 * fluid against the document frame), the lead in the reading face, and one Meta-register line of
 * facts in `tabular-nums` with `aria-hidden` middots between list items, so a screen reader hears a
 * list rather than punctuation. No box, no chips. Zero-JS and stylesheet-free (document-layout.css,
 * via the editorial aggregate).
 */
export function DocumentHeader(
	{ title, eyebrow, summary, meta = [], titleId = "doc-title", class: className, children }:
		DocumentHeaderProps,
): JSX.Element {
	return (
		<header class={cx("ui-doc-header", className)}>
			{eyebrow ? <p class="ui-doc-header__eyebrow">{eyebrow}</p> : null}
			<h1 id={titleId} class="ui-doc-header__title">{title}</h1>
			{summary ? <p id="doc-summary" class="ui-doc-header__summary">{summary}</p> : null}
			{meta.length > 0
				? (
					<ul class="ui-doc-header__meta" role="list">
						{meta.map((fact, i) => (
							<li key={fact} class="ui-doc-header__meta-item">
								{i > 0 ? <span class="ui-doc-header__sep" aria-hidden="true">·</span> : null}
								{fact}
							</li>
						))}
					</ul>
				)
				: null}
			{children ? <div class="ui-doc-header__extra">{children}</div> : null}
		</header>
	);
}
