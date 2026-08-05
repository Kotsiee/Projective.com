import { define } from "@web/utils/state.ts";
import { z } from "zod";
import { AssetOwnerType } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/integrations/import` — mount a connected drive object into the `/files` hub.
 *
 * The endpoint the drive picker's "Add" press lands on, and the last unreachable method in the
 * connector subsystem: {@link IntegrationsBackendService.importAsset} existed with no route to call it,
 * so browsing a Drive was possible and doing anything with what you found was not.
 *
 * **This copies no bytes.** The hub stores a REFERENCE — the row carries `source !== "supabase"`, its
 * `external` back-reference, and a size counted against the PROVIDER's quota, never ours. Copying
 * would double every large file, charge the user for storage they already pay someone else for, and
 * fork the two copies the first time either side is edited.
 *
 * **Two authorities have to agree and the service checks both**: the CONNECTION must belong to the
 * caller and carry a `storage` grant, and the destination LIBRARY must be one the session evidences.
 * The payload's `ownerType`/`ownerId` are therefore a REQUEST to file the object somewhere, never the
 * answer — checking only the connection is how a read permission at a third party quietly becomes a
 * write permission into someone else's hub.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */

// #region Payload
/**
 * The request shape.
 *
 * `@projective/types/integrations` has no `ImportAssetSchema`, so this is composed here from the files
 * SSOT's own {@link AssetOwnerType} plus the two provider-side identifiers. **A dedicated schema in
 * `integrations/connections.ts` is the cleaner home** and should absorb this the next time that module
 * is touched — the same note `../files/download-record.ts` carries about its own derived pick.
 *
 * `externalFileId` is the PROVIDER's id and is deliberately loose: a Drive file id, a Dropbox path and
 * an S3 key are three different alphabets, and a pattern tight enough for one of them silently refuses
 * the others.
 */
const ImportAssetSchema = z.object({
	connectionId: z.string().min(1).max(120),
	externalFileId: z.string().min(1).max(1024),
	/** `null` files it at the library root, which is a real destination and not "unset". */
	folderId: z.string().max(120).nullable(),
	ownerType: AssetOwnerType,
	ownerId: z.string().min(1).max(80),
});
// #endregion

export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ImportAssetSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That file could not be added.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		return toFilesResponse(
			await IntegrationsBackendService.importAsset(
				parsed.data,
				actorFromContext(ctx.state.userContext),
			),
		);
	},
});
