import { define } from "@web/utils/state.ts";
import { DownloadEventSchema } from "@projective/types/files";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";

/**
 * `POST /api/files/download-record` — append a download to the ledger.
 *
 * Zod-validates the payload and delegates to the fat {@link FilesBackendService.recordDownload}, which
 * counts a share download against the link's limit BEFORE serving it (or a link with one download left
 * serves two to a pair of concurrent requests).
 *
 * **The actor comes from the SESSION, never from the payload.** A client-supplied `actorId` would let
 * anyone write a download into someone else's ledger — so the request shape has no actor field at all,
 * and the value is taken from the chrome-only {@link UserContext}. An unresolvable one yields `""`,
 * which the service reads as anonymous.
 *
 * **There is no IP address on this event and one must not be added.** An IP is personal data under
 * GDPR and the single highest-value column in any breach of a table an owner can read, and neither job
 * the ledger exists for needs it: an owner wants to know a person took a copy, not where they were
 * standing. Abuse metering is a separate, short-retention concern and belongs at the edge.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */

// #region Payload
/**
 * The request shape, DERIVED from the SSOT's {@link DownloadEventSchema} rather than restated.
 *
 * The event row is the only place these four fields' types and bounds are declared, so picking from it
 * means a widened `via` or a re-bounded `shareSlug` reaches this route automatically and a removed
 * field stops compiling. `actorId`, `actorHandle`, `at` and `dateLabel` are deliberately NOT picked:
 * they are server-derived, and accepting any of them would let a caller author their own ledger line.
 *
 * The SSOT has no dedicated `RecordDownloadSchema`; this pick is the honest expression of the payload
 * `FilesService.recordDownload` already sends, and adding one to `files/downloads.ts` would be the
 * cleaner home for it.
 */
const RecordDownloadSchema = DownloadEventSchema.pick({
	assetId: true,
	via: true,
	shareSlug: true,
	deviceFingerprint: true,
});
// #endregion

export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = RecordDownloadSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That download could not be recorded.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const context = asAuthenticatedContext(ctx.state.userContext);
		return toFilesResponse(
			await FilesBackendService.recordDownload({
				assetId: parsed.data.assetId,
				actorId: context.userId ?? "",
				deviceFingerprint: parsed.data.deviceFingerprint,
				via: parsed.data.via,
				shareSlug: parsed.data.shareSlug,
			}),
		);
	},
});
