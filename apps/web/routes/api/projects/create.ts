import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateProjectSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/create` — the Quick-Init write. Thin: parse, Zod-validate, resolve the acting
 * identity, then delegate to the fat {@link ProjectBackendService}, which narrows the currency (the
 * body's choice, else `ctx.state.currency?.displayCurrency`), mints the draft row and its one
 * auto-provisioned root stage.
 *
 * **No capability guard.** A server-side `isFreelancer`/owner bounce is forbidden on this surface —
 * the Dev Context Switcher's persona is a client seam the server never sees, so such a gate would
 * fire on a simulated persona and refuse a real client (Decision #53(b)). RLS is the real gate. The
 * one identity check kept is the 401: a created project needs an owner to attribute it to, which is
 * exactly what separates this route from the reads, which are deliberately reachable by a guest.
 */
/**
 * The control a Zod issue belongs to.
 *
 * The Quick-Init payload is FLAT — four collected fields and two scope hints — so the first path
 * segment IS the control, and there is no nesting for a mapping table to flatten. An issue with no
 * path at all (a whole-object refusal) is reported against `form`, which is the key the modal renders
 * above the fields rather than beside one of them.
 */
function fieldFor(path: ReadonlyArray<PropertyKey>): string {
	return String(path[0] ?? "") || "form";
}

export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to create a project." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateProjectSchema.safeParse(raw);
		if (!parsed.success) {
			// First issue per control wins: a field with three complaints gets the first one, because
			// the form shows one message per input and the rest would never be read.
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = fieldFor(issue.path);
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(
			await ProjectBackendService.create(parsed.data, actor, ctx.state.currency?.displayCurrency),
		);
	},
});
