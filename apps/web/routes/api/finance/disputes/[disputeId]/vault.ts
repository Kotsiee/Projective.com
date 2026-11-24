import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `GET /api/finance/disputes/[disputeId]/vault` — a ticket case's Evidence Vault (PROJECTS EX3): its
 * canonical manifest and SHA-256 for a party, the raw snapshot with where its bytes are for an operator;
 * 404 for anyone else (`finance.get_dispute_vault`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.disputeId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.vault(id.data, readActor(ctx)));
	},
});
