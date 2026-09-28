import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { type WorkspaceDetail, WorkspaceKind } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceBody,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/workspace/detail?kind=team|business&ref=…` — thin route: resolve the acting
 * reader, refuse a guest, validate the kind + reference, then delegate to the fat
 * {@link WorkspaceBackendService.detail} for the entity's full console projection.
 *
 * `ref` is the entity's handle (its console address) or its row id — the server resolves either.
 *
 * Refusals come straight from the service and are deliberately distinct: `404` for an entity that does
 * not exist, `403` for one the viewer is not a member of. Collapsing them would either leak the
 * existence of private entities or tell a member their own workspace is gone.
 */
const QuerySchema = z.object({
	kind: WorkspaceKind,
	ref: z.string().trim().min(1, "Which workspace?").max(64),
});

export const handler = define.handlers(
	defineReadRoute<WorkspaceDetail>({
		resolve: (ctx) => {
			const actor = readActor(ctx);
			if (!canReadLive(actor)) return guestRefusal();
			const sp = ctx.url.searchParams;
			const parsed = QuerySchema.safeParse({ kind: sp.get("kind"), ref: sp.get("ref") });
			if (!parsed.success) return invalidPayload(parsed.error, "Invalid workspace reference.");
			return WorkspaceBackendService.detail(parsed.data.kind, parsed.data.ref, actor);
		},
		toBody: toWorkspaceBody,
	}),
);
