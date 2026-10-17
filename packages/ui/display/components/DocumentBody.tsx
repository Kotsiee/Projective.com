import type { JSX } from "preact";
import type { AnchoredDoc } from "@projective/types/content";
import { cx } from "../../core/cx.ts";
import { AnchorHeading } from "./AnchorHeading.tsx";
import { ContentRenderer } from "./ContentRenderer.tsx";
import { InlineContent } from "./InlineContent.tsx";
import { Prose } from "./Prose.tsx";

// #region Props
/** Props for {@link DocumentBody}. */
export interface DocumentBodyProps {
	/** The document, anchored once (`anchorDoc`) — the same value the table of contents reads. */
	doc: AnchoredDoc;
	/** The label above each section's summary line (default "In short"). */
	tldrLabel?: string;
	/** Extra class(es) on the prose wrapper. */
	class?: string;
}
// #endregion

/**
 * DocumentBody — a document's sections as prose: each section is a `<section>` opened by an `h2`
 * {@link AnchorHeading} (its id and, when numbered, its clause number come from the anchored doc),
 * its optional "In short" line, then its blocks through {@link ContentRenderer}. Sections are not
 * given accessible names, so a long policy does not flood the landmark list with one region per
 * clause — the headings carry the outline. Zero-JS and stylesheet-free.
 */
export function DocumentBody(
	{ doc, tldrLabel = "In short", class: className }: DocumentBodyProps,
): JSX.Element {
	return (
		<Prose class={cx("ui-doc-body", className)}>
			{doc.sections.map((section) => (
				<section key={section.anchor} class="ui-doc-section">
					<AnchorHeading level={2} id={section.anchor} number={section.number}>
						{section.heading}
					</AnchorHeading>
					{section.tldr
						? (
							<p class="ui-doc-section__tldr">
								<span class="ui-doc-section__tldr-label">{tldrLabel}</span>
								<InlineContent content={section.tldr} />
							</p>
						)
						: null}
					<ContentRenderer nodes={section.body} />
				</section>
			))}
		</Prose>
	);
}
