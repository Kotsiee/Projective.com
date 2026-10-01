import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LinkPreviewBackendService } from "@server/services/links/LinkPreviewBackendService.ts";
import ExitInterstitial from "@web/features/links/islands/ExitInterstitial.island.tsx";

/**
 * `/exit?url=…` — the interstitial an external link from a message routes through unless its scan
 * came back safe (`externalLinkHref`). Thin controller: read the link, ask the fat
 * {@link LinkPreviewBackendService} what is known about it, hand the answer to the island. The page
 * never redirects — leaving is always the reader's own click — so it is not an open redirect.
 *
 * `noindex` because the query string is a stranger's URL; `no-referrer` so the page that names the
 * link is not announced to it; `no-store` because a signed-in reader's visit may scan it afresh.
 */

const EXIT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
	"cache-control": "private, no-store",
});

export const handler = define.handlers({
	async GET(ctx) {
		const raw = ctx.url.searchParams.get("url") ?? "";
		const confirmed = ctx.url.searchParams.get("confirm") === "1";
		const result = await LinkPreviewBackendService.exitCheck(raw, readActor(ctx), ctx.url.host);
		const check = result.ok && result.data ? result.data : null;
		ctx.state.title = "Leaving Projective";
		return page({ check, confirmed, backHref: ctx.state.isAuthenticated ? "/messages" : "/" }, {
			status: check ? 200 : 422,
			headers: EXIT_HEADERS,
		});
	},
});

export default define.page<typeof handler>(function ExitPage({ data }) {
	return (
		<ExitInterstitial check={data.check} confirmed={data.confirmed} backHref={data.backHref} />
	);
});
