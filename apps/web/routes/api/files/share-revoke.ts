import { define } from "@web/utils/state.ts";
import { RevokeShareSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/share-revoke` — revoke a share link. Terminal: re-sharing mints a NEW slug, so a
 * leaked URL stays dead.
 *
 * Zod-validates the payload ({@link RevokeShareSchema}) and delegates to the fat
 * {@link FilesBackendService.revokeShare}.
 *
 * An unknown slug and an already-revoked one both answer `{ revoked: false }` with a **200**, and this
 * route echoes that verbatim: a 404 for one and a 200 for the other would let the response be used to
 * probe whether a slug the caller does not hold exists.
 *
 * **The acting principal comes from the SESSION**, and an unauthorised revoke must answer exactly like
 * an unknown slug: a 403 here would confirm the slug is real, which is the bit the 200 above exists to
 * withhold.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = RevokeShareSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That share link could not be revoked.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.revokeShare(parsed.data, actorFromContext(ctx.state.userContext)),
		);
	},
});
