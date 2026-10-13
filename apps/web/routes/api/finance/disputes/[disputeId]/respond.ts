import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DisputeRespondInputSchema } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/finance/disputes/[disputeId]/respond` `{ statement, fileIds? }` — a party files a statement
 * with up to ten of their own uploaded files as evidence (`finance.respond_to_dispute`). The
 * respondent's statement on an `awaiting_response` case sends it to an auditor.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.disputeId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		const parsed = DisputeRespondInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await DisputeBackendService.respond(id, parsed.data, readActor(ctx)));
	},
});
