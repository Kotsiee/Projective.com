import { define } from "@web/utils/state.ts";

/**
 * `/projects/create` — retired. Creation is now a two-stage flow: a **Quick-Init modal** on
 * `/projects` collects the four facts that can mint a coherent draft (title · type · currency · one
 * baseline price), and everything else is configured afterwards on the draft's own workspace at
 * `/projects/[projectId]`. There is no standalone create page to land on any more, so a stale link is
 * sent to where the modal lives.
 *
 * **This file must not be deleted.** Removing it does not produce a redirect — it produces a dead
 * end: with no static `create` segment, `/projects/create` falls into the dynamic `[projectId]` route,
 * resolves no engagement, and renders "project not found" quoting the word `create` back at the
 * reader, with the feed lane rendering beside it because the lane resolver maps `create` to `null`.
 * Thirteen lines and one route-table entry are what guarantee that segment cannot be captured.
 *
 * 308 rather than 307: the page is permanently gone, not temporarily moved, so a client may cache the
 * substitution and stop asking. Like 307 it preserves the method, which matters because a stale
 * bookmark is a GET but a stale form post is not.
 *
 * It carries NO default export on purpose. The handler answers every request before a component
 * could render, so a page function here would be unreachable code holding the retired six-step
 * wizard's whole module graph alive — and because islands are discovered by walking
 * `apps/web/features`, that graph is evaluated at boot whether or not anything renders it.
 */
export const handler = define.handlers({
	GET() {
		return new Response(null, { status: 308, headers: { Location: "/projects" } });
	},
});
