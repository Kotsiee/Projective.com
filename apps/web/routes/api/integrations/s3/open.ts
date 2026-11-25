import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/s3/open` — open the caller's S3 connection `pending`, or answer the one
 * already open, with the ExternalId and the platform account an AWS role's trust policy must name
 * (Decision #314). The S3 credential form's first door; `./save.ts` is its second.
 *
 * No server-side capability guard (Decision #53(b)) — see `../../files/list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		return toFilesResponse(await IntegrationsBackendService.startS3Connection(readActor(ctx)));
	},
});
