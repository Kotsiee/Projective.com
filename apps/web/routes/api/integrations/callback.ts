import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
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
 * **Where it returns to is the stored path, never this request.** `returnTo` is validated at `start`,
 * kept on the `state` row, and comes back from the service with the outcome: a redirect target read
 * from this request would be an open redirect wearing the platform's domain. A consent with no stored
 * path lands on Settings.
 */

/** Where a consent with no stored return path lands. */
const SETTINGS = "/settings";

/** A 302 to the stored path, carrying only a coarse outcome marker. */
function back(url: URL, returnTo: string | null, outcome: "connected" | "failed"): Response {
	const stored = new URL(returnTo ?? SETTINGS, url);
	const dest = stored.origin === url.origin ? stored : new URL(SETTINGS, url);
	dest.searchParams.set("connect", outcome);
	return new Response(null, { status: 302, headers: { location: dest.href } });
}

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const state = sp.get("state");
		const code = sp.get("code");

		if (!state) return back(ctx.url, null, "failed");

		// The provider reports a declined or errored consent with `error`, and sends no code. It is a
		// normal outcome (the person pressed Cancel), not a fault, so it takes the same quiet path, back
		// to where they started.
		const result = await IntegrationsBackendService.completeConnection(
			{ state, code: sp.get("error") ? null : code },
			readActor(ctx),
		);
		if (result.ok) return back(ctx.url, result.data!.returnTo, "connected");
		const returnTo = result.details?.returnTo;
		return back(ctx.url, typeof returnTo === "string" ? returnTo : null, "failed");
	},
});
