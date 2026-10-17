import type { ComponentChildren, JSX } from "preact";
import type { AnchoredDoc, AnchoredSection } from "@projective/types/content";
import { cx } from "../../core/cx.ts";
import { AnchorHeading } from "./AnchorHeading.tsx";
import { ContentRenderer } from "./ContentRenderer.tsx";
import { InlineContent } from "./InlineContent.tsx";
import { Prose } from "./Prose.tsx";

// #region Props
/** What a consumer adds to ONE section (see {@link DocumentBodyProps.sectionSlots}). */
export interface DocumentSectionSlot {
	/** Extra class(es) on the `<section>` — a modifier a shared editorial sheet styles. */
	class?: string;
	/** Between the section's heading and its summary line / body — a "Changed in v2" note. */
	before?: ComponentChildren;
	/** After the section's body — a call to action placed part-way through a long article. */
	after?: ComponentChildren;
}

/** Props for {@link DocumentBody}. */
export interface DocumentBodyProps {
	/** The document, anchored once (`anchorDoc`) — the same value the table of contents reads. */
	doc: AnchoredDoc;
	/** The label above each section's summary line (default "In short"). */
	tldrLabel?: string;
	/**
	 * Per-section additions, asked once per section in document order: a class, content after the
	 * heading, content after the body. Return nothing (or `undefined`) to leave a section as it is.
	 */
	sectionSlots?: (section: AnchoredSection, index: number) => DocumentSectionSlot | undefined;
	/** Extra class(es) on the prose wrapper. */
	class?: string;
}
// #endregion

/**
 * DocumentBody — a document's sections as prose: each section is a `<section>` opened by an `h2`
 * {@link AnchorHeading} (its id and, when numbered, its clause number come from the anchored doc),
 * its optional summary line (a solid tonal step under a section-header label), then its blocks
 * through {@link ContentRenderer}. Sections are not given accessible names, so a long policy does not
 * flood the landmark list with one region per clause — the headings carry the outline. A numbered
 * document's prose carries `ui-doc-body--numbered`, which hangs the clause numbers in the gutter once
 * the frame is wide enough. `sectionSlots` lets a surface mark or annotate individual sections
 * without re-implementing the body. Zero-JS and stylesheet-free.
 */
export function DocumentBody(
	{ doc, tldrLabel = "In short", sectionSlots, class: className }: DocumentBodyProps,
): JSX.Element {
	return (
		<Prose class={cx("ui-doc-body", doc.numbered && "ui-doc-body--numbered", className)}>
			{doc.sections.map((section, i) => {
				const slot = sectionSlots?.(section, i);
				return (
					<section key={section.anchor} class={cx("ui-doc-section", slot?.class)}>
						<AnchorHeading level={2} id={section.anchor} number={section.number}>
							{section.heading}
						</AnchorHeading>
						{slot?.before ?? null}
						{section.tldr
							? (
								<p class="ui-doc-section__tldr">
									<span class="ui-doc-section__tldr-label">{tldrLabel}</span>
									<InlineContent content={section.tldr} />
								</p>
							)
							: null}
						<ContentRenderer nodes={section.body} />
						{slot?.after ?? null}
					</section>
				);
			})}
		</Prose>
	);
}
