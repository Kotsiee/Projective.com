import {
	embeddingHashOf,
	embeddingTextOf,
	estimateEmbeddingTokens,
} from "../../core/embedding-text.ts";
import { isEmbeddingsLive } from "../../core/supabase.ts";
import {
	type Catalog,
	type CatalogEntity,
	entityKey,
	invalidateCatalog,
	loadCatalog,
} from "../explore/live-catalog.ts";
import { EmbeddingBackendService } from "./EmbeddingBackendService.ts";
import {
	isEmbeddingCurrent,
	readEmbeddingStates,
	type StoredEmbedding,
	writeEmbedding,
} from "./embedding-index.ts";

/**
 * embedding-sync — keeping the stored vectors in step with what discovery shows (Decision #179).
 *
 * The backfill (`scripts/embeddings-backfill.ts`) and the post-commit re-embed share one path: build
 * each PUBLIC item's text and hash from the catalogue, skip every item whose stored hash and model
 * still match, embed the rest in chunks and store them through `search.fn_set_embedding`. A draft or a
 * paused listing is not in the catalogue, so it is never embedded; its index row is hidden by the
 * index's own visibility flag.
 */

// #region Targets
/** One public item to embed: its entity, the text it is embedded from, that text's hash. */
export interface EmbeddingTarget {
	itemId: string;
	entity: CatalogEntity;
	text: string;
	hash: string;
	/** An estimate, for the dry run; Voyage's `usage` is the bill. */
	tokens: number;
}

/** A target for every public item in `catalog` — or only for `itemIds` that resolve to one. */
export async function embeddingTargets(
	catalog: Catalog,
	itemIds?: readonly string[],
): Promise<EmbeddingTarget[]> {
	const items = itemIds
		? itemIds.flatMap((id) => {
			const item = catalog.byId.get(id);
			return item ? [item] : [];
		})
		: catalog.items;
	const targets: EmbeddingTarget[] = [];
	for (const item of items) {
		const entity = catalog.entityById.get(item.id);
		if (!entity) continue;
		const text = embeddingTextOf(item);
		targets.push({
			itemId: item.id,
			entity,
			text,
			hash: await embeddingHashOf(text),
			tokens: estimateEmbeddingTokens(text),
		});
	}
	return targets;
}

/** The targets whose stored vector is missing, stale or from another model (all of them with `force`). */
export function staleTargets(
	targets: readonly EmbeddingTarget[],
	states: ReadonlyMap<string, StoredEmbedding>,
	force = false,
): EmbeddingTarget[] {
	return force
		? [...targets]
		: targets.filter((t) =>
			!isEmbeddingCurrent(states.get(entityKey(t.entity.kind, t.entity.id)), t.hash)
		);
}
// #endregion

// #region Sync
/** What one sync did. */
export interface EmbeddingSyncReport {
	considered: number;
	skipped: number;
	embedded: number;
	/** Embedded, but the entity had no index row to hold the vector. */
	missing: number;
	/** Left unembedded because a chunk failed; a re-run picks them up. */
	failed: number;
	/** Tokens Voyage billed for this sync. */
	tokens: number;
	/** The first failure, when there was one. */
	error?: string;
	/** Whether that failure is worth waiting out — a rate limit, an outage, a timeout, the network. */
	retryable?: boolean;
}

const RETRYABLE_REASONS = new Set(["rate_limited", "upstream", "timeout", "network"]);

/**
 * Embed and store every stale target, `chunkSize` at a time, stopping at the first chunk Voyage or the
 * database refuses — what is stored stays stored, and a re-run skips it by its hash.
 */
export async function syncEmbeddings(
	targets: readonly EmbeddingTarget[],
	options: {
		force?: boolean;
		chunkSize?: number;
		onChunk?: (report: EmbeddingSyncReport) => void;
	} = {},
): Promise<EmbeddingSyncReport> {
	const report: EmbeddingSyncReport = {
		considered: targets.length,
		skipped: 0,
		embedded: 0,
		missing: 0,
		failed: 0,
		tokens: 0,
	};
	if (targets.length === 0) return report;
	const states = await readEmbeddingStates(options.force ? [] : targets.map((t) => t.entity));
	const stale = staleTargets(targets, states, options.force);
	report.skipped = targets.length - stale.length;
	const chunkSize = Math.max(1, options.chunkSize ?? 64);
	const tokensBefore = EmbeddingBackendService.tokensUsed();
	for (let i = 0; i < stale.length; i += chunkSize) {
		const chunk = stale.slice(i, i + chunkSize);
		const res = await EmbeddingBackendService.embedDocuments(chunk.map((t) => t.text));
		if (!res.ok || !res.data) {
			report.failed = stale.length - i;
			report.error = res.message ?? "voyage-4 refused the batch";
			report.retryable = RETRYABLE_REASONS.has(String(res.details?.reason));
			break;
		}
		let written = 0;
		try {
			for (const [n, target] of chunk.entries()) {
				if (await writeEmbedding(target.entity, res.data[n], target.hash)) report.embedded++;
				else report.missing++;
				written++;
			}
		} catch (error) {
			report.failed = stale.length - i - written;
			report.error = error instanceof Error ? error.message : String(error);
			break;
		}
		report.tokens = EmbeddingBackendService.tokensUsed() - tokensBefore;
		options.onChunk?.({ ...report });
	}
	report.tokens = EmbeddingBackendService.tokensUsed() - tokensBefore;
	return report;
}
// #endregion

// #region After a write
/**
 * Re-embed the catalogue items `itemIds` (slugs or handles) after a committed write — fire-and-forget.
 *
 * A no-op unless `EMBEDDINGS_ENABLED` holds (no request, so no development override). The catalogue
 * is reloaded first, so the text is the one just written; an item that is not public is skipped. A
 * failure is logged once and never reaches the write: the vector stays as it was, and the backfill
 * catches it up by its hash.
 */
export function reembedInBackground(itemIds: readonly string[], reason: string): void {
	if (itemIds.length === 0 || !isEmbeddingsLive()) return;
	reembed(itemIds).then((report) => {
		if (report.error) {
			console.warn(`[embeddings] re-embed after ${reason} incomplete — ${report.error}`);
		}
	}).catch((error) => {
		console.warn(
			`[embeddings] re-embed after ${reason} failed — ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	});
}

async function reembed(itemIds: readonly string[]): Promise<EmbeddingSyncReport> {
	invalidateCatalog();
	const targets = await embeddingTargets(await loadCatalog(), itemIds);
	return syncEmbeddings(targets);
}
// #endregion
