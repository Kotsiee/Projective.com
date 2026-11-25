import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, mocksForcedResult } from "../../core/supabase.ts";
import { removeObjects } from "../../core/storage-signed.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { serverEnv } from "../../core/env.ts";

/**
 * purge — the nightly purge of soft-deleted bytes (PROJECTS FL1 step 3, Decision #564, owner ruling).
 *
 * `files.claim_purge` stamps `purged_at` on up to `limit` files deleted more than 30 days ago that
 * nothing must keep (a submission, a dispute, an order version or line, an invoice, a statement, a
 * sent /contact request), and answers each one's stored objects: the original and its WebP tiers.
 * They are deleted here through the Storage API, because storage objects cannot be deleted from SQL.
 * A file whose objects Storage refused is handed back (`files.release_purge`) for the next run. The
 * row is never deleted.
 */

// #region Types
/** One object `files.claim_purge` answers. */
export interface PurgeObject {
	item_id: string;
	bucket_id: string;
	storage_path: string;
}

/** What one run did: files whose bytes are gone, and files handed back for the next run. */
export interface FilePurgeRun {
	purged: number;
	failed: number;
}

/** The run's seams: the two doors and the Storage delete; the live service by default. */
export interface PurgeDeps {
	claim: (
		limit: number,
	) => Promise<{ data: PurgeObject[] | null; error: { message: string } | null }>;
	remove: (bucket: string, paths: readonly string[]) => Promise<boolean>;
	release: (itemIds: string[]) => Promise<{ error: { message: string } | null }>;
}
// #endregion

// #region Limits
/** Files claimed per run by default, and at most. */
export const DEFAULT_PURGE_LIMIT = 100;
export const MAX_PURGE_LIMIT = 1000;
// #endregion

// #region Run
const LIVE: PurgeDeps = {
	claim: async (limit) => {
		const { data, error } = await getServiceClient().schema("files").rpc("claim_purge", {
			p_limit: limit,
		});
		return { data: data as PurgeObject[] | null, error };
	},
	remove: removeObjects,
	release: async (itemIds) => {
		const { error } = await getServiceClient().schema("files").rpc("release_purge", {
			p_item_ids: itemIds,
		});
		return { error };
	},
};

/** One purge run over at most `limit` files (clamped to 1–1000). */
export async function purgeDeletedFiles(
	limit: number,
	deps: PurgeDeps = LIVE,
): Promise<ServiceResult<FilePurgeRun>> {
	const batch = Math.min(Math.max(Math.trunc(limit) || DEFAULT_PURGE_LIMIT, 1), MAX_PURGE_LIMIT);
	try {
		const { data, error } = await deps.claim(batch);
		if (error) {
			console.error("[files:purge]", error.message);
			return fail(503, { message: "The purge could not run." });
		}

		const byBucket = new Map<string, { paths: string[]; items: Set<string> }>();
		for (const o of data ?? []) {
			const group = byBucket.get(o.bucket_id) ?? { paths: [], items: new Set<string>() };
			group.paths.push(o.storage_path);
			group.items.add(o.item_id);
			byBucket.set(o.bucket_id, group);
		}

		const claimed = new Set((data ?? []).map((o) => o.item_id));
		const failed = new Set<string>();
		for (const [bucket, group] of byBucket) {
			if (await deps.remove(bucket, group.paths)) continue;
			console.error("[files:purge] Storage refused a removal", bucket, group.paths.length);
			for (const id of group.items) failed.add(id);
		}

		if (failed.size > 0) {
			const released = await deps.release([...failed]);
			// A stamp that stays on a file whose bytes remain is a leak, never a loss: logged, not retried here.
			if (released.error) console.error("[files:purge] release", released.error.message);
		}
		return ok({ purged: claimed.size - failed.size, failed: failed.size });
	} catch (error) {
		const mocked = mocksForcedResult(error);
		if (mocked) return mocked;
		throw error;
	}
}

/** Whether a request carries the scheduler's bearer for this job (`OPS_CRON_SECRET`). */
export function isPurgeCronAuthorised(authorization: string | null): boolean {
	return isBearerAuthorised(authorization, serverEnv().opsCronSecret);
}
// #endregion
