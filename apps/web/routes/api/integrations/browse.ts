import { define } from "@web/utils/state.ts";
import { DriveBrowseParamsSchema } from "@projective/types/integrations";
import { simFromParams } from "@projective/types/files";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `GET /api/integrations/browse?connectionId=&folderId=&path=&cursor=&limit=` — browse one level of a
 * connected drive.
 *
 * Zod-validates the query through {@link DriveBrowseParamsSchema} and delegates to the fat
 * {@link IntegrationsBackendService.browse}, which answers in the SAME `AssetItem` / `AssetFolder`
 * shapes the `/files` hub already renders — so the picker, grid, table and preview modal are literally
 * the same components for a mounted Drive file and a hub-native upload, and the two cannot drift.
 *
 * `folderId` and `path` are BOTH accepted because the two provider families genuinely address a
 * location differently: `folderId` is the provider's own object id (Drive, Frame.io), `path` a key
 * prefix for providers that have no folder objects at all (S3). Normalising one into the other would
 * either invent ids or lose the prefix.
 *
 * `cursor` is the PROVIDER's opaque paging token, forwarded verbatim and never re-derived — a
 * connector that pages by continuation token cannot be resumed from an id we invented.
 *
 * Authority is the service's and is checked against what the user GRANTED (`grantedKinds`), never
 * against what the vendor can do: someone may hold a `calendar` grant at a provider whose catalogue
 * row also advertises `storage`. Passing the session user is what lets it refuse a connection the
 * caller does not hold.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		const parsed = DriveBrowseParamsSchema.safeParse({
			connectionId: sp.get("connectionId") ?? "",
			folderId: sp.get("folderId"),
			path: sp.get("path"),
			cursor: sp.get("cursor"),
			limit: Number.isFinite(limit) ? limit : undefined,
		});
		if (!parsed.success) {
			return Response.json({ ok: false, message: "That drive query is not valid." }, {
				status: 400,
			});
		}

		const context = asAuthenticatedContext(ctx.state.userContext);
		return toFilesResponse(
			await IntegrationsBackendService.browse(parsed.data, {
				userId: context.userId ?? "",
				sim: simFromParams(sp),
			}),
		);
	},
});
