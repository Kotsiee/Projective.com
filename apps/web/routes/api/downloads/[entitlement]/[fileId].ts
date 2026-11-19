import { define, type State } from "@web/utils/state.ts";
import { DeliveryBackendService } from "@server/services/catalogue/DeliveryBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET|HEAD /api/downloads/[entitlement]/[fileId]` — one file of a bought product, streamed to its
 * holder through the app (Decision #488; ASSET_DELIVERY_ARCHITECTURE.md §6, §11).
 *
 * `:entitlement` is the purchase's `ent-…` slug and `:fileId` a file of the version it bought. Thin:
 * this parses the request and forwards the transport fields (`Range`, `If-Range`, `If-None-Match`,
 * `If-Modified-Since`, the abort signal); `DeliveryBackendService.stream` owns the gate — the
 * entitlement read under the caller's own JWT, the acting context, its status, the file — and the
 * bytes, which never come from a signed URL (ruling A2) and never name a host, bucket or path.
 *
 * Two refusals are decided here because they need nothing but the request:
 *  - **Hotlink** — `Sec-Fetch-Site: cross-site` on anything but a top-level navigation is refused
 *    before a byte is spent (gate 2).
 *  - **Signed out** — a navigation goes to `/login?redirectTo=` this address; anything else is the
 *    same 404 (gate 3).
 *
 * Answers `200` · `206` · `304` · `416` with the `delivery` headers (§5.4); a bodiless `404` for every
 * refusal (a refunded or revoked purchase, another account's, a file outside the version); `429` with
 * `Retry-After`; `503` with `Retry-After` while the version's copy lands or when storage is unreachable.
 */

interface DownloadContext {
	req: Request;
	url: URL;
	params: Record<string, string>;
	state: State;
}

function bodiless(status: number, extra: Record<string, string> = {}): Response {
	return new Response(null, {
		status,
		headers: { "cache-control": "no-store", vary: "cookie, sec-fetch-dest", ...extra },
	});
}

function secondsUntil(iso: unknown, fallback: number): number {
	if (typeof iso !== "string") return fallback;
	const seconds = Math.ceil((Date.parse(iso) - Date.now()) / 1000);
	return Number.isFinite(seconds) ? Math.max(1, seconds) : fallback;
}

async function download(ctx: DownloadContext, method: "GET" | "HEAD"): Promise<Response> {
	const h = ctx.req.headers;
	const navigation = h.get("sec-fetch-dest") === "document";
	if (h.get("sec-fetch-site") === "cross-site" && !navigation) return bodiless(404);

	const actor = readActor(ctx);
	if (!actor.userId) {
		if (navigation) {
			const here = `${ctx.url.pathname}${ctx.url.search}`;
			return bodiless(303, { location: `/login?redirectTo=${encodeURIComponent(here)}` });
		}
		return bodiless(404);
	}

	const result = await DeliveryBackendService.stream(
		actor,
		ctx.params.entitlement ?? "",
		ctx.params.fileId ?? "",
		{
			method,
			range: h.get("range"),
			ifRange: h.get("if-range"),
			ifNoneMatch: h.get("if-none-match"),
			ifModifiedSince: h.get("if-modified-since"),
			signal: ctx.req.signal,
		},
	);

	if (!result.ok || !result.data) {
		if (result.status === 429) {
			return bodiless(429, { "retry-after": String(secondsUntil(result.details?.retryAt, 60)) });
		}
		if (result.status === 503) {
			const wait = result.details?.retryAfterSeconds;
			return bodiless(503, { "retry-after": String(typeof wait === "number" ? wait : 30) });
		}
		return bodiless(404);
	}

	const { status, headers, body } = result.data;
	return new Response(method === "HEAD" ? null : body, { status, headers });
}

export const handler = define.handlers({
	GET(ctx) {
		return download(ctx, "GET");
	},
	HEAD(ctx) {
		return download(ctx, "HEAD");
	},
});
