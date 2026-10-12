import { readActor, type SessionContext } from "@web/utils/api-session.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * Record, in the background, that the signed-in reader of this request opened a discovery item — the
 * server half of "Because you viewed" (`ExploreBackendService.recordView`, under the reader's own
 * token). Called by the routes a reader lands on when they open something: a listing's page and a
 * profile's front door, however they got there (a card, a search result, a deep link).
 *
 * Fire-and-forget: the page never waits on it, and a guest or a lapsed session records nothing —
 * which is also why a crawler's visit is never a view. `itemId` is the DISCOVERY id (a slug, or a
 * handle without its `@`).
 */
export function recordViewInBackground(ctx: SessionContext, itemId: string): void {
	const actor = readActor(ctx);
	if (!canReadLive(actor)) return;
	ExploreBackendService.recordView({ id: itemId, actor }).catch((error: unknown) =>
		console.error("[explore] recording a view failed", error)
	);
}
