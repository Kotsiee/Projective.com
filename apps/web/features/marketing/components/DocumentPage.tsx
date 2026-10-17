import type { ComponentChildren, JSX } from "preact";
import {
	anchorDoc,
	type Doc,
	docToc,
	formatContentDate,
	readingMinutes,
} from "@projective/types/content";
import {
	DocumentBody,
	DocumentHeader,
	DocumentLayout,
	EditorialGlyphContext,
} from "@projective/ui/display/editorial";
import {
	EDITORIAL_ICONS,
	ReadingProgress,
	TableOfContents,
} from "@projective/ui/display/editorial-islands";

/** Props for {@link DocumentPage}. */
export interface DocumentPageProps {
	/** The document — any `Doc`, including a surface's extension of it. */
	doc: Doc;
	/** The section-header label above the title (`Legal`, `Help · Payments`). */
	eyebrow?: string;
	/** The meta line's facts, formatted; default {@link defaultDocMeta} (updated · version · read time). */
	meta?: readonly string[];
	/** Number sections and sub-headings as clauses (`1`, `1.1`) — legal documents. */
	numbered?: boolean;
	/** `2` lists sections only in the table of contents; `3` (default) adds their sub-headings. */
	tocDepth?: 2 | 3;
	/** Show the table of contents (default: when the document has more than one section). */
	toc?: boolean;
	/** Show the reading-progress bar (default `true`; it hides itself on a short document). */
	progress?: boolean;
	/** Under the header's meta line: a required disclosure (the legal draft notice), an author line. */
	notice?: ComponentChildren;
	/** The meta rail's content (beside the column from `--bp-xl`, after the body below it). */
	aside?: ComponentChildren;
	/** The meta rail's accessible name. */
	asideLabel?: string;
	/** Before the sections, inside the reading column — an introduction, a cover figure. */
	before?: ComponentChildren;
	/** After the sections, inside the article — related documents, a feedback prompt. */
	after?: ComponentChildren;
	/** Ids the page renders elsewhere, so no generated heading anchor takes one. */
	reserved?: readonly string[];
}

/** The default meta line: `Updated 17 October 2026 · Version 1.0 · 4 min read`. */
export function defaultDocMeta(doc: Doc): string[] {
	return [
		`Updated ${formatContentDate(doc.updatedAt)}`,
		`Version ${doc.version}`,
		`${readingMinutes(doc)} min read`,
	];
}

/**
 * DocumentPage — a whole editorial document in one component, composed from the shared primitives:
 * the reading-progress bar, a `DocumentHeader` (eyebrow · title · summary · meta · notice), the
 * "On this page" table of contents, and the body, every heading anchored ONCE (`anchorDoc`) so the
 * contents and the headings agree on every id. It provides the registry glyphs to the server-rendered
 * parts. The legal, help, changelog and article readers render this and add their own slots; a
 * surface with a different shape composes the same primitives from `@projective/ui/display/editorial`.
 *
 * It renders no `<main>` (the shell's) and no SEO: the route sets `applyPageMeta(...)` and renders
 * `<JsonLd>` beside it.
 */
export function DocumentPage(props: DocumentPageProps): JSX.Element {
	const { doc, numbered = false, tocDepth = 3, progress = true } = props;
	const anchored = anchorDoc(doc, { numbered, reserved: props.reserved });
	const showToc = props.toc ?? doc.sections.length > 1;
	return (
		<EditorialGlyphContext.Provider value={EDITORIAL_ICONS}>
			<DocumentLayout
				progress={progress ? <ReadingProgress /> : undefined}
				header={
					<DocumentHeader
						eyebrow={props.eyebrow}
						title={doc.title}
						summary={doc.summary}
						meta={props.meta ?? defaultDocMeta(doc)}
					>
						{props.notice}
					</DocumentHeader>
				}
				toc={showToc
					? <TableOfContents entries={docToc(anchored, { depth: tocDepth })} />
					: undefined}
				meta={props.aside}
				metaLabel={props.asideLabel}
				footer={props.after}
			>
				{props.before}
				<DocumentBody doc={anchored} />
			</DocumentLayout>
		</EditorialGlyphContext.Provider>
	);
}
