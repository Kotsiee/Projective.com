import {
	EMBEDDING_MODEL,
	EMBEDDINGS_OVERRIDE_COOKIE,
	type EmbeddingsOverride,
	type EmbeddingsStatus,
	parseEmbeddingsOverride,
} from "@projective/types/explore";

/**
 * embeddings-gate — the pure decision behind `isEmbeddingsLive` (`core/supabase.ts`, Decision #179),
 * separated from the environment so every combination can be tested without touching `Deno.env`.
 */

/** Everything the gate reads, already resolved. */
export interface EmbeddingsGateFacts {
	useMocks: boolean;
	supabaseConfigured: boolean;
	keyPresent: boolean;
	/** `EMBEDDINGS_ENABLED`. */
	envEnabled: boolean;
	/** `DENO_ENV === "development"` — the only environment that may honour an override. */
	development: boolean;
	/** The request's `pj.dev.embeddings` cookie, or `null` when there is no request or no cookie. */
	override: EmbeddingsOverride | null;
}

/**
 * Resolve the switch. Semantic only when nothing is mocked, Supabase is configured, a Voyage key is
 * present and the effective setting is on — the override when one counts, else the environment.
 * An override reaches past the environment, never past the key.
 */
export function resolveEmbeddingsGate(facts: EmbeddingsGateFacts): EmbeddingsStatus {
	const override = facts.development ? facts.override : null;
	const setting = override === null ? facts.envEnabled : override === "on";
	const live = !facts.useMocks && facts.supabaseConfigured && facts.keyPresent && setting;
	return {
		ranking: live ? "semantic" : "heuristic",
		override,
		envEnabled: facts.envEnabled,
		keyPresent: facts.keyPresent,
		mocks: facts.useMocks,
		supabaseConfigured: facts.supabaseConfigured,
		model: EMBEDDING_MODEL,
	};
}

/** The `pj.dev.embeddings` override a `Cookie` header carries, or `null`. */
export function readEmbeddingsOverride(cookieHeader: string | null): EmbeddingsOverride | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1 || part.slice(0, eq).trim() !== EMBEDDINGS_OVERRIDE_COOKIE) continue;
		try {
			return parseEmbeddingsOverride(decodeURIComponent(part.slice(eq + 1)));
		} catch {
			return null;
		}
	}
	return null;
}

/** Whether a configured key is a key at all: blank and the `XXXX-XXXX` placeholder count as absent. */
export function hasVoyageKey(key: string | undefined): boolean {
	const value = key?.trim() ?? "";
	return value.length > 0 && !/^X{4}-X{4}$/i.test(value);
}
