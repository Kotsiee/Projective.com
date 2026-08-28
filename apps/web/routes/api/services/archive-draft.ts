import { define } from "@web/utils/state.ts";
import { ArchiveDraftInputSchema } from "@projective/types/services";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `POST /api/services/archive-draft` — soft-archive an instantiated pipeline draft.
 *
 * Thin: parse, resolve the actor, delegate. The fat service scopes the lookup to the actor's own
 * drafts and refuses one that has funded work in it — an archived project whose stage holds escrowed
 * money is a project whose money has nowhere to go, and the recovery path for that is a support
 * ticket rather than a button.
 *
 * **There is no DELETE verb here and there will not be one.** Nothing on this platform is
 * hard-deleted (root CLAUDE.md §7): archiving sets a status, the row stays, and its audit trail stays
 * with it. That is also why this is a `POST` to a named action rather than a `DELETE` on a resource —
 * the HTTP verb would describe something that does not happen.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ArchiveDraftInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);

		const actor = bookingActorFrom(ctx.state);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to manage your drafts." }, { status: 401 });
		}
		return toBookingResponse(
			ProjectBackendService.archiveDraft(parsed.data, { userId: actor.userId }),
		);
	},
});
