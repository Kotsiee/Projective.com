/**
 * slug — the ONE minter for every public route identifier on this platform.
 *
 * A slug is the OPAQUE, PREFIXED, IMMUTABLE address a public route carries: `prj-pkksys2xhd`,
 * `stg-w4n8zqe6mt`. It replaces two identifier shapes this product used to route on, and it exists
 * because both of them were wrong in ways that only show up later.
 *
 * ## Why not the row's uuid
 *
 * A uuid cannot collide and cannot be squatted, which is why `/projects/[projectId]` carried one. But
 * it is 36 characters of undifferentiated hex: it says nothing about what it addresses, so a support
 * ticket, a log line and a URL in a bug report are all mutually unintelligible, and a segment pasted
 * into the wrong route resolves against the wrong table with no shape to refuse it. The prefix is not
 * decoration — it is the only thing that makes a bare identifier self-describing.
 *
 * ## Why not a title-derived slug
 *
 * `aurora-rebrand` reads beautifully and is not an address. It moves on the first rename, so every
 * link built on it — a notification, a bookmark, another member's message — dies the moment the owner
 * edits the title, silently and with a clean 404. Deriving an address from mutable content is the
 * defect; shortening it is not the fix.
 *
 * So a slug here is derived from NOTHING. It is minted once from a CSPRNG and never recomputed, which
 * is what makes it idempotent across every future edit: there is no input that could change.
 *
 * ## The alphabet, and why 32 rather than 31
 *
 * {@link SLUG_ALPHABET} is the 36 lowercase alphanumerics minus `0`, `1`, `i` and `l`. One member of
 * each confusable group is dropped rather than the whole group: `o` is unambiguous precisely BECAUSE
 * `0` is gone, so keeping it costs nothing and there is nothing left to misread aloud or mistype from
 * a screenshot.
 *
 * That is also what makes the count exactly 32, and 32 is load-bearing rather than convenient: 256 is
 * a whole multiple of 32, so `byte % 32` maps a uniform random byte to a uniform random symbol.
 * Dropping `o` as well would leave 31, which needs rejection sampling — and the modulo written
 * without it, the form somebody reaches for first, is silently biased toward the first symbols. A
 * biased address is not a broken one, so nothing would ever have reported it.
 *
 * Ten symbols is 50 bits. Across a million rows that is a ~0.06% chance of ANY collision in the whole
 * table, which the insert retry absorbs; the retry exists regardless, because the database's unique
 * index is the only authority on whether an address is free at the instant of the insert.
 *
 * ## The SQL twin
 *
 * `security.mint_slug()` mints the same shape in Postgres, so a row inserted by a path that supplies
 * no slug still gets a canonical one. Two implementations of one format is exactly the drift this
 * codebase keeps getting bitten by, so `slug.contract.test.ts` reads the migrations and asserts the
 * alphabet, the body length and every CHECK are character-identical to the constants below. Change one
 * and that test names the other.
 *
 * @module
 */

// #region Format

/**
 * The 32 symbols a slug body is drawn from.
 *
 * No confusable group keeps two of its members: `0` is dropped and `o` kept, and all of `1`, `i` and
 * `l` are dropped. That is resolved by EXCLUSION rather than by a canonicalising decoder, because this
 * string is read by humans off screens and typed back by hand, and a decoder cannot help someone who
 * is reading it aloud.
 *
 * MUST stay 32 characters long. See the module note: the uniformity of `byte % 32` depends on it, and
 * the failure it prevents is invisible.
 */
export const SLUG_ALPHABET = "23456789abcdefghjkmnopqrstuvwxyz";

/** Symbols in a slug body. 10 x log2(32) = 50 bits. */
export const SLUG_BODY_LENGTH = 10;

/**
 * The route prefix per sluggable entity.
 *
 * The keys are the vocabulary the rest of the codebase names an entity by; the values are what appears
 * in a URL. Kept as one object rather than four constants so an exhaustive map over the entities is
 * possible and a fifth entity cannot be added without every consumer's type-checker seeing it.
 */
export const SLUG_PREFIXES = {
	project: "prj",
	stage: "stg",
	service: "svc",
	session: "ssn",
} as const;

/** An entity addressed by a prefixed slug. */
export type SluggedEntity = keyof typeof SLUG_PREFIXES;

/** Every sluggable entity, in declaration order. */
export const SLUGGED_ENTITIES = Object.keys(SLUG_PREFIXES) as readonly SluggedEntity[];

// #endregion

// #region Mint

/**
 * Mint a fresh slug for `entity`: the prefix, a hyphen, and {@link SLUG_BODY_LENGTH} symbols drawn
 * uniformly from {@link SLUG_ALPHABET}.
 *
 * Cryptographically random, and deliberately WITHOUT a `Math.random()` fallback. `crypto.getRandomValues`
 * is available in every browser and in Deno, including on insecure origins (it is `crypto.subtle` that
 * is secure-context gated, not this) — so the only way to reach a fallback is an environment where
 * something is already badly wrong, and quietly minting a guessable address there is worse than
 * throwing. An address nobody can mint is a visible failure; an address anybody can predict is not.
 */
export function mintSlug(entity: SluggedEntity): string {
	const bytes = crypto.getRandomValues(new Uint8Array(SLUG_BODY_LENGTH));
	let body = "";
	// `% 32` and not `% SLUG_ALPHABET.length` reading as a coincidence: 256 is a whole multiple of 32,
	// which is the entire reason the alphabet is 32 symbols wide. See the module note.
	for (const byte of bytes) body += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
	return `${SLUG_PREFIXES[entity]}-${body}`;
}

// #endregion

// #region Recognise

/** Escaped for use inside a regex character class. `-` is the only member needing it, and it is absent. */
const ALPHABET_CLASS = `[${SLUG_ALPHABET}]`;

/**
 * The anchored pattern a slug of this entity must match — the SAME shape the column's CHECK enforces.
 *
 * A fresh `RegExp` per call rather than a cached one: a shared instance is fine while nothing sets the
 * `g` flag, and `lastIndex` on a shared global regex is a stateful bug that appears only on the second
 * call. There is no flag here today, and nothing about this should depend on that staying true.
 */
export function slugPattern(entity: SluggedEntity): RegExp {
	return new RegExp(`^${SLUG_PREFIXES[entity]}-${ALPHABET_CLASS}{${SLUG_BODY_LENGTH}}$`);
}

/**
 * Whether `value` is a well-formed slug — of `entity` when one is named, of any entity otherwise.
 *
 * A SHAPE test, never an existence test. It says the string could address a row of that kind; only the
 * database says whether it does. Callers use it to refuse a malformed segment before spending a query,
 * not to decide access.
 */
export function isSlug(value: string, entity?: SluggedEntity): boolean {
	if (entity) return slugPattern(entity).test(value);
	return SLUGGED_ENTITIES.some((candidate) => slugPattern(candidate).test(value));
}

/**
 * Which entity a slug addresses, or `null` when the string is not a slug at all.
 *
 * Useful where one segment may legitimately name more than one kind of thing, and to turn a mismatched
 * identifier into an intelligible refusal ("that is a stage, not a project") instead of a bare 404.
 */
export function slugEntityOf(value: string): SluggedEntity | null {
	return SLUGGED_ENTITIES.find((entity) => slugPattern(entity).test(value)) ?? null;
}

// #endregion
