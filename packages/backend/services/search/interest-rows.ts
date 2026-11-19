import type { DiscoveryEventBatch } from "@projective/types/explore";
import type { Catalog } from "../explore/live-catalog.ts";

/** A `search.interest_events` row, less `user_id` (the writer sets it per identity). */
export interface InterestRow {
	session_id: string;
	event_type: "impression" | "click" | "rail_depth" | "view";
	entity_id: string | null;
	entity_type: string | null;
	query: string | null;
	weight: number;
	context: Record<string, string | number>;
}

/** The database identity behind a card's public id. */
export interface ResolvedEntity {
	entityId: string;
	entityType: string;
	/** The `@handle` the item belongs to, so a seller's view of their own listing can be dropped. */
	ownerHandle?: string;
}

/** The `entity_type`s a page view is stored for: the listings the seller's analytics roll up. */
const VIEWED_ENTITY_TYPES: ReadonlySet<string> = new Set(["service", "product"]);

/** Resolves a card's public id (slug or handle) to the uuid `interest_events.entity_id` stores. */
export type EntityLookup = (itemId: string) => ResolvedEntity | null;

/**
 * How much one event says about interest. An impression is exposure, not intent, so it weighs a
 * tenth of a click; a rail's depth is about the rail, not any entity, and weighs nothing. Opening a
 * listing's own page is intent, as a click is.
 */
export const EVENT_WEIGHT: Record<InterestRow["event_type"], number> = {
	impression: 0.1,
	click: 1,
	rail_depth: 0,
	view: 1,
};

/**
 * A lookup over the public discovery catalogue. The item's type comes from the catalogue, never
 * from the client, and an id the catalogue does not hold resolves to `null` — so a beacon can only
 * ever record interest in something a guest could actually have seen.
 */
export function catalogLookup(catalog: Catalog): EntityLookup {
	return (itemId) => {
		const item = catalog.byId.get(itemId);
		if (!item) return null;
		const ownerHandle = item.owner.handle;
		switch (item.type) {
			case "services": {
				const row = catalog.blueprintBySlug.get(itemId);
				return row ? { entityId: row.id, entityType: "service", ownerHandle } : null;
			}
			case "products": {
				const row = catalog.productBySlug.get(itemId);
				return row ? { entityId: row.id, entityType: "product", ownerHandle } : null;
			}
			case "articles": {
				const row = catalog.articleBySlug.get(itemId);
				return row ? { entityId: row.id, entityType: "article", ownerHandle } : null;
			}
			case "projects": {
				const entry = catalog.projectBySlug.get(itemId);
				return entry ? { entityId: entry.row.id, entityType: "project", ownerHandle } : null;
			}
			default: {
				const row = catalog.profileByHandle.get(itemId.startsWith("@") ? itemId : `@${itemId}`);
				return row ? { entityId: row.entity_id, entityType: row.entity_type, ownerHandle } : null;
			}
		}
	};
}

/**
 * Map a validated beacon batch to insertable rows, dropping items the lookup cannot resolve.
 *
 * A page view is kept only for a service or product listing, and never when its owner is one of
 * `ownHandles` (the viewer's own `@handle`s): the database drops a seller's own view too
 * (`search.trg_interest_events_view`), but only while their token still verifies, and a beacon
 * whose token has lapsed is written anonymously.
 */
export function toInterestRows(
	lookup: EntityLookup,
	batch: DiscoveryEventBatch,
	ownHandles: ReadonlySet<string> = new Set(),
): { rows: InterestRow[]; dropped: number } {
	const rows: InterestRow[] = [];
	let dropped = 0;
	const query = batch.query?.trim() || null;

	for (const event of batch.events) {
		if (event.name === "discovery.rail_depth") {
			rows.push({
				session_id: batch.sessionId,
				event_type: "rail_depth",
				entity_id: null,
				entity_type: null,
				query,
				weight: EVENT_WEIGHT.rail_depth,
				context: {
					surface: batch.surface,
					rail: event.rail,
					depth: Math.round(event.depth * 100) / 100,
					items: event.items,
				},
			});
			continue;
		}

		const entity = lookup(event.itemId);
		if (!entity) {
			dropped++;
			continue;
		}
		if (event.name === "discovery.view") {
			const own = !!entity.ownerHandle && ownHandles.has(entity.ownerHandle);
			if (own || !VIEWED_ENTITY_TYPES.has(entity.entityType)) {
				dropped++;
				continue;
			}
			rows.push({
				session_id: batch.sessionId,
				event_type: "view",
				entity_id: entity.entityId,
				entity_type: entity.entityType,
				query: null,
				weight: EVENT_WEIGHT.view,
				context: { surface: batch.surface },
			});
			continue;
		}
		const eventType = event.name === "discovery.click" ? "click" : "impression";
		const context: Record<string, string | number> = { surface: batch.surface };
		if (event.rail) context.rail = event.rail;
		if (event.position !== undefined) context.position = event.position;
		rows.push({
			session_id: batch.sessionId,
			event_type: eventType,
			entity_id: entity.entityId,
			entity_type: entity.entityType,
			query,
			weight: EVENT_WEIGHT[eventType],
			context,
		});
	}

	return { rows, dropped };
}
