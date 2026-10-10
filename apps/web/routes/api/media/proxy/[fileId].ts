import { define, type State } from "@web/utils/state.ts";
import { FILE_OBJECT_TIERS, type FileObjectTier } from "@projective/types/files";
import { MediaBackendService } from "@server/services/media/MediaBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET|HEAD /api/media/proxy/[fileId]?tier=&download=1&share=` — an asset's bytes, streamed through the
 * app after the read decision (Decision #161).
 *
 * The inspector's only byte source: no storage host, bucket or path reaches the page. `Range`, `If-Range`,
 * `If-None-Match` and `If-Modified-Since` are forwarded so media seeks and revalidation work; the abort
 * signal cancels the upstream read when the browser goes away. Downloads are never counted here — the
 * Download action records through `POST /api/files/download-record`.
 *
 * Every refusal is the same bodiless 404 (429 past the rate ceiling, 503 when storage is unreachable).
 */

interface ProxyContext {
	req: Request;
	url: URL;
	params: Record<string, string>;
	state: State;
}

async function proxy(ctx: ProxyContext, method: "GET" | "HEAD"): Promise<Response> {
	const sp = ctx.url.searchParams;
	const tierRaw = sp.get("tier");
	const tier = tierRaw && (FILE_OBJECT_TIERS as readonly string[]).includes(tierRaw)
		? tierRaw as FileObjectTier
		: null;
	const h = ctx.req.headers;
	const result = await MediaBackendService.streamAsset(readActor(ctx), ctx.params.fileId ?? "", {
		method,
		tier,
		share: sp.get("share") || null,
		download: sp.get("download") === "1",
		range: h.get("range"),
		ifRange: h.get("if-range"),
		ifNoneMatch: h.get("if-none-match"),
		ifModifiedSince: h.get("if-modified-since"),
		signal: ctx.req.signal,
	});

	if (!result.ok || !result.data) {
		const status = result.status === 429 || result.status === 503 ? result.status : 404;
		const headers = new Headers({ "cache-control": "no-store" });
		const retryAt = result.details?.retryAt;
		if (status === 429 && typeof retryAt === "string") {
			const seconds = Math.ceil((Date.parse(retryAt) - Date.now()) / 1000);
			headers.set("retry-after", String(Number.isFinite(seconds) ? Math.max(1, seconds) : 60));
		}
		return new Response(null, { status, headers });
	}

	const { status, headers, body } = result.data;
	return new Response(method === "HEAD" ? null : body, { status, headers });
}

export const handler = define.handlers({
	GET(ctx) {
		return proxy(ctx, "GET");
	},
	HEAD(ctx) {
		return proxy(ctx, "HEAD");
	},
});
