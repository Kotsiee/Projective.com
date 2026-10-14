import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import type {
	ArticleItem,
	ExploreOwner,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
} from "@projective/types/explore";
import { embeddingHashOf, embeddingTextOf, estimateEmbeddingTokens } from "./embedding-text.ts";

const OWNER: ExploreOwner = { handle: "@juno", name: "Juno Park", avatar: "", kind: "freelancer" };

const SERVICE: ServiceItem = {
	id: "svc-aaaaaaaaaa",
	type: "services",
	title: "Brand identity  sprint",
	owner: OWNER,
	skills: [
		{ label: "Brand identity", category: "design" },
		{ label: "Logo design", category: "design" },
		{ label: "brand identity", category: "design" },
	],
	summary: "A one-week sprint:\n logo, palette and type.",
	createdAt: "2026-09-01T00:00:00.000Z",
	price: "$1,200",
	delivery: "7-day delivery",
	category: "branding",
	serviceType: "One-Off",
};

const PRODUCT: ProductItem = {
	id: "prd-aaaaaaaaaa",
	type: "products",
	title: "Dashboard blocks",
	owner: OWNER,
	skills: [],
	summary: "Figma dashboard components.",
	createdAt: "2026-09-01T00:00:00.000Z",
	price: "$65",
	category: "templates",
	span: 2,
};

const ARTICLE: ArticleItem = {
	id: "art-aaaaaaaaaa",
	type: "articles",
	title: "Escrow, explained",
	owner: OWNER,
	skills: [{ label: "Payments", category: "other" }],
	summary: "How stage escrow protects both sides.",
	createdAt: "2026-09-01T00:00:00.000Z",
	topic: "payments",
	readMinutes: 4,
};

const PROJECT: ProjectItem = {
	id: "prj-aaaaaaaaaa",
	type: "projects",
	title: "Meridian design system",
	owner: OWNER,
	skills: [{ label: "Design systems", category: "design" }],
	summary: "Tokens and components for a fintech app.",
	createdAt: "2026-09-01T00:00:00.000Z",
	org: "Meridian",
	stage: "Discovery",
	budget: "$9,000",
	classification: "pipeline",
	roles: ["Product designer"],
	phases: ["Discovery"],
};

const PROFILE: ProfileItem = {
	id: "juno",
	type: "freelancers",
	title: "Juno Park",
	owner: OWNER,
	skills: [{ label: "Illustration", category: "design" }],
	summary: "Illustrator for editorial and packaging.",
	createdAt: "2026-09-01T00:00:00.000Z",
	craft: "Illustrator",
	cover: "",
	delivered: 3,
};

Deno.test("embeddingTextOf — a service reads type · title · category · skills · summary · model · delivery", () => {
	assertEquals(
		embeddingTextOf(SERVICE),
		"Service: Brand identity sprint · Category: branding · Skills: Brand identity, Logo design · " +
			"A one-week sprint: logo, palette and type. · Model: One-Off · Delivery: 7-day delivery",
	);
});

Deno.test("embeddingTextOf — a listing's tags and search description join its text, once each", () => {
	assertEquals(
		embeddingTextOf(SERVICE, {
			tags: ["Rebrand", "rebrand ", " logos"],
			seoDescription: "Logo, palette and type in one week.",
		}),
		"Service: Brand identity sprint · Category: branding · Skills: Brand identity, Logo design · " +
			"Tags: Rebrand, logos · A one-week sprint: logo, palette and type. · " +
			"Logo, palette and type in one week. · Model: One-Off · Delivery: 7-day delivery",
	);
	// A search description that repeats the summary adds nothing; no terms leave the text unchanged.
	const summary = "A one-week sprint: logo, palette and type.";
	assertEquals(
		embeddingTextOf(SERVICE, { tags: [], seoDescription: summary }),
		embeddingTextOf(SERVICE),
	);
});

Deno.test("embeddingTextOf — each type gets its own label and only the fields it has", () => {
	assertEquals(
		embeddingTextOf(PRODUCT),
		"Product: Dashboard blocks · Category: templates · Figma dashboard components.",
	);
	assertEquals(
		embeddingTextOf(ARTICLE),
		"Article: Escrow, explained · Category: payments · Skills: Payments · How stage escrow protects both sides.",
	);
	assertEquals(
		embeddingTextOf(PROJECT),
		"Project: Meridian design system · Skills: Design systems · Tokens and components for a fintech app.",
	);
	assertEquals(
		embeddingTextOf(PROFILE),
		"Freelancer: Juno Park · Skills: Illustration · Illustrator for editorial and packaging.",
	);
	assertMatch(embeddingTextOf({ ...PROFILE, type: "users" }), /^Person: /);
	assertMatch(embeddingTextOf({ ...PROFILE, type: "teams" }), /^Team: /);
	assertMatch(embeddingTextOf({ ...PROFILE, type: "businesses" }), /^Business: /);
});

Deno.test("embeddingTextOf — deterministic, and blind to fields it does not read", () => {
	assertEquals(embeddingTextOf(SERVICE), embeddingTextOf({ ...SERVICE }));
	assertEquals(
		embeddingTextOf(SERVICE),
		embeddingTextOf({ ...SERVICE, price: "$9,999", createdAt: "2027-01-01T00:00:00.000Z" }),
		"a price or a date change must not re-embed",
	);
});

Deno.test("embeddingTextOf — long summaries are cut, never mid surrogate pair", () => {
	const long = embeddingTextOf({ ...ARTICLE, summary: "word ".repeat(2000) });
	assert(long.length <= 2000);
	const emoji = embeddingTextOf({ ...ARTICLE, summary: "😀".repeat(1500) });
	assert(!/[\uD800-\uDBFF]$/.test(emoji), "a dangling high surrogate is invalid UTF-16");
});

Deno.test("embeddingHashOf — a stable SHA-256 hex that moves with the text", async () => {
	assertEquals(
		await embeddingHashOf("abc"),
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	);
	const a = await embeddingHashOf(embeddingTextOf(SERVICE));
	assertEquals(a, await embeddingHashOf(embeddingTextOf(SERVICE)));
	assertNotEquals(a, await embeddingHashOf(embeddingTextOf({ ...SERVICE, title: "Logo sprint" })));
});

Deno.test("estimateEmbeddingTokens — about four characters a token, plus the document prompt", () => {
	assertEquals(estimateEmbeddingTokens(""), 8);
	assertEquals(estimateEmbeddingTokens("x".repeat(400)), 108);
});
