import type { ComponentChildren, ComponentType, JSX } from "preact";
import {
	anchorDoc,
	type AnchoredSection,
	type Doc,
	docToc,
	readingMinutes,
	type TocEntry,
} from "@projective/types/content";
import {
	DocumentBody,
	DocumentDate,
	DocumentHeader,
	DocumentLayout,
	type DocumentMetaFact,
	type DocumentSectionSlot,
	EditorialGlyphContext,
	type EditorialGlyphs,
	TocNav,
} from "@projective/ui/display/editorial";

// #region Props
/**
 * The interactive parts a document page mounts, injected so the composite itself imports no island
 * (an island imports CSS, which `deno test` cannot load). The app passes the real islands
 * (`DocumentPage`); a render test passes {@link STATIC_DOCUMENT_ISLANDS}.
 */
export interface DocumentIslands {
	/** The table of contents (the `TableOfContents` island). */
	TableOfContents: ComponentType<{ entries: TocEntry[]; label?: string }>;
	/** The reading-progress bar (the `ReadingProgress` island). */
	ReadingProgress: ComponentType<{ label?: string }>;
	/** The decorative glyphs the server-rendered parts draw (`EDITORIAL_ICONS`). */
	glyphs: EditorialGlyphs;
}

/**
 * The page without JavaScript: the table of contents as its static markup (rail, disclosure — every
 * link a plain anchor), no progress bar, no glyphs. What a render test mounts, and exactly what the
 * server sends before the islands hydrate.
 */
export const STATIC_DOCUMENT_ISLANDS: DocumentIslands = {
	TableOfContents: ({ entries, label }) => <TocNav entries={entries} label={label} />,
	ReadingProgress: () => null,
	glyphs: {},
};

/** Props for {@link DocumentPage} (and {@link DocumentPageView}). */
export interface DocumentPageProps {
	/** The document — any `Doc`, including a surface's extension of it. */
	doc: Doc;
	/** The section-header label above the title (`Legal`, `Help · Payments`). */
	eyebrow?: string;
	/**
	 * The meta line's facts; default {@link defaultDocMeta} (updated · version · read time). A date
	 * fact should be a `DocumentDate`, so it is machine-readable (`<time datetime>`).
	 */
	meta?: readonly DocumentMetaFact[];
	/** Number sections and sub-headings as clauses (`1`, `1.1`) — legal documents. */
	numbered?: boolean;
	/** `2` lists sections only in the table of contents; `3` (default) adds their sub-headings. */
	tocDepth?: 2 | 3;
	/** Show the table of contents (default: when there is more than one section, or `tocEntries`). */
	toc?: boolean;
	/** The table of contents' name and visible label (default "On this page"). */
	tocLabel?: string;
	/**
	 * The table of contents' tree, replacing the one derived from the document — or a function that
	 * receives the derived tree and returns the tree to show. The legal rail lists every document
	 * (`href` entries) and puts the derived sections under the current one, so its ids still match the
	 * rendered headings without anchoring the document twice.
	 */
	tocEntries?: TocEntry[] | ((derived: TocEntry[]) => TocEntry[]);
	/** The label above each section's summary line (default "In short"). */
	tldrLabel?: string;
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
	/** Ids the page renders elsewhere, so no GENERATED heading anchor takes one. */
	reserved?: readonly string[];
	/** Per-section additions — a class, content after the heading, content after the body. */
	sectionSlots?: (section: AnchoredSection, index: number) => DocumentSectionSlot | undefined;
	/**
	 * A modifier on the document frame (`ui-doc--clauses`, `ui-doc--article`, …), declared in the
	 * shared editorial sheet — the one way a surface varies the family's look.
	 */
	class?: string;
	/** A modifier on the prose wrapper. */
	bodyClass?: string;
}
// #endregion

/**
 * The default meta line: `Updated <time datetime="2026-10-17">17 October 2026</time> · Version 1.0 ·
 * 4 min read`.
 */
export function defaultDocMeta(doc: Doc): DocumentMetaFact[] {
	return [
		<DocumentDate key="updated" prefix="Updated" iso={doc.updatedAt} />,
		`Version ${doc.version}`,
		`${readingMinutes(doc)} min read`,
	];
}

/**
 * DocumentPageView — {@link DocumentPage} with its islands injected: the composite, importable (and
 * render-testable) without loading an island. Every heading is anchored ONCE (`anchorDoc`), so the
 * table of contents and the headings agree on every id.
 */
export function DocumentPageView(
	props: DocumentPageProps & { islands: DocumentIslands },
): JSX.Element {
	const { doc, islands, numbered = false, tocDepth = 3, progress = true } = props;
	const { TableOfContents, ReadingProgress } = islands;
	const anchored = anchorDoc(doc, { numbered, reserved: props.reserved });
	const derived = () => docToc(anchored, { depth: tocDepth });
	const entries = typeof props.tocEntries === "function"
		? props.tocEntries(derived())
		: props.tocEntries;
	const showToc = props.toc ?? (entries !== undefined || doc.sections.length > 1);
	return (
		<EditorialGlyphContext.Provider value={islands.glyphs}>
			<DocumentLayout
				class={props.class}
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
					? <TableOfContents entries={entries ?? derived()} label={props.tocLabel} />
					: undefined}
				meta={props.aside}
				metaLabel={props.asideLabel}
				footer={props.after}
			>
				{props.before}
				<DocumentBody
					doc={anchored}
					tldrLabel={props.tldrLabel}
					sectionSlots={props.sectionSlots}
					class={props.bodyClass}
				/>
			</DocumentLayout>
		</EditorialGlyphContext.Provider>
	);
}
