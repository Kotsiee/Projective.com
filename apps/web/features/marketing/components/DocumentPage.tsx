import type { JSX } from "preact";
import {
	EDITORIAL_ICONS,
	ReadingProgress,
	TableOfContents,
} from "@projective/ui/display/editorial-islands";
import {
	defaultDocMeta,
	type DocumentIslands,
	type DocumentPageProps,
	DocumentPageView,
	STATIC_DOCUMENT_ISLANDS,
} from "./DocumentPageView.tsx";

export { defaultDocMeta, DocumentPageView, STATIC_DOCUMENT_ISLANDS };
export type { DocumentIslands, DocumentPageProps };

/** The real islands and the registry glyph set. */
const LIVE_ISLANDS: DocumentIslands = {
	TableOfContents,
	ReadingProgress,
	glyphs: EDITORIAL_ICONS,
};

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
 *
 * THIS module imports the islands, which import CSS, so it does not load under `deno test`. A page
 * controller that must be render-tested takes its document composite as {@link DocumentPageView}
 * with `islands={STATIC_DOCUMENT_ISLANDS}` in the test (both from `./DocumentPageView.tsx`, which
 * imports no island), and this component in the route.
 */
export function DocumentPage(props: DocumentPageProps): JSX.Element {
	return <DocumentPageView {...props} islands={LIVE_ISLANDS} />;
}
