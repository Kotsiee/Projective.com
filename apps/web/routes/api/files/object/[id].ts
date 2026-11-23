import { define } from "@web/utils/state.ts";
import { MEDIA_PROXY_ROUTE } from "@projective/types/files";

/**
 * `GET /api/files/object/[id]?tier=&download=1&share=` — retired (`ASSET_DELIVERY_ARCHITECTURE.md` §5.3,
 * phase 1). It used to redirect to a signed storage URL; now it is a permanent `308` to the media proxy
 * with the same query, so a link already issued (a downloaded data export's file list) keeps working
 * behind the proxy's read decision. It reads nothing and signs nothing.
 */
export const handler = define.handlers({
	GET(ctx) {
		return new Response(null, {
			status: 308,
			headers: {
				location: `${MEDIA_PROXY_ROUTE}/${encodeURIComponent(ctx.params.id)}${ctx.url.search}`,
				"cache-control": "public, max-age=86400",
			},
		});
	},
});
