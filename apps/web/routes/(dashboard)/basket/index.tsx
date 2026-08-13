import { define } from "@web/utils/state.ts";

/**
 * `/basket` — retired to a redirect onto `/checkout`, the flow's first step.
 *
 * The basket overview IS step 1 of the four-step checkout, so it has one canonical URL and this is not
 * it. The file is KEPT rather than deleted (root CLAUDE.md §5 — nothing is hard-deleted) because
 * `/basket` is still reachable from things this change does not control: bookmarks, shared links, and
 * anything a previous build wrote down.
 *
 * **The query string is preserved.** `?basket=` and `?owner=` are load-bearing — dropping them lands an
 * entity buyer on their personal basket, which is somebody else's money.
 *
 * **302, not 308.** A permanent redirect is cached by the browser indefinitely with no server-side way
 * to invalidate it: it outlives the deploy that would fix it, in every browser that ever saw it. This
 * product is pre-launch and the flow's first step is still *called* "Basket", so the route may
 * legitimately come back. The cost of a temporary redirect is one round trip on a URL nothing generates
 * any more.
 *
 * **A `Response` returned from a `define.page` component is dead code** — it is a render function, not
 * a handler — which is why the redirect below is returned from `define.handlers`. A whole surface has
 * already been lost to that trap once (root CLAUDE.md Decision #61), and a redirect that silently never
 * fires would leave a second, divergent copy of the basket live at this path.
 */
export const handler = define.handlers({
	GET(ctx) {
		const target = new URL(ctx.url);
		target.pathname = "/checkout";
		return new Response(null, {
			status: 302,
			headers: { location: target.pathname + target.search },
		});
	},
});
