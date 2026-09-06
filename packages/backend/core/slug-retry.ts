/**
 * slug-retry — the insert loop that turns a slug collision into a second attempt instead of a refusal.
 *
 * A slug is 50 bits of CSPRNG output, so a clash is rare; the retry is not here because it is likely
 * but because the alternative is unsound. Checking whether an address is free costs a round trip whose
 * answer is stale before the insert runs — two callers minting in the same instant both see it free —
 * so the ONLY authority on whether a slug is available is the unique index at the moment of the write.
 * That makes the constraint violation the signal, and retrying on it the whole mechanism.
 *
 * ## What it must not swallow
 *
 * It retries on the SLUG's constraint and nothing else. A table normally carries several unique
 * indexes, and a handler that retries on any `23505` will spin a caller's real conflict — a duplicate
 * primary key, a repeated `(user_id, …)` pair — five times against fresh slugs and then report it as
 * an address problem. The address was never the problem, and the caller is told to fix the one thing
 * that was fine. `projects.create_project` learned this the expensive way and now reads
 * `CONSTRAINT_NAME` out of the diagnostics; this is the same discipline for writes issued over
 * PostgREST, where the constraint name arrives on the error rather than in a `GET STACKED DIAGNOSTICS`.
 *
 * @module
 */

import { mintSlug, type SluggedEntity } from "@projective/types/slugs";

// #region Error shape

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * The parts of a failed write this loop reads.
 *
 * Structural rather than `PostgrestError`, so a caller holding an RPC error, a `.insert()` error or a
 * hand-rolled one can pass it without an adapter, and so this module does not depend on the Supabase
 * client. Every field is optional because a transport failure produces an error with none of them, and
 * that error must fall through as itself rather than be read as a collision.
 */
export interface SlugWriteError {
	readonly code?: string | null;
	readonly message?: string | null;
	readonly details?: string | null;
}

/**
 * The shape one attempt must return: anything carrying an `error` that is either absent or
 * {@link SlugWriteError}-like.
 *
 * Deliberately a CONSTRAINT on the caller's own result type rather than a type this module defines.
 * A PostgREST builder resolves to `{ data, error, count, status, statusText }` with `error` typed as
 * the concrete `PostgrestError`, and forcing that through a narrower shape here would widen
 * `error.message` to `string | null | undefined` at every call site — so callers that hand the
 * message straight to a refusal would stop compiling, and the obvious fix for that is a `?? ""` that
 * turns a real database message into an empty string. The result passes through untouched instead.
 */
export type SlugAttemptResult = { error: SlugWriteError | null };

/**
 * Whether `error` is this slug's unique index refusing the write.
 *
 * `constraint` is the index name (`projects_slug_key`). PostgREST does not surface a structured
 * constraint field, so the name is matched inside the message/details it does return — which is why
 * the caller passes the name explicitly instead of this guessing from the entity: an index that is
 * renamed without this call site being updated must stop matching and let the error through, rather
 * than keep matching something else by coincidence.
 */
export function isSlugCollision(error: SlugWriteError, constraint: string): boolean {
	if (error.code !== UNIQUE_VIOLATION) return false;
	const haystack = `${error.message ?? ""} ${error.details ?? ""}`;
	return haystack.includes(constraint);
}

// #endregion

// #region Retry

/** How many slugs one write may try before the conflict is treated as real. */
export const SLUG_MAX_ATTEMPTS = 5;

/**
 * Run `attempt` with a freshly minted slug, re-minting while the slug's own unique index refuses it.
 *
 * Returns the last attempt's result either way: a success, or — once the attempts are spent, or on the
 * first error that is not this slug's collision — the error itself, unwrapped and unrelabelled, so the
 * caller reports what actually went wrong.
 *
 * Exhausting the attempts is not a case worth a sixth guess. Five independent 50-bit draws all landing
 * on taken addresses does not describe a busy table; it describes something else being wrong, and the
 * honest response is to surface the database's own error rather than a cheerful sentence about
 * addresses.
 */
export async function insertWithSlugRetry<R extends SlugAttemptResult>(
	entity: SluggedEntity,
	constraint: string,
	attempt: (slug: string) => PromiseLike<R>,
	maxAttempts: number = SLUG_MAX_ATTEMPTS,
): Promise<R> {
	// `PromiseLike`, not `Promise`: a PostgREST query builder is a thenable that only becomes a real
	// Promise once awaited, so requiring `Promise` would refuse the exact callers this exists for and
	// push them into an `await` that discards the builder's own result type.
	//
	// At least one attempt always runs, so the loop cannot fall through with nothing assigned — which
	// is why there is no "no attempt was made" placeholder to be returned by accident.
	let last = await attempt(mintSlug(entity));
	for (let i = 1; i < Math.max(1, maxAttempts); i++) {
		if (!last.error || !isSlugCollision(last.error, constraint)) return last;
		last = await attempt(mintSlug(entity));
	}
	return last;
}

// #endregion
