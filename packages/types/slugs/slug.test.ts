/**
 * Properties of the slug minter.
 *
 * Every failure this file guards against is silent. A slug drawn from a biased modulo still routes; a
 * slug one character short still routes; a prefix that collides with another entity's still routes,
 * against the wrong table. None of them throws, and none of them is visible to a type-checker — so
 * they are asserted as PROPERTIES over many draws rather than checked by eye on one.
 */
import { assert, assertEquals, assertMatch } from "@std/assert";
import {
	isSlug,
	mintSlug,
	SLUG_ALPHABET,
	SLUG_BODY_LENGTH,
	SLUG_PREFIXES,
	SLUGGED_ENTITIES,
	slugEntityOf,
	slugPattern,
} from "./slug.ts";

/** Enough draws for a per-symbol expectation in the hundreds, so a missing symbol is conclusive. */
const DRAWS = 4000;

// #region Format
Deno.test("the alphabet is exactly 32 symbols, which is what makes `byte % 32` unbiased", () => {
	// 256 is a whole multiple of 32. At 31 symbols the same modulo would be biased toward the first
	// symbols — a defect that produces perfectly working addresses, so nothing would ever report it.
	assertEquals(SLUG_ALPHABET.length, 32);
	assertEquals(256 % SLUG_ALPHABET.length, 0);
});

Deno.test("no confusable group keeps two of its members", () => {
	// The property is that a reader can never have to choose between two symbols, NOT that every
	// confusable character is banned. `o` is fine once `0` is gone, and keeping it is what makes the
	// alphabet 32 wide instead of 31 — so a test written as "none of 0,o,1,l,i is present" would fail
	// on a correct alphabet and push whoever hit it toward the biased 31-symbol variant.
	const groups = [["0", "o"], ["1", "l", "i"]];
	for (const group of groups) {
		const kept = group.filter((ch) => SLUG_ALPHABET.includes(ch));
		assert(
			kept.length <= 1,
			`the alphabet keeps ${kept.map((c) => `"${c}"`).join(" and ")}, which are confusable`,
		);
	}
	assertEquals(new Set(SLUG_ALPHABET).size, SLUG_ALPHABET.length, "the alphabet repeats a symbol");
	assertMatch(SLUG_ALPHABET, /^[a-z0-9]+$/, "a slug is interpolated into a URL path segment");
});

Deno.test("the four prefixes are distinct and equal-width", () => {
	const prefixes = Object.values(SLUG_PREFIXES);
	assertEquals(new Set(prefixes).size, prefixes.length, "two entities share a prefix");
	for (const p of prefixes) assertMatch(p, /^[a-z]{3}$/);
});
// #endregion

// #region Mint
Deno.test("a minted slug has the right prefix, the right length, and only legal symbols", () => {
	for (const entity of SLUGGED_ENTITIES) {
		const value = mintSlug(entity);
		assertMatch(value, slugPattern(entity));
		assertEquals(value.length, SLUG_PREFIXES[entity].length + 1 + SLUG_BODY_LENGTH);
		assert(value.startsWith(`${SLUG_PREFIXES[entity]}-`));
		for (const ch of value.slice(SLUG_PREFIXES[entity].length + 1)) {
			assert(SLUG_ALPHABET.includes(ch), `"${ch}" is not in the alphabet`);
		}
	}
});

Deno.test("every symbol of the alphabet is actually reachable", () => {
	// A one-character mistake in the index arithmetic — an off-by-one on `+ 1`, a `substr` that starts
	// at the wrong place — silently strands a symbol at one end. With DRAWS x 10 characters the
	// expectation per symbol is well over a thousand, so an absence here is arithmetic, not luck.
	const seen = new Set<string>();
	for (let i = 0; i < DRAWS; i++) {
		for (const ch of mintSlug("project").slice(4)) seen.add(ch);
	}
	assertEquals(
		seen.size,
		SLUG_ALPHABET.length,
		`unreachable symbols: ${[...SLUG_ALPHABET].filter((c) => !seen.has(c)).join("")}`,
	);
});

Deno.test("the draw is not detectably biased", () => {
	// A chi-square-flavoured sanity bound rather than a real test of the CSPRNG: what is being checked
	// is the mapping from bytes to symbols, and the way that goes wrong (`% 31` over 32 symbols, or a
	// modulo over a non-power-of-two alphabet) skews hard enough to fail a loose bound like this one.
	const counts = new Map<string, number>();
	const total = DRAWS * SLUG_BODY_LENGTH;
	for (let i = 0; i < DRAWS; i++) {
		for (const ch of mintSlug("project").slice(4)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
	}
	const expected = total / SLUG_ALPHABET.length;
	for (const ch of SLUG_ALPHABET) {
		const n = counts.get(ch) ?? 0;
		assert(
			Math.abs(n - expected) < expected * 0.35,
			`"${ch}" appeared ${n} times against an expectation of ${expected} — the draw looks biased`,
		);
	}
});

Deno.test("minting does not repeat itself in any run a person would notice", () => {
	// Not a uniqueness guarantee — 50 bits collides eventually, which is precisely why the insert
	// retries. It is a guard against a minter that is accidentally deterministic (a seeded PRNG, a
	// cached value, a hoisted `getRandomValues` call), which is the failure that makes every project
	// on a fresh install share one address.
	const seen = new Set<string>();
	for (let i = 0; i < DRAWS; i++) seen.add(mintSlug("project"));
	assertEquals(seen.size, DRAWS, "the minter returned the same slug twice");
});
// #endregion

// #region Recognise
Deno.test("a slug is recognised as its own entity and as no other", () => {
	for (const owner of SLUGGED_ENTITIES) {
		const value = mintSlug(owner);
		assertEquals(slugEntityOf(value), owner);
		assert(isSlug(value));
		assert(isSlug(value, owner));
		for (const other of SLUGGED_ENTITIES) {
			if (other !== owner) assert(!isSlug(value, other), `${value} matched ${other}`);
		}
	}
});

Deno.test("near-misses are refused", () => {
	const body = SLUG_ALPHABET.slice(0, SLUG_BODY_LENGTH);
	const cases: [string, string][] = [
		[`prj-${body.slice(1)}`, "one symbol short"],
		[`prj-${body}${SLUG_ALPHABET[0]}`, "one symbol long"],
		[`prj-${body.slice(0, -1)}0`, "carries an excluded symbol"],
		[`prj_${body}`, "wrong separator"],
		[`PRJ-${body}`, "uppercase"],
		[`prj-${body} `, "trailing space"],
		[` prj-${body}`, "leading space"],
		[`x/prj-${body}`, "unanchored at the start"],
		[`prj-${body}/x`, "unanchored at the end"],
		["", "empty"],
	];
	for (const [value, why] of cases) {
		assert(!isSlug(value), `"${value}" (${why}) was accepted as a slug`);
		assertEquals(slugEntityOf(value), null);
	}
});

Deno.test("the pattern is a fresh instance, so it carries no matcher state", () => {
	// A cached global regex would return alternating answers for the same input via `lastIndex`. There
	// is no `g` flag today; this asserts nothing starts depending on that staying true.
	const value = mintSlug("project");
	for (let i = 0; i < 3; i++) assert(slugPattern("project").test(value));
	const shared = slugPattern("project");
	for (let i = 0; i < 3; i++) assert(shared.test(value), "the pattern is stateful across calls");
});
// #endregion
