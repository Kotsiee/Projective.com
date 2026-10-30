import { define } from "@web/utils/state.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { ArticlesIndexView } from "../components/ArticlesIndexView.tsx";
import { ARTICLE_ICONS } from "../components/article-icons.tsx";
import { ArticleGlyphContext } from "../core/article-glyphs.ts";
import ArticleMediaFade from "../islands/ArticleMediaFade.island.tsx";
import { handler } from "./index-handler.ts";

export { handler };

/**
 * `/articles` — Projective's articles (P6, Decision #271): a lead story, two features and the grid,
 * filtered by topic and paged. The island carries the surface's stylesheet on every state (results
 * or the empty state) and fades lazy covers in; the structured data is a CollectionPage + ItemList.
 */
export default define.page<typeof handler>(function ArticlesIndexPage({ data }) {
	return (
		<>
			<ArticleGlyphContext.Provider value={ARTICLE_ICONS}>
				<ArticlesIndexView index={data.index} />
			</ArticleGlyphContext.Provider>
			<ArticleMediaFade />
			<JsonLd graph={data.jsonLd} />
		</>
	);
});
