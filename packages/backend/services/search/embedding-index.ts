import { z } from "zod";
import { getAnonClient, getServiceClient } from "../../core/supabase.ts";
import {
	DiscoveryEntityKind,
	EMBEDDING_MODEL,
	EmbeddingStateSchema,
	type NearestEntityRow,
	NearestEntityRowSchema,
	type SetEmbeddingArgs,
	SetEmbeddingArgsSchema,
} from "@projective/types/explore";
import { type CatalogEntity, entityKey } from "../explore/live-catalog.ts";

/**
 * embedding-index — the database side of discovery's vectors (Decision #179).
 *
 * Two trust levels, on purpose. The WRITE side — the stored embedding state and
 * `search.fn_set_embedding` — runs with the service role, because the embedding columns are readable
 * and writable by nobody else (00002520 / 00002510); only the backfill script and the post-commit
 * re-embed reach it. The READ side — `search.fn_nearest` and `search.fn_nearest_to_entity` — runs as
 * `anon`, like the rest of the shared catalogue: both are definers over public index rows that answer
 * ids and scores, never a vector.
 */

// #region Stored state
/** What an index row says about its vector. `embedded` is true exactly when a vector is stored. */
export interface StoredEmbedding {
	model: string | null;
	hash: string | null;
	embedded: boolean;
}

interface IndexTable {
	table: string;
	idColumn: string;
	kinds: readonly DiscoveryEntityKind[];
	typed: boolean;
}

const INDEX_TABLES: readonly IndexTable[] = [
	{ table: "services_index", idColumn: "service_id", kinds: ["service_blueprint"], typed: false },
	{ table: "projects_index", idColumn: "project_id", kinds: ["project"], typed: false },
	{
		table: "profiles_index",
		idColumn: "entity_id",
		kinds: ["user", "freelancer", "team", "business"],
		typed: true,
	},
	{ table: "catalogue_index", idColumn: "entity_id", kinds: ["product", "article"], typed: true },
];

const RawStateRowSchema = EmbeddingStateSchema.extend({
	service_id: z.string().optional(),
	project_id: z.string().optional(),
	entity_id: z.string().optional(),
	entity_type: z.string().optional(),
});
type RawStateRow = z.infer<typeof RawStateRowSchema>;

function stateRows(data: unknown, table: string): RawStateRow[] {
	const parsed = RawStateRowSchema.array().safeParse(data ?? []);
	if (!parsed.success) {
		throw new Error(`search.${table} answered an unexpected embedding state shape`);
	}
	return parsed.data;
}

const PAGE = 1000;
const ID_CHUNK = 100;

async function readTable(index: IndexTable, ids: readonly string[] | null): Promise<RawStateRow[]> {
	const db = getServiceClient().schema("search");
	const columns = `${index.idColumn}${
		index.typed ? ", entity_type" : ""
	}, embedding_model, embedding_hash, embedded_at`;
	const out: RawStateRow[] = [];
	const fail = (message: string) => {
		throw new Error(`reading search.${index.table} embedding state failed — ${message}`);
	};
	if (ids) {
		for (let i = 0; i < ids.length; i += ID_CHUNK) {
			const { data, error } = await db.from(index.table).select(columns)
				.in(index.idColumn, ids.slice(i, i + ID_CHUNK));
			if (error) fail(error.message);
			out.push(...stateRows(data, index.table));
		}
		return out;
	}
	for (let from = 0;; from += PAGE) {
		const { data, error } = await db.from(index.table).select(columns).range(from, from + PAGE - 1);
		if (error) fail(error.message);
		const rows = stateRows(data, index.table);
		out.push(...rows);
		if (rows.length < PAGE) return out;
	}
}

/**
 * The stored embedding state of index rows, keyed by {@link entityKey} — service role. `only` narrows
 * the read to those entities (an empty list reads nothing); without it every row is read. Reads the
 * bookkeeping columns only; the vectors themselves never leave the database.
 */
export async function readEmbeddingStates(
	only?: readonly CatalogEntity[],
): Promise<Map<string, StoredEmbedding>> {
	const out = new Map<string, StoredEmbedding>();
	await Promise.all(INDEX_TABLES.map(async (index) => {
		const ids = only
			? [...new Set(only.filter((e) => index.kinds.includes(e.kind)).map((e) => e.id))]
			: null;
		if (ids && ids.length === 0) return;
		for (const row of await readTable(index, ids)) {
			const kind = DiscoveryEntityKind.safeParse(index.typed ? row.entity_type : index.kinds[0]);
			const id = row.service_id ?? row.project_id ?? row.entity_id;
			if (!kind.success || !id) continue;
			out.set(entityKey(kind.data, id), {
				model: row.embedding_model,
				hash: row.embedding_hash,
				embedded: row.embedded_at !== null,
			});
		}
	}));
	return out;
}

/** Whether the stored vector was made from exactly `hash` by the current model. */
export function isEmbeddingCurrent(stored: StoredEmbedding | undefined, hash: string): boolean {
	return !!stored && stored.embedded && stored.hash === hash && stored.model === EMBEDDING_MODEL;
}
// #endregion

// #region Writes
/** A vector as the pgvector text literal PostgREST hands to a `vector` parameter. */
export function vectorLiteral(vector: readonly number[]): string {
	return `[${vector.join(",")}]`;
}

/**
 * Store one entity's vector through `search.fn_set_embedding` — service role. `false` when the
 * entity has no index row (nothing was written); throws when the database refuses.
 */
export async function writeEmbedding(
	entity: CatalogEntity,
	vector: readonly number[],
	hash: string,
): Promise<boolean> {
	const args: SetEmbeddingArgs = SetEmbeddingArgsSchema.parse({
		p_entity_type: entity.kind,
		p_entity_id: entity.id,
		p_embedding: vectorLiteral(vector),
		p_model: EMBEDDING_MODEL,
		p_hash: hash,
	});
	const { data, error } = await getServiceClient().schema("search").rpc("fn_set_embedding", args);
	if (error) throw new Error(`search.fn_set_embedding failed — ${error.message}`);
	return data === true;
}
// #endregion

// #region Reads
function nearestRows(data: unknown, rpc: string): NearestEntityRow[] {
	const parsed = NearestEntityRowSchema.array().safeParse(data ?? []);
	if (!parsed.success) throw new Error(`search.${rpc} answered an unexpected shape`);
	return parsed.data;
}

/**
 * The public entities nearest `vector`, best first — `anon`, through `search.fn_nearest`. `types`
 * narrows to entity kinds (`null` = all); `exclude` drops entity ids.
 */
export async function nearestTo(
	vector: readonly number[],
	types: readonly DiscoveryEntityKind[] | null,
	exclude: readonly string[],
	limit: number,
): Promise<NearestEntityRow[]> {
	const { data, error } = await getAnonClient().schema("search").rpc("fn_nearest", {
		p_embedding: vectorLiteral(vector),
		p_types: types,
		p_exclude: exclude,
		p_limit: limit,
	});
	if (error) throw new Error(`search.fn_nearest failed — ${error.message}`);
	return nearestRows(data, "fn_nearest");
}

/**
 * The public entities nearest one public entity's STORED vector — `anon`, through
 * `search.fn_nearest_to_entity`, so the vector never crosses the wire. Empty when the entity has no
 * vector yet; the entity itself is always excluded.
 */
export async function nearestToEntity(
	entity: CatalogEntity,
	types: readonly DiscoveryEntityKind[] | null,
	exclude: readonly string[],
	limit: number,
): Promise<NearestEntityRow[]> {
	const { data, error } = await getAnonClient().schema("search").rpc("fn_nearest_to_entity", {
		p_entity_type: entity.kind,
		p_entity_id: entity.id,
		p_types: types,
		p_exclude: exclude,
		p_limit: limit,
	});
	if (error) throw new Error(`search.fn_nearest_to_entity failed — ${error.message}`);
	return nearestRows(data, "fn_nearest_to_entity");
}
// #endregion
