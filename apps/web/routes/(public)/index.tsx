import { define } from "@web/utils/state.ts";
import { ensureSession } from "@web/utils/session.ts";
import ExplorePage, {
	exploreResponse,
	sessionCookieHeaders,
} from "@features/explore/routes/ExplorePage.tsx";
import { frontPageRedirect } from "@features/explore/core/front-page.ts";
import {
	LANDING_JSONLD_ID,
	landingGraph,
	landingPageMeta,
} from "@features/landing/core/landing-seo.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";

/** A `303 See Other` to `location`, carrying the session's renewed or wiped cookies. */
function seeOther(location: string, cookies: [string, string][] = []): Response {
	return new Response(null, { status: 303, headers: [["location", location], ...cookies] });
}

/**
 * `/` — the front page (thin controller; Decision #349). A guest is served the Explore Home through
 * the controller `/explore` uses ({@link exploreResponse}), under the front page's head copy and
 * structured data. Everyone else is sent on with a `303` ({@link frontPageRedirect}), decided here and
 * never in the page: a `?demo=` deep link to `/features`; a signed-in session (renewed in place when
 * it lapsed, its cookies minted on the redirect) or any search to `/explore` with the same query.
 *
 * A `?tkv=` ticket link needs no server strip any more: a guest's shell strips it, and a signed-in
 * visitor carries it to `/explore`, whose shell opens the ticket.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const session = await ensureSession(ctx.req);
		const location = frontPageRedirect(ctx.url, session.authenticated);
		if (location) return seeOther(location, sessionCookieHeaders(session));
		const res = await exploreResponse(ctx, session);
		applyPageMeta(ctx.state, landingPageMeta(siteOrigin(ctx.url)));
		return res;
	},
});

export default define.page<typeof handler>(function FrontPage(props) {
	return (
		<>
			<JsonLd graph={landingGraph(siteOrigin(props.url))} id={LANDING_JSONLD_ID} />
			<ExplorePage {...props} />
		</>
	);
});
