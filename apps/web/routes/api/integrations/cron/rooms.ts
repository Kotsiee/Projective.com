import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";
import { RoomBackendService } from "@server/services/integrations/RoomBackendService.ts";

/**
 * `POST /api/integrations/cron/rooms` — the scheduler's entry point for meeting rooms: mints what the
 * queue is waiting for, then follows moves and cancellations. Registered as the job
 * `integrations-mint-rooms` (providers spec §7.6). `?task=reconcile` reads ended meetings' records
 * instead, as the job `integrations-presence-reconcile`.
 *
 * Authenticated by the same bearer token as the other integrations jobs, compared in constant time;
 * anything else is a 404. The body is ignored.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!IntegrationsBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "25") || 25, 1),
			100,
		);
		if (ctx.url.searchParams.get("task") === "reconcile") {
			return toFilesResponse(await RoomBackendService.reconcileDue(limit));
		}
		const minted = await RoomBackendService.mintDue(limit);
		if (!minted.ok) return toFilesResponse(minted);
		const synced = await RoomBackendService.syncDue(limit);
		if (!synced.ok) return toFilesResponse(synced);
		return Response.json({ ok: true, data: { minted: minted.data, synced: synced.data } });
	},
});
