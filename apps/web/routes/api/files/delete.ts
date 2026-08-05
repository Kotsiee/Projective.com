import { define } from "@web/utils/state.ts";
import { DeleteAssetsSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/delete` — delete assets.
 *
 * Zod-validates the payload ({@link DeleteAssetsSchema}) and delegates to the fat
 * {@link FilesBackendService.remove}. **Nothing is hard-deleted** (root CLAUDE.md §5): the live path
 * stamps `files.items.deleted_at`, so the deletion is recoverable and a share link pointing at the
 * asset stops resolving rather than 500ing.
 *
 * `POST` rather than `DELETE` because the payload is a bounded BATCH of ids, and a request body on a
 * `DELETE` is permitted by the spec but discarded by enough proxies and clients to be a bad bet — the
 * whole codebase mutates over POST for the same reason.
 *
 * **The acting principal comes from the SESSION**, so the soft-delete can be bounded to rows the caller
 * owns rather than to whichever ids a payload happens to name.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = DeleteAssetsSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those files could not be deleted.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.remove(parsed.data, actorFromContext(ctx.state.userContext)),
		);
	},
});
