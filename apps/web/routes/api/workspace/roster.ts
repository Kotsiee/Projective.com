import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { WorkspaceKind, type WorkspaceRoster } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceBody,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/workspace/roster?kind=team|business` — thin route: resolve the acting reader,
 * refuse a guest, validate the entity kind, then delegate to the fat
 * {@link WorkspaceBackendService.roster} for every entity of that kind the viewer belongs to plus the
 * invitations awaiting them.
 *
 * The body is the roster ITSELF, unwrapped, exactly as the fat method returns it, so the client's
 * `WorkspaceService.roster` shape cannot drift from the service's. The three verbs come from
 * {@link defineReadRoute}, so a repeat read after nothing changed revalidates to a `304`.
 *
 * The kind is parsed as an OBJECT so an issue carries a `kind` path the client can act on.
 */
const QuerySchema = z.object({ kind: WorkspaceKind });

export const handler = define.handlers(
	defineReadRoute<WorkspaceRoster>({
		resolve: (ctx) => {
			const actor = readActor(ctx);
			if (!canReadLive(actor)) return guestRefusal();
			const parsed = QuerySchema.safeParse({ kind: ctx.url.searchParams.get("kind") });
			if (!parsed.success) return invalidPayload(parsed.error, "Unknown entity kind.");
			return WorkspaceBackendService.roster(parsed.data.kind, actor);
		},
		toBody: toWorkspaceBody,
	}),
);
