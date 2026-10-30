import { define } from "@web/utils/state.ts";
import { DocumentPage } from "@features/marketing/components/DocumentPage.tsx";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { ArticleReaderView } from "../components/ArticleReaderView.tsx";
import { ARTICLE_ICONS } from "../components/article-icons.tsx";
import { ArticleGlyphContext } from "../core/article-glyphs.ts";
import { ArticleMissingView } from "../components/ArticleMissingView.tsx";
import ArticleMediaFade from "../islands/ArticleMediaFade.island.tsx";
import { handler } from "./reader-handler.ts";

export { handler };

/**
 * `/articles/[slug]` — one of Projective's articles on P0's document reader (P6, Decision #271), its
 * one canonical address. The island carries the surface's stylesheet and fades lazy figures in; the
 * structured data is an Article with its BreadcrumbList. An address that names no visible article
 * renders the not-found notice in the same frame, carried by the same island.
 */
export default define.page<typeof handler>(function ArticleReaderPage({ data }) {
	if (data.kind === "missing") return <ArticleMissingView carrier={<ArticleMediaFade />} />;
	return (
		<>
			<ArticleGlyphContext.Provider value={ARTICLE_ICONS}>
				<ArticleReaderView page={data.page} signedIn={data.signedIn} Document={DocumentPage} />
			</ArticleGlyphContext.Provider>
			<ArticleMediaFade />
			<JsonLd graph={data.jsonLd} />
		</>
	);
});
