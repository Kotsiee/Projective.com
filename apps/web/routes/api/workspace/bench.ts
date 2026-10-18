import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import type { BusinessBench } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceBody,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/workspace/bench?ref=…` — thin route: resolve the acting reader, refuse a
 * guest, validate the business reference, then delegate to the fat {@link WorkspaceBackendService.bench}
 * for the business's bench (the Talent module, Decision #230 (i)).
 *
 * `ref` is the business's handle (its console address) or its row id — the server resolves either. The
 * Talent page reads the bench server-side for its first paint; this route is the screen's retry.
 *
 * `404` for a reference no business holds, `403` for a caller who is not a member holding `hire` — the
 * same capability the console's Talent gate asks.
 */
const QuerySchema = z.object({
	ref: z.string().trim().min(1, "Which business?").max(64),
});

export const handler = define.handlers(
	defineReadRoute<BusinessBench>({
		resolve: (ctx) => {
			const actor = readActor(ctx);
			if (!canReadLive(actor)) return guestRefusal();
			const parsed = QuerySchema.safeParse({ ref: ctx.url.searchParams.get("ref") });
			if (!parsed.success) return invalidPayload(parsed.error, "Invalid business reference.");
			return WorkspaceBackendService.bench(parsed.data.ref, actor);
		},
		toBody: toWorkspaceBody,
	}),
);
