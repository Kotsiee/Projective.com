import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	CHANGELOG_CATEGORIES,
	CHANGELOG_CATEGORY_LABEL,
	ChangelogReleaseRowSchema,
	ChangelogVersionSchema,
} from "./changelog.ts";

/**
 * The release row schema is the changelog's SSOT: it validates every authored record before the
 * generator emits it and every row the live read returns, so the rules a feed relies on live here.
 */

const row = {
	version: "0.12.0",
	released_on: "2026-10-11",
	title: "Funding before work",
	summary: "No work starts until it is funded.",
	categories: ["escrow", "projects"],
	body: [{ type: "p", content: "A ticket moves into work once its payment is held." }],
	images: [{
		src: "https://placehold.co/1600x1000?text=Needs+funding",
		alt: "A ticket waiting in Needs funding",
		w: 1600,
		h: 1000,
		caption: "A ticket waits until its payment is held.",
	}],
	withdrawn: false,
};

/** The row with one field replaced. */
function withField(field: string, value: unknown): Record<string, unknown> {
	return { ...row, [field]: value };
}

Deno.test("a well-formed release row parses unchanged", () => {
	const parsed = ChangelogReleaseRowSchema.parse(row);
	assertEquals(parsed, row as typeof parsed);
});

Deno.test("a PostgREST date and an empty gallery parse", () => {
	assert(ChangelogReleaseRowSchema.safeParse(withField("images", [])).success);
	assert(ChangelogReleaseRowSchema.safeParse(withField("released_on", "2026-01-31")).success);
});

Deno.test("versions are lower-case semantic versions", () => {
	for (const ok of ["0.1.0", "1.4.12", "2.0.0-beta.1", "10.0.0-rc-2"]) {
		assert(ChangelogVersionSchema.safeParse(ok).success, ok);
	}
	for (const bad of ["1.0", "v1.0.0", "01.0.0", "1.0.0-RC.1", "1.0.0-", "1.0.0 ", ""]) {
		assertFalse(ChangelogVersionSchema.safeParse(bad).success, bad);
	}
});

Deno.test("categories: at least one, each known, none twice", () => {
	assertFalse(ChangelogReleaseRowSchema.safeParse(withField("categories", [])).success);
	assertFalse(ChangelogReleaseRowSchema.safeParse(withField("categories", ["gossip"])).success);
	assertFalse(
		ChangelogReleaseRowSchema.safeParse(withField("categories", ["ux", "ux"])).success,
	);
});

Deno.test("every category has a label, in filter order", () => {
	assertEquals(Object.keys(CHANGELOG_CATEGORY_LABEL), [...CHANGELOG_CATEGORIES]);
	for (const category of CHANGELOG_CATEGORIES) {
		assert(CHANGELOG_CATEGORY_LABEL[category].length > 0);
	}
});

Deno.test("a body may not carry an image node — pictures belong to the gallery", () => {
	const result = ChangelogReleaseRowSchema.safeParse(
		withField("body", [
			{ type: "p", content: "Intro" },
			{ type: "image", src: "/test_images/banner_2.jpg", alt: "A car", w: 1280, h: 720 },
		]),
	);
	assertFalse(result.success);
	assert(result.error?.issues.some((issue) => issue.path.join(".") === "body.1"));
});

Deno.test("a body sub-heading takes a generated id, never an explicit one", () => {
	assert(
		ChangelogReleaseRowSchema.safeParse(
			withField("body", [{ type: "h3", text: "Fixes" }, { type: "p", content: "x" }]),
		).success,
	);
	assertFalse(
		ChangelogReleaseRowSchema.safeParse(
			withField("body", [{ type: "h3", text: "Fixes", id: "fixes" }, { type: "p", content: "x" }]),
		).success,
	);
});

Deno.test("an empty body, a blank title and an unsafe image are refused", () => {
	assertFalse(ChangelogReleaseRowSchema.safeParse(withField("body", [])).success);
	assertFalse(ChangelogReleaseRowSchema.safeParse(withField("title", "   ")).success);
	assertFalse(
		ChangelogReleaseRowSchema.safeParse(
			withField("images", [{ src: "//evil.example/x.png", alt: "x", w: 1, h: 1, caption: "x" }]),
		).success,
	);
	assertFalse(
		ChangelogReleaseRowSchema.safeParse(
			withField("images", [{ src: "https://placehold.co/1x1", alt: "", w: 1, h: 1, caption: "x" }]),
		).success,
	);
});

Deno.test("every picture carries a caption", () => {
	const { caption: _caption, ...uncaptioned } = row.images[0];
	assertFalse(ChangelogReleaseRowSchema.safeParse(withField("images", [uncaptioned])).success);
	assertFalse(
		ChangelogReleaseRowSchema.safeParse(withField("images", [{ ...row.images[0], caption: "" }]))
			.success,
	);
});
