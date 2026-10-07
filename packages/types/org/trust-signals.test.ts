import { assert, assertEquals } from "@std/assert";
import {
	ADORNMENT_META,
	AdornmentDimension,
	AdornmentSlugSchema,
	PUBLIC_ADORNMENT_LIMIT,
	rankAdornments,
	stampRank,
	VERIFICATION_STAMP_META,
	VerificationStampSchema,
} from "./standing.ts";

Deno.test("adornments — every dimension has exactly one slug per tier", () => {
	for (const dimension of AdornmentDimension.options) {
		const tiers = AdornmentSlugSchema.options
			.filter((slug) => ADORNMENT_META[slug].dimension === dimension)
			.map((slug) => ADORNMENT_META[slug].tier)
			.sort();
		assertEquals(tiers, [1, 2, 3], dimension);
	}
});

Deno.test("adornments — one glyph per dimension, never per signal", () => {
	for (const dimension of AdornmentDimension.options) {
		const glyphs = new Set(
			AdornmentSlugSchema.options
				.filter((slug) => ADORNMENT_META[slug].dimension === dimension)
				.map((slug) => ADORNMENT_META[slug].glyph),
		);
		assertEquals(glyphs.size, 1, dimension);
	}
});

Deno.test("rankAdornments — caps at the public limit, highest tier first", () => {
	const ranked = rankAdornments([
		"quick_replies",
		"flawless_execution",
		"rated_4_8",
		"retained_partner",
		"on_schedule",
	]);
	assertEquals(ranked.length, PUBLIC_ADORNMENT_LIMIT);
	assertEquals(ranked, ["flawless_execution", "retained_partner", "rated_4_8"]);
});

Deno.test("rankAdornments — ties break by what a client weighs most", () => {
	assertEquals(
		rankAdornments([
			"create_specialist",
			"repeat_favorite",
			"quick_replies",
			"on_schedule",
			"rated_4_8",
		], 5),
		["rated_4_8", "on_schedule", "quick_replies", "repeat_favorite", "create_specialist"],
	);
});

Deno.test("rankAdornments — keeps only the highest tier of a dimension", () => {
	assertEquals(rankAdornments(["quick_replies", "instant_dispatch", "fast_replies"]), [
		"instant_dispatch",
	]);
});

Deno.test("rankAdornments — drops unknown slugs and duplicates, and honours a zero limit", () => {
	assertEquals(rankAdornments(["bogus", "top_reviews", "top_reviews", ""]), ["top_reviews"]);
	assertEquals(rankAdornments(["top_reviews"], 0), []);
	assertEquals(rankAdornments([]), []);
});

Deno.test("verification stamps — ordered none < identity < payout < corporate", () => {
	const ordered = [...VerificationStampSchema.options].sort((a, b) => stampRank(a) - stampRank(b));
	assertEquals(ordered, ["none", "id_verified", "vault_verified", "corporate_verified"]);
});

Deno.test("verification stamps — each earned stamp has its own crest", () => {
	const glyphs = Object.values(VERIFICATION_STAMP_META).map((m) => m.glyph);
	assertEquals(new Set(glyphs).size, glyphs.length);
	for (const meta of Object.values(VERIFICATION_STAMP_META)) assert(meta.authority.length > 0);
});
