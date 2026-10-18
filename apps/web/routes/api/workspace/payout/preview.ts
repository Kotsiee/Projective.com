import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { PayoutPreviewQuerySchema, type TeamSplitPreview } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceBody,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/workspace/payout/preview?workspaceId=…&amountMinor=…&currency=…` — thin
 * route: resolve the acting reader, refuse a guest, Zod-validate the query, then delegate to the fat
 * {@link WorkspaceBackendService.previewPayout}, which prices a release of that size under the team's
 * SAVED split through `finance.preview_team_split` (the plan the release runs). Read-only.
 *
 * The amount is integer minor units of `currency` (1 … 10^12); the database refuses anything outside
 * that range and a caller who is not a member of the team, with the message the Preview renders.
 */
export const handler = define.handlers(
	defineReadRoute<TeamSplitPreview>({
		resolve: (ctx) => {
			const actor = readActor(ctx);
			if (!canReadLive(actor)) return guestRefusal();
			const params = ctx.url.searchParams;
			const parsed = PayoutPreviewQuerySchema.safeParse({
				workspaceId: params.get("workspaceId") ?? "",
				amountMinor: params.get("amountMinor") ?? "",
				currency: (params.get("currency") ?? "").toUpperCase(),
			});
			if (!parsed.success) return invalidPayload(parsed.error, "Choose an amount to preview.");
			return WorkspaceBackendService.previewPayout(parsed.data, actor);
		},
		toBody: toWorkspaceBody,
	}),
);
