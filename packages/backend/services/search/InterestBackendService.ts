import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isExploreBackendLive } from "../../core/supabase.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { loadCatalog } from "../explore/live-catalog.ts";
import { ownHandlesOf } from "../explore/viewer-signals.ts";
import type { ReadActor } from "../read-actor.ts";
import { writeTelemetry } from "../telemetry-writer.ts";
import { catalogLookup, toInterestRows } from "./interest-rows.ts";
import { DiscoveryEventBatchSchema, type DiscoveryIngestResult } from "@projective/types/explore";

/** A tracker flushes on a 10 s heartbeat plus page hides; 30 batches a minute is well above that. */
const batchLimiter = new SlidingWindowLimiter({ max: 30, windowMs: 60_000 });

/**
 * InterestBackendService — the FAT writer behind discovery telemetry.
 *
 * The `ImpressionTracker` island beacons batches of `discovery.*` events, and the `ListingViewBeacon`
 * island a listing page's one `discovery.view`, to the thin `POST /api/explore/events`, which hands
 * them here with the session-derived actor. Each public id is resolved against the cached public
 * catalogue (unknown ids are dropped, never stored; so is a seller's view of their own listing) and
 * the batch is inserted into `search.interest_events` as the caller under RLS, falling back to an
 * anonymous row when the caller's token no longer verifies. The database keeps at most one view per
 * viewer per listing per 30 minutes (`search.trg_interest_events_view`).
 *
 * **Stub mode (default).** With `EXPLORE_BACKEND_LIVE` off the batch is validated and acknowledged
 * without a write, so a development server does not fill the table from every page view.
 */
export class InterestBackendService {
	/**
	 * Validate and persist one beacon batch. Refusals are `422` (malformed), `429` (rate limited) and
	 * `503` (catalogue or database unreachable); the beacon never reads them, they exist for logs.
	 */
	static async record(
		input: unknown,
		actor: ReadActor,
	): Promise<ServiceResult<DiscoveryIngestResult>> {
		const parsed = DiscoveryEventBatchSchema.safeParse(input);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return fail(422, {
				errors: { [first?.path.join(".") || "events"]: first?.message ?? "Invalid event batch." },
			});
		}
		const batch = parsed.data;

		if (!batchLimiter.take(actor.userId || batch.sessionId).allowed) {
			return fail(429, { message: "Too many discovery events." });
		}

		if (!isExploreBackendLive()) {
			return ok({ accepted: batch.events.length, dropped: 0 }, { status: 202 });
		}

		let catalog;
		try {
			catalog = await loadCatalog();
		} catch (error) {
			console.error("[discovery] catalogue unavailable for interest events", error);
			return fail(503, { message: "Discovery events could not be resolved." });
		}

		const { rows, dropped } = toInterestRows(
			catalogLookup(catalog),
			batch,
			ownHandlesOf(actor, catalog),
		);
		if (rows.length === 0) return ok({ accepted: 0, dropped }, { status: 202 });

		try {
			await writeTelemetry(
				actor,
				(db, userId) =>
					db.schema("search").from("interest_events").insert(
						rows.map((row) => ({ ...row, user_id: userId })),
					),
			);
		} catch (error) {
			console.error("[discovery] search.interest_events insert failed", error);
			return fail(503, { message: "Discovery events could not be stored." });
		}

		return ok({ accepted: rows.length, dropped }, { status: 202 });
	}
}
