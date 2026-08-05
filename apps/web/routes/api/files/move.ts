import { define } from "@web/utils/state.ts";
import { MoveAssetsSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/move` — move assets into a folder. `targetFolderId: null` moves them to the library
 * root, which is a real destination and not "unset".
 *
 * Zod-validates the payload ({@link MoveAssetsSchema}, bounded so a malformed client cannot ask for the
 * world) and delegates to the fat {@link FilesBackendService.move}, which reports the count that
 * ACTUALLY moved rather than failing the batch — a mixed selection containing one read-only mounted
 * file should move the rest, and an all-or-nothing refusal would make the viewer hunt for which row
 * blocked it.
 *
 * **The acting principal comes from the SESSION**, so the destination can be bounded to a library the
 * caller actually holds. A move that trusted ids alone could relocate rows into somebody else's filing
 * system, and the owner of those rows would have no event to notice.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = MoveAssetsSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those files could not be moved.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.move(parsed.data, actorFromContext(ctx.state.userContext)),
		);
	},
});
