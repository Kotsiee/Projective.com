import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type { ProjectFeedParams } from "../types/projects-types.ts";

/**
 * Per-context filter continuity — the client-side cache that makes each workspace reload exactly the
 * filters the actor last left it on (the Continuity rule). Because the `StorageKey` union is closed,
 * we can't mint a per-context key literal; instead a single JSON map keyed BY context id is stored
 * under {@link LocalKeys.PROJECTS_FILTERS}, and the partition lives inside the value. SSR-safe: the
 * accessors no-op without a DOM, so this is import-safe on the server and only does real work in the
 * hydrated island.
 */

/** Context id → its last-applied feed params. */
type FilterMap = Record<string, ProjectFeedParams>;

/** The partition key for a context id (empty active context folds to a stable sentinel). */
function partition(contextId: string): string {
	return contextId || "_active";
}

/** Read + parse the whole partition map (empty object on any miss/parse error). */
function readMap(): FilterMap {
	const raw = readStored("local", LocalKeys.PROJECTS_FILTERS);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed as FilterMap : {};
	} catch {
		return {};
	}
}

/** The cached feed params for a context, or `null` when none were stored. */
export function readCachedParams(contextId: string): ProjectFeedParams | null {
	return readMap()[partition(contextId)] ?? null;
}

/** Persist the applied feed params for a context (merged into the partition map). */
export function writeCachedParams(contextId: string, params: ProjectFeedParams): void {
	const map = readMap();
	map[partition(contextId)] = params;
	try {
		writeStored("local", LocalKeys.PROJECTS_FILTERS, JSON.stringify(map));
	} catch {
		// storage full/disabled — the feed simply won't restore filters next time; non-fatal.
	}
}
