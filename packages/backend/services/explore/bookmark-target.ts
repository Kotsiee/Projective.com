import { BookmarkEntityKind, isSaveableEntity } from "@projective/types/explore";

/** The `org.user_bookmarks` row a discovery item is saved as. */
export interface BookmarkTarget {
	kind: BookmarkEntityKind;
	id: string;
}

/** The slice of the public catalogue a bookmark resolves against (`Catalog` satisfies it). */
export interface BookmarkCatalog {
	byId: ReadonlyMap<string, { type: string }>;
	blueprintBySlug: ReadonlyMap<string, { id: string }>;
	projectBySlug: ReadonlyMap<string, { row: { id: string } }>;
	profileByHandle: ReadonlyMap<string, { entity_id: string; entity_type: string }>;
}

/**
 * Resolve a discovery item to the bookmark row it is saved as, or `null` when the catalogue does not
 * hold it or `org.bookmark_entity_type` cannot name it (a product, an article, a buyer's profile).
 * The type comes from the catalogue, never from the client.
 */
export function bookmarkTarget(catalog: BookmarkCatalog, itemId: string): BookmarkTarget | null {
	const item = catalog.byId.get(itemId);
	if (!item || !isSaveableEntity(item.type)) return null;
	switch (item.type) {
		case "services": {
			const row = catalog.blueprintBySlug.get(itemId);
			return row ? { kind: "service_blueprint", id: row.id } : null;
		}
		case "projects": {
			const entry = catalog.projectBySlug.get(itemId);
			return entry ? { kind: "project", id: entry.row.id } : null;
		}
		default: {
			const row = catalog.profileByHandle.get(`@${itemId}`);
			const kind = BookmarkEntityKind.safeParse(row?.entity_type);
			return row && kind.success ? { kind: kind.data, id: row.entity_id } : null;
		}
	}
}

/** Discovery id per bookmark row, for every saveable item the catalogue publishes. */
export function itemIdsByTarget(catalog: BookmarkCatalog): Map<string, string> {
	const out = new Map<string, string>();
	for (const itemId of catalog.byId.keys()) {
		const target = bookmarkTarget(catalog, itemId);
		if (target) out.set(targetKey(target.kind, target.id), itemId);
	}
	return out;
}

/** The lookup key {@link itemIdsByTarget} is keyed by. */
export function targetKey(kind: string, id: string): string {
	return `${kind}:${id}`;
}
