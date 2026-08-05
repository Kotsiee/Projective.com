import { define } from "@web/utils/state.ts";
import { UploadInitSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { UploadTicket } from "@projective/types/files";

/**
 * `POST /api/files/upload-init` — step 1 of the upload handshake.
 *
 * Zod-validates the declaration ({@link UploadInitSchema}) and delegates to the fat
 * {@link FilesBackendService.uploadInit}, which meters the allowance, mints the `pending_upload` row
 * and answers with a scoped, short-lived signed-URL ticket plus the duplicate verdict.
 *
 * **The payload's `ownerType`/`ownerId` are a REQUEST, not the answer.** The acting principal comes
 * from `ctx.state.userContext`, and the service resolves which library the file actually lands in —
 * because that owner also becomes the ticket's first path segment, which is the RLS anchor the storage
 * policies check via `(storage.foldername(name))[1]`. A client-chosen anchor is a client-chosen
 * storage policy, and this is the one route where trusting the payload would hand out a signed URL
 * over someone else's prefix.
 *
 * **Step 2 is not a route and must never become one.** The browser PUTs the bytes straight at the
 * ticket's `signedUrl` with the headers it returned; streaming a 500 MB body through a Deno handler
 * would occupy a request worker for minutes and buy nothing.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */

// #region Quota-denial telemetry
/**
 * Whether this refusal was the storage cap rather than a malformed request.
 *
 * Quota enforcement is FAIL-OPEN and param-gated (`security.platform_params.storage_quota_enforced`,
 * `DEFAULT false`), so the fat service METERS every upload and refuses none until a human flips the
 * param — which is why this branch is currently unreachable and is written for the day it is not. The
 * refusal is a 422 carrying the service's own `quota` field error, the one signal that separates
 * "over your allowance" from "that payload is malformed".
 */
function isQuotaDenial(result: ServiceResult<UploadTicket>): boolean {
	return !result.ok && result.status === 422 && result.errors?.quota !== undefined;
}
// #endregion

export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UploadInitSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That upload could not be started.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const result = await FilesBackendService.uploadInit(
			parsed.data,
			actorFromContext(ctx.state.userContext),
		);

		if (isQuotaDenial(result)) {
			// LIVE: emit the `entitlement.denied` analytics event HERE — from the app layer, after the
			// refusal has surfaced — never from the service and never from the database. The live refusal
			// is a `RAISE` inside Postgres and there are no autonomous transactions, so the raise rolls
			// back the `entitlement.denied` row written moments earlier: the denial telemetry would go
			// dark exactly when enforcement starts mattering (Decision #58, flagged item (j)). There is no
			// `AnalyticsBackendService` yet — the event key and payload shape are the SSOT's
			// `@projective/types/analytics` `EmitEventSchema` / `analytics.fn_emit`.
			void parsed.data.ownerId;
		}

		return toFilesResponse(result);
	},
});
