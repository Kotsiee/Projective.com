import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	decayedAffinity,
	normaliseTopic,
	personalRails,
	type RailCatalog,
	similarity,
	topicMatches,
	topicsOf,
	trendingRail,
	type ViewerSignals,
} from "./personalise.ts";
import { NO_WEIGHTS, type RankingWeights } from "./ranking.ts";
import type {
	ArticleItem,
	ExploreItem,
	ProfileItem,
	ServiceItem,
	SkillRef,
} from "@projective/types/explore";

/**
 * The Home feed's discovery rails: what fills "Because you viewed", its "Picked for you" fallback,
 * "Saved" and Trending, and what each refuses to show. Built over a small inline corpus — the rules
 * under test are the composer's, not the data's.
 */

// #region Corpus
const NOW = Date.parse("2026-10-12T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const skill = (label: string, category: SkillRef["category"] = "design"): SkillRef => ({
	label,
	category,
});

function service(id: string, skills: SkillRef[], extra: Partial<ServiceItem> = {}): ServiceItem {
	return {
		id,
		type: "services",
		title: `Service ${id}`,
		owner: { handle: "@studio", name: "Studio", avatar: "", kind: "freelancer" },
		skills,
		summary: "",
		createdAt: daysAgo(200),
		price: "$100",
		delivery: "5-day delivery",
		category: "branding",
		serviceType: "One-Off",
		...extra,
	};
}

function freelancer(id: string, skills: SkillRef[], createdAt = daysAgo(400)): ProfileItem {
	return {
		id,
		type: "freelancers",
		title: id,
		owner: { handle: `@${id}`, name: id, avatar: "", kind: "freelancer" },
		skills,
		summary: "",
		createdAt,
		craft: "",
		cover: "",
		delivered: 0,
	};
}

const article: ArticleItem = {
	id: "art-1",
	type: "articles",
	title: "Pricing a brand sprint",
	owner: { handle: "@editor", name: "Editor", avatar: "", kind: "user" },
	skills: [skill("Branding")],
	summary: "",
	createdAt: daysAgo(2),
	topic: "Branding",
	readMinutes: 4,
};

const ITEMS: ExploreItem[] = [
	service("svc-brand-a", [skill("Brand identity"), skill("Logo design")]),
	service("svc-brand-b", [skill("Brand identity")]),
	service("svc-brand-c", [skill("Logo design")], { createdAt: daysAgo(3) }),
	service("svc-brand-d", [skill("Brand identity"), skill("Packaging")]),
	service("svc-motion", [skill("Motion design", "motion")], {
		category: "motion",
		createdAt: daysAgo(5),
	}),
	service("svc-mine", [skill("Brand identity")], {
		owner: { handle: "@me", name: "Me", avatar: "", kind: "freelancer" },
	}),
	freelancer("ren", [skill("Motion design", "motion"), skill("3D", "spatial")], daysAgo(10)),
	freelancer("maris", [skill("Design systems"), skill("UI design")]),
	freelancer("juno", [skill("Frontend", "technical")]),
	article,
];

function catalog(scores: Record<string, number> = {}, trending: string[] = []): RailCatalog {
	return {
		items: ITEMS,
		byId: new Map(ITEMS.map((it) => [it.id, it])),
		scoreById: new Map(Object.entries(scores)),
		trending,
	};
}

function viewer(extra: Partial<ViewerSignals> = {}): ViewerSignals {
	return {
		viewed: [],
		saved: [],
		affinity: new Map(),
		interests: [],
		own: new Set(["@me"]),
		seller: false,
		...extra,
	};
}

const WEIGHTS: RankingWeights = { ...NO_WEIGHTS, interest_history: 1.25 };
const ids = (items: ExploreItem[] | undefined) => (items ?? []).map((it) => it.id);
// #endregion

Deno.test("topics are lowercase words — separators collapse, and a category joins the skills", () => {
	assertEquals(normaliseTopic("UI-Design"), "ui design");
	assertEquals(normaliseTopic("  3D / Motion "), "3d motion");
	assertEquals(topicsOf(ITEMS[0]).sort(), ["brand identity", "branding", "logo design"]);
	assertEquals(topicsOf(article), ["branding"]);
});

Deno.test("a topic matches equal phrases or whole words inside one, never a fragment", () => {
	assert(topicMatches("motion", "motion design"));
	assert(topicMatches("design systems", "design systems"));
	assert(!topicMatches("art", "partial"));
	assert(!topicMatches("ui", "ui design"), "two letters are too short to match inside a phrase");
});

Deno.test("similarity: a shared label beats a shared craft, and unrelated items score zero", () => {
	const at = (id: string) => ITEMS.find((it) => it.id === id)!;
	const sameLabel = similarity(at("svc-brand-a"), at("svc-brand-b"));
	const sameCraft = similarity(at("svc-brand-c"), at("maris"));
	assert(sameCraft > 0, "two design items share their craft");
	assert(sameLabel > sameCraft);
	assertEquals(similarity(at("juno"), at("maris")), 0);
	assertEquals(similarity(at("svc-brand-b"), at("svc-motion")), 0);
});

Deno.test("Because you viewed: the newest view's relatives, minus what was opened and your own", () => {
	const rails = personalRails(
		catalog(),
		viewer({ viewed: ["svc-brand-a", "svc-motion"] }),
		WEIGHTS,
	);
	assertEquals(rails.viewed?.kind, "because_viewed");
	assertEquals(rails.viewed?.anchor, { id: "svc-brand-a", title: "Service svc-brand-a" });
	const picked = ids(rails.viewed?.items);
	assert(!picked.includes("svc-brand-a"), "the anchor itself");
	assert(!picked.includes("svc-motion"), "already opened");
	assert(!picked.includes("svc-mine"), "the viewer's own listing");
	assert(picked.every((id) => id.startsWith("svc-")), "relatives stay in the anchor's family");
});

Deno.test("Because you viewed: an anchor with fewer than three relatives yields to the next view", () => {
	const rails = personalRails(catalog(), viewer({ viewed: ["juno", "svc-brand-b"] }), WEIGHTS);
	assertEquals(rails.viewed?.anchor?.id, "svc-brand-b");
});

Deno.test("among equally good candidates the closer match leads; quality outranks a small gap", () => {
	const viewedA = viewer({ viewed: ["svc-brand-a"] });
	const equal = personalRails(catalog(), viewedA, WEIGHTS);
	assertEquals(ids(equal.viewed?.items).at(-1), "svc-brand-d", "the least alike is last");
	const better = personalRails(catalog({ "svc-brand-d": 2 }), viewedA, WEIGHTS);
	assertEquals(ids(better.viewed?.items)[0], "svc-brand-d");
	const unweighted = personalRails(catalog(), viewedA, NO_WEIGHTS);
	assertEquals(ids(unweighted.viewed?.items), ["svc-brand-b", "svc-brand-c", "svc-brand-d"]);
});

Deno.test("no history: Picked for you from recent activity, else from stated interests, else nothing", () => {
	const fromActivity = personalRails(
		catalog(),
		viewer({ affinity: new Map([["brand identity", 3], ["motion design", 1]]) }),
		WEIGHTS,
	).viewed;
	assertEquals(fromActivity?.kind, "for_you");
	assertEquals(fromActivity?.basis, "activity");
	assert(!ids(fromActivity?.items).includes("svc-mine"));
	assert(!ids(fromActivity?.items).includes("art-1"), "articles are not marketplace picks");

	const fromInterests = personalRails(
		catalog(),
		viewer({ interests: ["design", "motion", "frontend"] }),
		WEIGHTS,
	).viewed;
	assertEquals(fromInterests?.basis, "interests");

	assertEquals(personalRails(catalog(), viewer(), WEIGHTS).viewed, null);
	assertEquals(
		personalRails(catalog(), viewer({ interests: ["accounting"] }), WEIGHTS).viewed,
		null,
	);
});

Deno.test("Picked for you: a seller is shown briefs, a buyer what they could hire or buy", () => {
	const brief: ExploreItem = {
		id: "prj-brand",
		type: "projects",
		title: "Rebrand",
		owner: { handle: "@client", name: "Client", avatar: "", kind: "user" },
		skills: [skill("Brand identity")],
		summary: "",
		createdAt: daysAgo(4),
		org: "Client",
		stage: "Discovery",
		budget: "$4,000",
		classification: "one-off",
		roles: [],
		phases: [],
	};
	const items = [...ITEMS, brief, { ...brief, id: "prj-logo" }, { ...brief, id: "prj-identity" }];
	const withBriefs: RailCatalog = {
		items,
		byId: new Map(items.map((it) => [it.id, it])),
		scoreById: new Map(),
		trending: [],
	};
	const affinity = new Map([["brand identity", 2]]);
	const seller = personalRails(withBriefs, viewer({ affinity, seller: true }), WEIGHTS).viewed;
	assert(ids(seller?.items).every((id) => id.startsWith("prj-")));
	const buyer = personalRails(withBriefs, viewer({ affinity }), WEIGHTS).viewed;
	assert(ids(buyer?.items).every((id) => !id.startsWith("prj-")));
});

Deno.test("Saved keeps the viewer's order and drops what is unpublished or their own", () => {
	const rails = personalRails(
		catalog(),
		viewer({ saved: ["maris", "gone-since", "svc-mine", "svc-brand-b"] }),
		WEIGHTS,
	);
	assertEquals(rails.saved?.kind, "saved");
	assertEquals(ids(rails.saved?.items), ["maris", "svc-brand-b"]);
	assertEquals(personalRails(catalog(), viewer(), WEIGHTS).saved, null);
});

Deno.test("Trending past the floor; below it, New on Projective; quiet simulates no activity", () => {
	const busy = trendingRail(catalog({}, ["juno", "maris", "unpublished", "svc-brand-a"]), NOW);
	assertEquals(busy?.kind, "trending");
	assertEquals(ids(busy?.items), ["juno", "maris", "svc-brand-a"]);

	const thin = trendingRail(catalog({}, ["juno", "unpublished"]), NOW);
	assertEquals(thin?.kind, "new");
	assertEquals(ids(thin?.items).sort(), ["ren", "svc-brand-c", "svc-motion"]);

	assertEquals(trendingRail(catalog({}, ["juno", "maris", "svc-brand-a"]), NOW, true)?.kind, "new");
	assertEquals(trendingRail(catalog(), NOW + 365 * 86_400_000), null);
});

Deno.test("affinity halves every fourteen days", () => {
	assertAlmostEquals(decayedAffinity(8, daysAgo(14), NOW), 4);
	assertAlmostEquals(decayedAffinity(8, daysAgo(28), NOW), 2);
	assertEquals(decayedAffinity(5, null, NOW), 5);
});
