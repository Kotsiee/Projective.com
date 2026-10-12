import { z } from "zod";
import { DiscoveryEntityKind } from "./signals.ts";

/**
 * explore.embeddings — the Zod SSOT for discovery's voyage-4 vectors (Decision #179): the embedding
 * columns of `search.{profiles,projects,services,catalogue}_index` and `search.query_logs`, the RPCs
 * that write (`search.fn_set_embedding`) and read (`search.fn_nearest`, `search.fn_nearest_to_entity`)
 * them, and the switch that turns semantic ranking on per request. Migrations 00000018 · 00001400 ·
 * 00001800 · 00002510 · 00002520 · 00004004; documented in `documentation/database/search/*`.
 */

// #region Model
/** The model every stored and query vector comes from. */
export const EMBEDDING_MODEL = "voyage-4";

/** The vector width — `output_dimension`, and the `vector(1024)` columns. */
export const EMBEDDING_DIMENSIONS = 1024;

/** One vector: {@link EMBEDDING_DIMENSIONS} finite floats, unit length (inner product = cosine). */
export const EmbeddingVectorSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);
export type EmbeddingVector = z.infer<typeof EmbeddingVectorSchema>;

/** Voyage's `input_type`: listings are embedded as documents, searches as queries. Always sent. */
export const EmbeddingInputType = z.enum(["document", "query"]);
export type EmbeddingInputType = z.infer<typeof EmbeddingInputType>;
// #endregion

// #region Rows
/**
 * The bookkeeping beside every stored vector. Only `fn_set_embedding` writes it, so `embedded_at` is
 * set exactly when a vector is. Readable by `service_role` alone (00002520).
 */
export const EmbeddingStateSchema = z.object({
	embedding_model: z.string().nullable(),
	/** SHA-256 of the text the vector was made from — an unchanged text is never re-embedded. */
	embedding_hash: z.string().nullable(),
	embedded_at: z.string().nullable(),
});
export type EmbeddingState = z.infer<typeof EmbeddingStateSchema>;

/** The two entity types `search.catalogue_index` files: the discovery entities no other index covered. */
export const CatalogueIndexEntityType = z.enum(["product", "article"]);
export type CatalogueIndexEntityType = z.infer<typeof CatalogueIndexEntityType>;

/** One `search.catalogue_index` row as `anon` may select it — never the vector or its bookkeeping. */
export const CatalogueIndexRowSchema = z.object({
	entity_type: CatalogueIndexEntityType,
	entity_id: z.string().uuid(),
	title: z.string(),
	is_public: z.boolean(),
	updated_at: z.string().nullable(),
});
export type CatalogueIndexRow = z.infer<typeof CatalogueIndexRowSchema>;

/** One row of `search.fn_nearest` / `search.fn_nearest_to_entity`: a public entity and its cosine similarity. */
export const NearestEntityRowSchema = z.object({
	entity_type: DiscoveryEntityKind,
	entity_id: z.string().uuid(),
	score: z.union([z.number(), z.string()]),
});
export type NearestEntityRow = z.infer<typeof NearestEntityRowSchema>;

/** `search.fn_set_embedding`'s arguments (service role only). The vector travels as a pgvector literal. */
export const SetEmbeddingArgsSchema = z.object({
	p_entity_type: DiscoveryEntityKind,
	p_entity_id: z.string().uuid(),
	p_embedding: z.string().regex(/^\[[^\]]+\]$/),
	p_model: z.string().min(1),
	p_hash: z.string().min(1),
});
export type SetEmbeddingArgs = z.infer<typeof SetEmbeddingArgsSchema>;
// #endregion

// #region The switch
/** How a discovery response was ordered: by voyage-4 vectors, or by the heuristic alone. */
export const DiscoveryRanking = z.enum(["semantic", "heuristic"]);
export type DiscoveryRanking = z.infer<typeof DiscoveryRanking>;

/** The development-only response header that reports {@link DiscoveryRanking} on `/explore` and `/api/explore/*`. */
export const DISCOVERY_RANKING_HEADER = "x-discovery-ranking";

/** The Dev Context Switcher's override of `EMBEDDINGS_ENABLED`. Absent = follow the environment. */
export const EmbeddingsOverride = z.enum(["on", "off"]);
export type EmbeddingsOverride = z.infer<typeof EmbeddingsOverride>;

/** The cookie that carries {@link EmbeddingsOverride}. The server honours it in development only. */
export const EMBEDDINGS_OVERRIDE_COOKIE = "pj.dev.embeddings";

/** Read the override from a cookie value; anything unrecognised means "no override", never a guess. */
export function parseEmbeddingsOverride(raw: string | null | undefined): EmbeddingsOverride | null {
	const parsed = EmbeddingsOverride.safeParse(raw?.trim());
	return parsed.success ? parsed.data : null;
}

/** The effective switch with every input that decided it — the switcher's status line. */
export const EmbeddingsStatusSchema = z.object({
	ranking: DiscoveryRanking,
	/** The override that counted: `null` when there was none, or outside development. */
	override: EmbeddingsOverride.nullable(),
	envEnabled: z.boolean(),
	keyPresent: z.boolean(),
	mocks: z.boolean(),
	supabaseConfigured: z.boolean(),
	model: z.string(),
});
export type EmbeddingsStatus = z.infer<typeof EmbeddingsStatusSchema>;
// #endregion
