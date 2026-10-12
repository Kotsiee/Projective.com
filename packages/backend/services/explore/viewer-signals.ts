import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { type Catalog, entityKey } from "./live-catalog.ts";
import { decayedAffinity, normaliseTopic, topicsOf, type ViewerSignals } from "./personalise.ts";
import type {
	DiscoveryViewerSim,
	RecentViewRow,
	UserAffinityRow,
	UserBookmarkRow,
} from "@projective/types/explore";

/**
 * viewer-signals — the Home feed's VIEWER-SCOPED pass: one signed-in person's views, saves, topic
 * affinity and stated interests, read under THEIR access token so RLS answers (each table is
 * read-own) and resolved against the loaded catalogue.
 *
 * The shared catalogue is read as `anon` and cached for every visitor; nothing here may reach it.
 * These reads are per request and never cached: a view recorded a moment ago must move "Because you
 * viewed" on the very next load, and one person's answer is nobody else's.
 */

// #region Reads
/** How many of a person's latest views, saves and topics the rails consider. */
export const SIGNAL_LIMIT = 24;

/** Throw a read failure with the table named, as the catalogue loader does. */
function fail(table: string, message: string): never {
	throw new Error(`explore viewer signals: reading ${table} failed — ${message}`);
}

/** Resolve signal rows to live catalogue items, keeping the rows' order and dropping the rest. */
function resolve(
	catalog: Catalog,
	rows: ReadonlyArray<{ entity_type: string; entity_id: string }>,
): string[] {
	const out: string[] = [];
	for (const row of rows) {
		const itemId = catalog.itemIdByEntity.get(entityKey(row.entity_type, row.entity_id));
		if (itemId && !out.includes(itemId)) out.push(itemId);
	}
	return out;
}

/**
 * The `@handle`s whose items are the viewer's own — the person's, and the team or business they are
 * acting as — so a rail never recommends their own work back to them.
 */
export function ownHandlesOf(actor: ReadActor, catalog: Catalog): Set<string> {
	const own = new Set<string>();
	for (const id of [actor.userId, actor.contextId]) {
		const row = id ? catalog.profileById.get(id) : undefined;
		if (row) own.add(`@${row.handle}`);
	}
	return own;
}

/**
 * Read one viewer's signals under their own token. `sim` (development only, already gated by the
 * caller) drops the history (`no_history`) or every signal (`no_signals`) to show the cold-start
 * fallbacks — by not reading, never by reading and discarding.
 */
export async function readViewerSignals(
	actor: ReadActor & { accessToken: string },
	catalog: Catalog,
	sim: DiscoveryViewerSim,
	now: number,
): Promise<ViewerSignals> {
	const db = getUserClient(actor.accessToken);
	const withHistory = sim === "auto";
	const withInterests = sim !== "no_signals";

	const [viewsRes, savesRes, affinityRes, personRes] = await Promise.all([
		withHistory
			? db.schema("org").from("recent_views").select("entity_type, entity_id, viewed_at")
				.eq("user_id", actor.userId).order("viewed_at", { ascending: false }).limit(SIGNAL_LIMIT)
			: null,
		withHistory
			? db.schema("org").from("user_bookmarks").select("entity_type, entity_id, created_at")
				.eq("user_id", actor.userId).order("created_at", { ascending: false, nullsFirst: false })
				.limit(SIGNAL_LIMIT)
			: null,
		withHistory
			? db.schema("search").from("user_affinity").select(
				"category_slug, affinity_score, updated_at",
			)
				.eq("user_id", actor.userId).order("affinity_score", { ascending: false })
				.limit(SIGNAL_LIMIT)
			: null,
		withInterests
			? db.schema("org").from("users_public").select("interests").eq("user_id", actor.userId)
				.maybeSingle()
			: null,
	]);
	if (viewsRes?.error) fail("org.recent_views", viewsRes.error.message);
	if (savesRes?.error) fail("org.user_bookmarks", savesRes.error.message);
	if (affinityRes?.error) fail("search.user_affinity", affinityRes.error.message);
	if (personRes?.error) fail("org.users_public", personRes.error.message);

	const views = (viewsRes?.data ?? []) as Array<Pick<RecentViewRow, "entity_type" | "entity_id">>;
	const saves = (savesRes?.data ?? []) as Array<Pick<UserBookmarkRow, "entity_type" | "entity_id">>;
	const affinityRows = (affinityRes?.data ?? []) as Array<
		Pick<UserAffinityRow, "category_slug" | "affinity_score" | "updated_at">
	>;

	const affinity = new Map<string, number>();
	for (const row of affinityRows) {
		const topic = normaliseTopic(row.category_slug);
		const weight = decayedAffinity(Number(row.affinity_score) || 0, row.updated_at, now);
		if (topic && weight > 0) affinity.set(topic, (affinity.get(topic) ?? 0) + weight);
	}

	const interests = new Set<string>();
	if (withInterests) {
		const stated = (personRes?.data as { interests: string[] | null } | null)?.interests ?? [];
		for (const raw of stated) interests.add(normaliseTopic(raw));
		// A seller's own skills are demonstrated interests too: their listed profile carries the
		// labels, an unlisted one only the slugs.
		const self = catalog.profileById.get(actor.userId);
		const listed = self ? catalog.byId.get(self.handle) : undefined;
		for (const topic of listed ? topicsOf(listed) : (self?.skills ?? []).map(normaliseTopic)) {
			interests.add(topic);
		}
		interests.delete("");
	}

	return {
		viewed: resolve(catalog, views),
		saved: resolve(catalog, saves),
		affinity,
		interests: [...interests],
		own: ownHandlesOf(actor, catalog),
		seller: actor.contextType === "team" ||
			catalog.profileById.get(actor.userId)?.entity_type === "freelancer",
	};
}
// #endregion
