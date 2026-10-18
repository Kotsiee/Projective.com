import { define } from "@web/utils/state.ts";
import { DocumentPage } from "@features/marketing/components/DocumentPage.tsx";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { ArticleReaderView } from "../components/ArticleReaderView.tsx";
import ArticleMediaFade from "../islands/ArticleMediaFade.island.tsx";
import { handler } from "./reader-handler.ts";

export { handler };

/**
 * `/articles/[slug]` — one of Projective's articles on P0's document reader (P6, Decision #271), its
 * one canonical address. The island carries the surface's stylesheet and fades lazy figures in; the
 * structured data is an Article with its BreadcrumbList.
 */
export default define.page<typeof handler>(function ArticleReaderPage({ data }) {
	return (
		<>
			<ArticleReaderView page={data.page} signedIn={data.signedIn} Document={DocumentPage} />
			<ArticleMediaFade />
			<JsonLd graph={data.jsonLd} />
		</>
	);
});
