import type { Context } from "fresh";
import { define, type State } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { corsHeaders, READ_ALLOWED_HEADERS } from "@web/utils/read-endpoint.ts";
import { invalidFields } from "@web/utils/service-response.ts";
import { ArchiveProjectSchema, UpdateProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `PUT | PATCH | DELETE | OPTIONS /api/projects/:id` — the owner's configuration write path behind
 * the Details setup form. `:id` is the project SLUG, which is how every other `/api/projects/*`
 * endpoint addresses an engagement.
 *
 * `PUT` and `PATCH` share one schema and one fat method on purpose: `UpdateProjectSchema` is
 * all-optional, so a PATCH sends the section that changed and a PUT sends the whole form, and the
 * reconciliation is identical either way. Splitting them into two bodies would be two places for the
 * same merge to drift.
 *
 * `DELETE` is a **soft archive** — `status = 'archived'` + `archived_at`, never a row removal (root
 * CLAUDE.md §5). The verb is DELETE because that is what the caller means; what the server does with
 * it is the domain's decision, not HTTP's.
 *
 * **No capability guard here.** A server-side owner/`isFreelancer` bounce is forbidden: the Dev
 * Context Switcher's persona is a client seam the server never sees, so such a gate would fire on a
 * simulated persona and refuse a real owner. RLS is the real gate (Decision #53(b)); the fat service
 * refuses what the acting identity may not write. The one identity check kept here is the 401 below —
 * a write genuinely needs somebody to attribute it to, which is the difference between this route and
 * the reads, which are deliberately reachable by a guest.
 */

// #region Handlers
/** The 401 an unattributable write earns, shaped like every other `ProjectsResult` failure. */
const UNAUTHENTICATED = { ok: false, message: "Sign in to change this project." };

/**
 * `PUT` and `PATCH`: parse the edit body and delegate.
 *
 * The verb is the `replace` flag, and it is the destructive half: a `PUT` says "here is the whole
 * resource", so a stage or role it does not mention is gone; a `PATCH` says "here is the part that
 * changed", so an absent stage means nothing at all. Collapsing that distinction made a title-only
 * save capable of deleting a project's entire pipeline — and deleting a stage releases the escrow
 * held against it.
 *
 * The DEV-ONLY `sim` rides the query string rather than the body — it is not part of the
 * configuration being saved — and is passed through raw: the service validates it and discards it
 * outside development.
 */
async function update(ctx: Context<State>): Promise<Response> {
	const actor = readActor(ctx);
	if (!actor.userId) return Response.json(UNAUTHENTICATED, { status: 401 });

	const parsed = UpdateProjectSchema.safeParse(await ctx.req.json().catch(() => null));
	if (!parsed.success) return invalidFields(parsed.error.issues);

	return toProjectsResponse(
		await ProjectBackendService.updateProject(
			ctx.params.id,
			parsed.data,
			actor,
			ctx.req.method === "PUT",
			ctx.url.searchParams.get("sim"),
		),
	);
}

export const handler = define.handlers({
	PUT: update,
	PATCH: update,

	async DELETE(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return Response.json(UNAUTHENTICATED, { status: 401 });

		// A DELETE legitimately carries no body, and every field of the archive payload is optional —
		// so an absent or unreadable body means "archive it, no reason given" rather than a 422. Parsing
		// `null` would fail the object check and turn the ordinary case into an error.
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ArchiveProjectSchema.safeParse(raw ?? {});
		if (!parsed.success) return invalidFields(parsed.error.issues);

		return toProjectsResponse(
			await ProjectBackendService.archiveProject(ctx.params.id, parsed.data, actor),
		);
	},

	/**
	 * The preflight, answered truthfully.
	 *
	 * `Allow` is the authoritative answer to "what does this resource accept", and this resource
	 * accepts no `GET` — advertising the read module's `GET, HEAD, OPTIONS` here would tell a browser
	 * to preflight-fail the very writes the route exists for. The header allow-list is reused rather
	 * than restated: it is the same set, and a second literal is a second thing to keep in step.
	 */
	OPTIONS(ctx) {
		const allow = "PUT, PATCH, DELETE, OPTIONS";
		const headers = new Headers({
			Allow: allow,
			"Access-Control-Allow-Methods": allow,
			"Access-Control-Allow-Headers": READ_ALLOWED_HEADERS,
			"Access-Control-Max-Age": "600",
			// A preflight describes capability, not content; caching it against the
			// session would be wrong.
			"Cache-Control": "no-store",
		});
		for (const [key, value] of Object.entries(corsHeaders(ctx.req, ctx.url))) {
			headers.set(key, value);
		}
		return new Response(null, { status: 204, headers });
	},
});
// #endregion
