import type { Context } from "fresh";
import { define, type State } from "@web/utils/state.ts";
import { refuseCrossSitePageWrite } from "@web/utils/csrf.ts";
import { resolveRequestViewer } from "@web/utils/session.ts";
import { resolveCurrencyContext, runWithCurrency } from "@web/utils/currency-context.ts";
import { resolveA11yContext } from "@web/utils/a11y-context.ts";
import { resolveScreenShare } from "@web/utils/screen-share-context.ts";
import { runWithScreenShare } from "@web/utils/screen-share-scope.ts";
import { cspHeaderFor, frameOptionsFor } from "@web/utils/csp.ts";

/**
 * Global middleware — runs for every request. Resolves auth **site-wide** (chrome only) and adds
 * baseline security headers.
 *
 * `isAuthenticated` and `userContext` (User Context Hydration) come from the session JWT only once it
 * verifies ({@link resolveRequestViewer}: signature, expiry, a user session's claims — locally, against
 * cached keys), so EVERY route — including the public Home/Explore surfaces — renders the correct
 * navigation shell and skeletons in SSR, and a tampered or expired cookie paints a guest. An expired
 * session is not renewed here; a guard or a page that needs the viewer renews it (`ensureSession`).
 * RLS remains the backstop. The Content-Security-Policy (SYSTEM_ARCHITECTURE §Runtime & API Security)
 * is set here too — see `utils/csp.ts`.
 *
 * **The CSP is a default a route may tighten** (like `referrer-policy`): a route that answers with its
 * own stricter policy keeps it. The two sanctioned loosenings are the file inspector's
 * `cspHeaderFor("inspector")` profile (Decision #161(D)) and the buyer simulation's
 * `cspHeaderFor("framed")` profile (Decision #217 (j)). **Of the rest, two are floors; one is a default.** This middleware runs OUTSIDE every route, so its
 * post-processing is the last thing to touch the response — a `set` here silently overwrites whatever
 * a route decided. `x-frame-options` and `x-content-type-options` are non-negotiable and are set
 * unconditionally; `x-frame-options` is `DENY` for every response except one carrying exactly the
 * `framed` policy, which gets `SAMEORIGIN` so the two framing headers agree (`frameOptionsFor`). `referrer-policy` is not: a route whose URL *is* a secret must be able to harden it
 * to `no-referrer` (the public `/share/[slug]` capability URL does exactly that), and an unconditional
 * `set` would quietly undo it while the route's own code still read as though it had worked. So the
 * platform value is applied only when the response has not already answered for itself — a floor a
 * route may raise, never one it can lower, since nothing removes the header.
 *
 * **A cross-site write never reaches a page route** (IW-M2, PRD-C12). Before it resolves anything,
 * this middleware runs `utils/csrf.ts` {@link refuseCrossSitePageWrite} on every request, so a POST,
 * PUT, PATCH or DELETE to any route outside `/api` must come from this site's own pages (by `Origin`,
 * else `Sec-Fetch-Site`) with a form or JSON body. A page that grows a write handler is covered by
 * construction. `/api` keeps its own guard (`routes/api/_middleware.ts`), with the webhook and
 * scheduler exemptions; which one a write meets is decided by the route Fresh matched. The refusal
 * gets the same headers below as any other answer.
 */
export default define.middleware(async (ctx) => {
	const refused = refuseCrossSitePageWrite(ctx.req, ctx.route, Deno.env.get("APP_URL"));
	const res = refused ?? await resolveAndRender(ctx);
	if (!res.headers.has("content-security-policy")) {
		res.headers.set("content-security-policy", cspHeaderFor("app"));
	}
	res.headers.set("x-frame-options", frameOptionsFor(res.headers.get("content-security-policy")));
	res.headers.set("x-content-type-options", "nosniff");
	if (!res.headers.has("referrer-policy")) {
		res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	}
	return res;
});

// #region Request context
/** Resolve the viewer, currency, overlays and screen sharing, then run the rest of the chain. */
async function resolveAndRender(ctx: Context<State>): Promise<Response> {
	const viewer = await resolveRequestViewer(ctx.req);
	ctx.state.isAuthenticated = viewer.isAuthenticated;
	ctx.state.userContext = viewer.userContext;
	// The money-presentation context (currency · locale · rate table), resolved for EVERY route
	// including public ones — a signed-out visitor browsing Explore needs prices in their currency
	// exactly as much as a signed-in one. Cached for 15 minutes inside the FX engine, and total: it
	// never throws and never blocks, so an unavailable rate table costs a conversion, not a request.
	ctx.state.currency = await resolveCurrencyContext(ctx.req, ctx.state.userContext);
	// The accessibility overlays, from the `pj.a11y` cookie — a header read, no I/O — so `_app.tsx`
	// paints high contrast, OpenDyslexic, a CVD shift or reduced motion in the first byte.
	ctx.state.a11y = resolveA11yContext(ctx.req);
	// Screen sharing mode, from the `pj.screen_share` cookie (Decision #297) — a header read, no I/O.
	ctx.state.screenShare = resolveScreenShare(ctx.req);
	// Opened around the WHOLE chain, not just the render: `AsyncLocalStorage` is what carries the
	// currency and the screen sharing state past every island boundary and every await to the
	// deepest server-rendered figure.
	const screenShare = ctx.state.screenShare;
	return await runWithCurrency(
		ctx.state.currency,
		() => runWithScreenShare(screenShare, () => ctx.next()),
	);
}
// #endregion
