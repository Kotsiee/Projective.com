import { define } from "@web/utils/state.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `GET /api/integrations/callback?state=&code=` — complete an OAuth consent.
 *
 * The provider redirects the USER'S BROWSER here, so this route answers with a **302 to a page**, not
 * with JSON: a JSON body would be rendered as raw text in the address bar the person is watching. It
 * is a `GET` because a redirect is a `GET`, and it takes no body.
 *
 * Delegates to the fat {@link IntegrationsBackendService.completeConnection}, which consumes the
 * single-use `state` (a replayed callback must not authorise twice), exchanges the code, and seals the
 * token straight into the vault. **No token is ever returned, logged or attached to the result** — the
 * caller receives a connection row, which by construction cannot carry one — and nothing about the
 * exchange reaches this route, which is why the handler has no access to what was granted.
 *
 * The outcome is signalled as a coarse `connect=` marker on the destination and never as a reason: the
 * callback is unauthenticated, and distinguishing "expired state" from "unknown state" in a
 * user-visible URL tells a prober which states exist. The service already refuses both identically.
 *
 * **Where it returns to is fixed, not caller-chosen.** `returnTo` is captured at `start` and consumed
 * inside the service alongside the `state`, so it does not reach this handler — which is the safe
 * shape anyway: a redirect target read from this request would be an open redirect wearing the
 * platform's domain. Threading the stored `returnTo` back out is the follow-up (flagged in the report).
 */

/** Where a completed or failed consent lands. Fixed, never read from the request (see the note). */
const SETTINGS = "/settings";

/** A 302 to the settings surface, carrying only a coarse outcome marker. */
function back(url: URL, outcome: "connected" | "failed"): Response {
	const dest = new URL(SETTINGS, url);
	dest.searchParams.set("connect", outcome);
	return new Response(null, { status: 302, headers: { location: dest.href } });
}

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const state = sp.get("state");
		const code = sp.get("code");

		// The provider reports a declined or errored consent with `error`, and sends no code. It is a
		// normal outcome (the person pressed Cancel), not a fault, so it takes the same quiet path.
		if (sp.get("error") || !state || !code) return back(ctx.url, "failed");

		const result = await IntegrationsBackendService.completeConnection({ state, code });
		return back(ctx.url, result.ok ? "connected" : "failed");
	},
});
