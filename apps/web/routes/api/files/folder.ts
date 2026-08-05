import { define } from "@web/utils/state.ts";
import { CreateFolderSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/folder` — create a folder. `parentId: null` creates it at the library root.
 *
 * Zod-validates the payload ({@link CreateFolderSchema}) and delegates to the fat
 * {@link FilesBackendService.createFolder}. An omitted `visibility` INHERITS the parent's, which is
 * the only non-surprising default; the service resolves it, not this route.
 *
 * **The payload's `ownerType`/`ownerId` are a REQUEST, not the answer.** The acting principal is
 * derived from `ctx.state.userContext` and handed to the service, which decides whose library the
 * folder is created in (see `@server/services/files/acting-principal.ts`).
 *
 * **Only POST.** Folder rename and folder delete have no method on the fat service — `rename` takes a
 * {@link RenameAsset} and `remove` takes asset ids — so a `PATCH`/`DELETE` here would be a route with
 * nothing to call. See `./rename.ts` and `./delete.ts` for the asset mutations that do exist.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateFolderSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That folder could not be created.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.createFolder(
				parsed.data,
				actorFromContext(ctx.state.userContext),
			),
		);
	},
});
