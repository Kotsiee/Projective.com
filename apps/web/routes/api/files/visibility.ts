import { define } from "@web/utils/state.ts";
import { SetVisibilitySchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/files/visibility` — change the privacy scope of assets and folders in ONE request.
 *
 * Zod-validates the payload ({@link SetVisibilitySchema}, which refuses an empty selection) and
 * delegates to the fat {@link FilesBackendService.setVisibility}.
 *
 * Both collections ride one payload because the control that raises them is one control: a person
 * selecting a mixed set expects one answer, not two requests with a window in which half their
 * selection is public and half is not. Elevation is automatic when an asset is attached somewhere;
 * DE-escalation is only ever this explicit action, so attaching something can never silently narrow
 * access another surface already depends on.
 *
 * **The acting principal comes from the SESSION.** De-escalation is the one action here that narrows
 * access other surfaces already depend on, so who asked for it is not an optional fact.
 *
 * Runs under the caller's own session: RLS is the gate, and the library is the acting context's.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SetVisibilitySchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That privacy change is not valid.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.setVisibility(parsed.data, readActor(ctx)),
		);
	},
});
