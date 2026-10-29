/**
 * csrf — the `/api/*` write guard (IW-M2). Every state-changing request (POST, PUT, PATCH, DELETE)
 * must come from this site and carry a JSON body, or it is refused before any handler runs.
 *
 * **Why both checks.** The session cookies are `SameSite=Lax`, which stops a cross-site
 * `fetch` from carrying them but not every route needs a session to do harm: a sign-in form posted
 * from another site (login CSRF) signs the visitor into the attacker's account. Another page can
 * submit a form, or a `text/plain` body, without a CORS preflight, but it cannot send
 * `application/json` cross-origin without one, and it can never forge the browser's `Origin`. So:
 *
 * - **Origin.** The `Origin` header must be this site's own (the request's origin, or `APP_URL`'s
 *   behind a proxy). When a browser sends no `Origin`, `Sec-Fetch-Site: same-origin` stands in for
 *   it. A request with neither is refused: every browser this site supports sends one of them on a
 *   write, so their absence means a non-browser caller, and those use the exempt doors below.
 * - **Content type.** A body must be declared `application/json`. A bodiless write (no
 *   `Content-Type`, no length) passes, since it carries nothing to forge.
 *
 * **Exempt doors.** Webhooks (`/api/…/webhooks/…`) and scheduler endpoints (`/api/…/cron/…`) are
 * called server-to-server, never by a browser, and authenticate with a signature or a bearer secret
 * instead. The two progressive-enhancement forms (`/api/contact`, `/api/help/feedback`) also accept
 * a form body, but still only from this site's own pages.
 *
 * The `pj_csrf` double-submit cookie (`utils/storage-keys.ts`) was the earlier plan for this; the
 * Origin check makes it unnecessary, and it stays unset.
 */

// #region Policy
/** The methods that change state; `GET`, `HEAD` and `OPTIONS` pass untouched. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Server-to-server doors, authenticated by a signature or a bearer secret. */
const SERVER_TO_SERVER = /^\/api\/(?:[^/]+\/)*(?:webhooks|cron)(?:\/|$)/;

/** Routes whose no-JavaScript fallback is a plain HTML form post. */
const FORM_ROUTES = new Set(["/api/contact", "/api/help/feedback"]);

const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);
// #endregion

// #region Guard
/** The media type of a request's body, lowercased without parameters; `""` when undeclared. */
function mediaType(req: Request): string {
	return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/** Whether the request is from one of `origins`, by its `Origin` or, failing that, `Sec-Fetch-Site`. */
function isSameOrigin(req: Request, origins: ReadonlySet<string>): boolean {
	const origin = req.headers.get("origin");
	if (origin !== null) return origins.has(origin.toLowerCase());
	return req.headers.get("sec-fetch-site")?.toLowerCase() === "same-origin";
}

/** Whether the request declares a body to read. */
function hasBody(req: Request): boolean {
	if (req.headers.has("content-type") || req.headers.has("transfer-encoding")) return true;
	const length = Number(req.headers.get("content-length") ?? "0");
	return Number.isFinite(length) && length > 0;
}

function originOf(url: string | undefined): string | null {
	if (!url || !URL.canParse(url)) return null;
	return new URL(url).origin.toLowerCase();
}

/**
 * The refusal for a cross-site or non-JSON `/api` write, or `null` to carry on. `appUrl` is the
 * configured public origin (`APP_URL`), accepted alongside the request's own origin so a deployment
 * behind a TLS-terminating proxy still recognises its own pages.
 */
export function refuseCrossSiteWrite(req: Request, appUrl?: string): Response | null {
	if (!WRITE_METHODS.has(req.method.toUpperCase())) return null;
	const url = new URL(req.url);
	if (!url.pathname.startsWith("/api/") || SERVER_TO_SERVER.test(url.pathname)) return null;

	const origins = new Set([url.origin.toLowerCase()]);
	const configured = originOf(appUrl);
	if (configured) origins.add(configured);
	if (!isSameOrigin(req, origins)) {
		return Response.json(
			{ ok: false, message: "This request didn't come from Projective, so it was refused." },
			{ status: 403, headers: { "cache-control": "no-store" } },
		);
	}

	if (!hasBody(req)) return null;
	const type = mediaType(req);
	if (type === "application/json") return null;
	if (FORM_ROUTES.has(url.pathname.replace(/\/+$/, "")) && FORM_TYPES.has(type)) return null;
	return Response.json(
		{ ok: false, message: "Send this request as JSON." },
		{ status: 415, headers: { "cache-control": "no-store" } },
	);
}
// #endregion
