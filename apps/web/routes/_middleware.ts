import { define } from "@web/utils/state.ts";
import { hasSessionCookie } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { resolveCurrencyContext, runWithCurrency } from "@web/utils/currency-context.ts";
import { contentSecurityPolicy, originOf } from "@web/utils/csp.ts";

/**
 * The Content-Security-Policy, built once per process on the FIRST request (it depends only on the
 * environment). Lazily, not at module load: under the dev server this module can be imported before
 * `main.ts` has loaded `.env`, and a policy built then silently omitted the Supabase origin. See
 * `utils/csp.ts` for why each origin is there — Stripe's script/frames/API above all (Decision #126).
 */
let csp: string | null = null;
function cspHeader(): string {
	csp ??= contentSecurityPolicy({
		dev: (Deno.env.get("DENO_ENV") ?? "development").toLowerCase() !== "production",
		supabaseOrigin: originOf(Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL")),
	});
	return csp;
}

/**
 * Global middleware — runs for every request. Resolves auth **site-wide** (chrome only) and adds
 * baseline security headers.
 *
 * `isAuthenticated` is set from a skeleton session-cookie presence check, and `userContext` from an
 * unverified decode of the session JWT's claims (User Context Hydration), so EVERY route — including
 * the public Home/Explore surfaces — can render the correct navigation shell and skeletons in SSR
 * (guest vs unified user L-shell, and which structural context to frame). Both are presence/skeleton
 * signals: they do NOT verify the JWT and grant no access; the `(dashboard)/_middleware.ts` guard +
 * RLS remain the real gates. The Content-Security-Policy (SYSTEM_ARCHITECTURE §Runtime & API Security)
 * is set here too — see `utils/csp.ts`.
 *
 * **The CSP is a default a route may tighten** (like `referrer-policy`): a route that answers with its
 * own stricter policy keeps it. **Of the rest, two are floors; one is a default.** This middleware runs OUTSIDE every route, so its
 * post-processing is the last thing to touch the response — a `set` here silently overwrites whatever
 * a route decided. `x-frame-options` and `x-content-type-options` are non-negotiable and are set
 * unconditionally. `referrer-policy` is not: a route whose URL *is* a secret must be able to harden it
 * to `no-referrer` (the public `/share/[slug]` capability URL does exactly that), and an unconditional
 * `set` would quietly undo it while the route's own code still read as though it had worked. So the
 * platform value is applied only when the response has not already answered for itself — a floor a
 * route may raise, never one it can lower, since nothing removes the header.
 */
export default define.middleware(async (ctx) => {
	ctx.state.isAuthenticated = hasSessionCookie(ctx.req);
	ctx.state.userContext = resolveRequestContext(ctx.req);
	// The money-presentation context (currency · locale · rate table), resolved for EVERY route
	// including public ones — a signed-out visitor browsing Explore needs prices in their currency
	// exactly as much as a signed-in one. Cached for 15 minutes inside the FX engine, and total: it
	// never throws and never blocks, so an unavailable rate table costs a conversion, not a request.
	ctx.state.currency = await resolveCurrencyContext(ctx.req, ctx.state.userContext);
	// Opened around the WHOLE chain, not just the render: `AsyncLocalStorage` is what carries the
	// currency past every island boundary and every await to the deepest server-rendered price.
	const res = await runWithCurrency(ctx.state.currency, () => ctx.next());
	if (!res.headers.has("content-security-policy")) {
		res.headers.set("content-security-policy", cspHeader());
	}
	res.headers.set("x-frame-options", "DENY");
	res.headers.set("x-content-type-options", "nosniff");
	if (!res.headers.has("referrer-policy")) {
		res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	}
	return res;
});
