import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { corsHeaders, READ_ALLOWED_HEADERS } from "@web/utils/read-endpoint.ts";
import { ArchiveProjectSchema, UpdateProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

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

// #region Validation
/**
 * Fold Zod issues into the field-keyed 422 envelope every `/api/projects/*` write answers with.
 * First issue per key wins — a field with three complaints gets the first one, because a form shows
 * one message per input and the rest would never be read.
 */
function fieldErrors(
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return errors;
}

/** The 422 a malformed body earns. */
function invalid(errors: Record<string, string>): Response {
	return Response.json(
		{ ok: false, message: "Check the highlighted fields.", errors },
		{ status: 422 },
	);
}

/** The 401 an unattributable write earns, shaped like every other `ProjectsResult` failure. */
function unauthenticated(): Response {
	return Response.json(
		{ ok: false, message: "Sign in to change this project." },
		{ status: 401 },
	);
}
// #endregion

// #region Handlers
/**
 * Parse an edit body and delegate. Shared by `PUT` and `PATCH` so the two cannot diverge on parsing
 * or on refusals — they differ in exactly one thing, and it is passed explicitly.
 *
 * `replace` is what separates the two verbs, and it is the destructive half: a `PUT` says "here is
 * the whole resource", so a stage or role it does not mention is gone; a `PATCH` says "here is the
 * part that changed", so an absent stage means nothing at all. Collapsing that distinction made a
 * title-only save capable of deleting a project's entire pipeline — and deleting a stage releases the
 * escrow held against it.
 */
async function applyUpdate(
	req: Request,
	slug: string,
	actor: ReadActor,
	replace: boolean,
): Promise<Response> {
	const raw = await req.json().catch(() => null);
	const parsed = UpdateProjectSchema.safeParse(raw);
	if (!parsed.success) return invalid(fieldErrors(parsed.error.issues));

	return toProjectsResponse(
		await ProjectBackendService.updateProject(slug, parsed.data, actor, replace),
	);
}

export const handler = define.handlers({
	PUT(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return unauthenticated();
		return applyUpdate(ctx.req, ctx.params.id, actor, true);
	},

	PATCH(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return unauthenticated();
		return applyUpdate(ctx.req, ctx.params.id, actor, false);
	},

	async DELETE(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return unauthenticated();

		// A DELETE legitimately carries no body, and every field of the archive payload is optional —
		// so an absent or unreadable body means "archive it, no reason given" rather than a 422. Parsing
		// `null` would fail the object check and turn the ordinary case into an error.
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ArchiveProjectSchema.safeParse(raw ?? {});
		if (!parsed.success) return invalid(fieldErrors(parsed.error.issues));

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
