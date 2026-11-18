/**
 * csrf — the same-origin write guard (IW-M2, PRD-C12). Every state-changing request (POST, PUT,
 * PATCH, DELETE) to any route must come from this site, or it is refused before a handler runs. It
 * has two doors, one per kind of route:
 *
 * - **`/api/*`** ({@link refuseCrossSiteWrite}, run by `routes/api/_middleware.ts`): same-origin
 *   **and** a JSON body.
 * - **Every other route** ({@link refuseCrossSitePageWrite}, run by the root `routes/_middleware.ts`
 *   before anything else): same-origin, with a form or JSON body. A page that grows a write handler
 *   (today `/rsvp/:token`, whose token is in the URL) is covered by construction, with nothing to
 *   register. `utils/page-write-routes.test.ts` lists those pages and pins that the guard covers them.
 *
 * **Why both checks on `/api`.** The session cookies are `SameSite=Lax`, which stops a cross-site
 * `fetch` from carrying them but not every route needs a session to do harm: a sign-in form posted
 * from another site (login CSRF) signs the visitor into the attacker's account, and a capability URL
 * (an invitation link) needs no session at all. Another page can submit a form, or a `text/plain`
 * body, without a CORS preflight, but it cannot send `application/json` cross-origin without one, and
 * it can never forge the browser's `Origin`. So:
 *
 * - **Origin** (both doors). The `Origin` header must be this site's own (the request's origin, or
 *   `APP_URL`'s behind a proxy). When a browser sends no `Origin`, or the opaque `null` it sends for a
 *   form posted from a `Referrer-Policy: no-referrer` page, `Sec-Fetch-Site: same-origin` stands in
 *   for it. A page cannot forge that header, and an opaque initiator (a sandboxed frame, a `data:`
 *   page) is `cross-site`. A request with neither is refused: every browser this site supports sends
 *   one of them on a write, so their absence means a non-browser caller, and those use the exempt
 *   doors below.
 * - **Content type.** On `/api` a body must be declared `application/json`; on a page route, a form
 *   (`application/x-www-form-urlencoded`, `multipart/form-data`) or JSON. A bodiless write (no
 *   `Content-Type`, no length) passes, since it carries nothing to forge.
 *
 * **Exempt doors, on `/api` only.** Webhooks (`/api/…/webhooks/…`), scheduler endpoints
 * (`/api/…/cron/…`) and the notification dispatcher (`/api/comms/dispatch`, posted to by the database)
 * are called server-to-server, never by a browser, and authenticate with a signature or a bearer
 * secret instead. The plain HTML forms (`/api/contact`, `/api/help/feedback`, and
 * `/api/auth/confirm`, the email-confirmation page's one button) also accept a form body, but still
 * only from this site's own pages. A page route has no exemption. So do the newsletter link's two
 * buttons (`/api/newsletter/confirm`, `/api/newsletter/unsubscribe`); the second is also the RFC 8058
 * one-click URL a mail provider's servers post to, so it alone skips the Origin check, taking a form
 * body only, with the link's token as its credential (PRD-E11).
 *
 * **Which door a write meets** is decided by the route Fresh matched, not by how the path looks: the
 * page door stands aside only when the matched route **and** the path are under `/api/`, which is
 * exactly when the `/api` door runs. An `/api/…` URL that no API route matches can fall through to a
 * page pattern (`/:handle/:tab`), where the `/api` middleware never runs, so the page door takes it.
 *
 * The `pj_csrf` double-submit cookie (`utils/storage-keys.ts`) was the earlier plan for this; the
 * Origin check makes it unnecessary, and it stays unset.
 */

// #region Policy
/** The methods that change state; `GET`, `HEAD` and `OPTIONS` pass untouched. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Server-to-server doors, authenticated by a signature or a bearer secret. */
const SERVER_TO_SERVER = /^\/api\/(?:[^/]+\/)*(?:webhooks|cron)(?:\/|$)/;

/**
 * Server-to-server doors outside those two segments, by exact path. `/api/comms/dispatch` is posted
 * to by the database itself (pg_net, from the `comms.notifications` trigger) with a Vault bearer, at
 * the path Decision #344 (a) fixed.
 */
const MACHINE_ROUTES = new Set(["/api/comms/dispatch"]);

/** Whether `pathname` is a server-to-server door, which the browser-origin guard stands aside for. */
function isServerToServer(pathname: string): boolean {
	return SERVER_TO_SERVER.test(pathname) || MACHINE_ROUTES.has(pathname.replace(/\/+$/, ""));
}

/** Routes a plain HTML form posts to, with or without JavaScript. */
const FORM_ROUTES = new Set([
	"/api/contact",
	"/api/help/feedback",
	"/api/auth/confirm",
	"/api/newsletter/confirm",
	"/api/newsletter/unsubscribe",
]);

/**
 * RFC 8058 one-click unsubscribe endpoints: the URL a mail's `List-Unsubscribe` header names. A mail
 * client posts `List-Unsubscribe=One-Click` from its own servers, cross-site and with no `Origin`, so
 * the Origin check stands aside here: the token in the URL is the credential, and an unsubscribe is
 * the one write a forged post could only make on a link the forger already holds. A form body (or
 * none) only. The newsletter's (an anonymous list) and an account's marketing email (COMMS NT3).
 */
const ONE_CLICK_ROUTES = new Set(["/api/newsletter/unsubscribe", "/api/comms/unsubscribe"]);

const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);

/** What a page route's own form or script may send: a form, or JSON. */
const PAGE_BODY_TYPES = new Set([...FORM_TYPES, "application/json"]);

/** The prefix the `/api` door owns, for paths and route patterns alike. */
const API_PREFIX = "/api/";
// #endregion

// #region Guard
/** The media type of a request's body, lowercased without parameters; `""` when undeclared. */
function mediaType(req: Request): string {
	return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Whether the request is from one of `origins`, by its `Origin` or, when that is absent or the
 * opaque `null`, by `Sec-Fetch-Site`.
 */
function isSameOrigin(req: Request, origins: ReadonlySet<string>): boolean {
	const origin = req.headers.get("origin")?.trim().toLowerCase();
	if (origin && origin !== "null") return origins.has(origin);
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

/** This site's own origins: the request's, and `APP_URL`'s when one is configured. */
function ownOrigins(url: URL, appUrl: string | undefined): Set<string> {
	const origins = new Set([url.origin.toLowerCase()]);
	const configured = originOf(appUrl);
	if (configured) origins.add(configured);
	return origins;
}

/**
 * The refusal for a cross-site or non-JSON `/api` write, or `null` to carry on. `appUrl` is the
 * configured public origin (`APP_URL`), accepted alongside the request's own origin so a deployment
 * behind a TLS-terminating proxy still recognises its own pages.
 */
export function refuseCrossSiteWrite(req: Request, appUrl?: string): Response | null {
	if (!WRITE_METHODS.has(req.method.toUpperCase())) return null;
	const url = new URL(req.url);
	if (!url.pathname.startsWith(API_PREFIX) || isServerToServer(url.pathname)) return null;
	if (ONE_CLICK_ROUTES.has(url.pathname.replace(/\/+$/, ""))) {
		if (!hasBody(req) || FORM_TYPES.has(mediaType(req))) return null;
		return Response.json(
			{ ok: false, message: "Send this request as a form." },
			{ status: 415, headers: { "cache-control": "no-store" } },
		);
	}

	if (!isSameOrigin(req, ownOrigins(url, appUrl))) {
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

/**
 * The refusal for a cross-site write to any route outside `/api`, or `null` to carry on. The root
 * middleware runs it on every request, before it resolves anything, so every page route that accepts
 * a write is guarded with nothing to register.
 *
 * `route` is the pattern Fresh matched (`ctx.route`; `null` when nothing matched). A write whose path
 * **and** matched route are both under `/api/` is left to {@link refuseCrossSiteWrite}, which that
 * folder's middleware runs; every other write must be same-origin by the same rule, and its body a
 * form or JSON. The webhook and scheduler exemptions do not reach here: they exist only on `/api`.
 * The refusal is plain text, since the person who sees it was sent here by another site's form.
 */
export function refuseCrossSitePageWrite(
	req: Request,
	route: string | null,
	appUrl?: string,
): Response | null {
	if (!WRITE_METHODS.has(req.method.toUpperCase())) return null;
	const url = new URL(req.url);
	if (url.pathname.startsWith(API_PREFIX) && route?.startsWith(API_PREFIX)) return null;

	if (!isSameOrigin(req, ownOrigins(url, appUrl))) {
		return new Response("This form didn't come from Projective, so it was refused.", {
			status: 403,
			headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
		});
	}

	if (!hasBody(req) || PAGE_BODY_TYPES.has(mediaType(req))) return null;
	return new Response("Send this form as a form or as JSON.", {
		status: 415,
		headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
	});
}
// #endregion
