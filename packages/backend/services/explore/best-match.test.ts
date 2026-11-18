import { assert, assertEquals } from "@std/assert";
import type {
	ArticleItem,
	ExploreCategory,
	ExploreItem,
	ExploreOwner,
	ExploreParams,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
} from "@projective/types/explore";
import { getResults } from "./query.ts";
import { NO_WEIGHTS, type RankingWeights, resolveWeights } from "./ranking.ts";

/**
 * The Best match relevance fixture: what a reader should see first for a typed search.
 *
 * Each case names a query, a scope and the top three a person would expect, with the rule it pins.
 * Quality scores are given per item (the quality score has its own tests in `ranking.test.ts`); the
 * `text_relevance` coefficient is read from the reference seed, so retuning it there shows here as
 * the cases it changes.
 *
 * The rules: an exact title comes first; a word in the title beats the same word in the tags, which
 * beats the summary, which beats the owner; the words in order in the title beat the words scattered;
 * a word only found inside another word earns nothing; repeating a word does not buy rank; and between
 * matches of the same strength the better quality score wins, as it does when one quality score is far
 * ahead of a slightly stronger match.
 */

// #region Corpus
const SEED = new URL(
	"../../../../supabase/migrations/00005050_seed_reference_data.sql",
	import.meta.url,
);

function seededWeights(): RankingWeights {
	const sql = Deno.readTextFileSync(SEED);
	const block = sql.slice(sql.indexOf("INSERT INTO search.search_weights"));
	const rows = [
		...block.slice(0, block.indexOf(";")).matchAll(
			/\(\s*'([a-z_]+)',\s*'[^']*',\s*'[^']*',\s*'[a-z]+',\s*([\d.]+)\s*\)/g,
		),
	].map((m) => ({ key: m[1], weight: Number(m[2]), is_active: true }));
	return resolveWeights(rows).weights;
}

const WEIGHTS = seededWeights();

function owner(
	name: string,
	handle: string,
	kind: ExploreOwner["kind"] = "freelancer",
): ExploreOwner {
	return { name, handle: `@${handle}`, avatar: "", kind };
}

const ANA = owner("Ana Ruiz", "anaruiz");
const BEN = owner("Ben Okoro", "benokoro");
const CLARA = owner("Clara Voss", "claravoss");
const DEV = owner("Dev Patel", "devpatel");
const NORTHWIND = owner("Northwind Studio", "northwind", "team");
const GUILD = owner("Mentor Guild", "mentorguild", "team");
const LUMEN = owner("Lumen Coffee", "lumencoffee", "business");

const QUALITY = new Map<string, number>();

interface Text {
	title: string;
	tags?: string[];
	summary: string;
	by: ExploreOwner;
	quality: number;
}

function skills(tags: string[] = []) {
	return tags.map((label) => ({ label, category: "design" as const }));
}

function base(id: string, t: Text) {
	QUALITY.set(id, t.quality);
	return {
		id,
		title: t.title,
		owner: t.by,
		skills: skills(t.tags),
		summary: t.summary,
		createdAt: "2026-09-01",
	};
}

function service(id: string, category: string, t: Text): ServiceItem {
	return {
		...base(id, t),
		type: "services",
		price: "$900",
		priceMinor: 90_000,
		currency: "USD",
		delivery: "10-day delivery",
		category,
		serviceType: "One-Off",
	};
}

function product(id: string, category: string, t: Text): ProductItem {
	return { ...base(id, t), type: "products", price: "$40", category, span: 1 };
}

function profile(id: string, type: ProfileItem["type"], t: Text): ProfileItem {
	return { ...base(id, t), type, craft: "", cover: "", delivered: 0 };
}

function project(id: string, t: Text): ProjectItem {
	return {
		...base(id, t),
		type: "projects",
		org: t.by.name,
		stage: "Hiring",
		budget: "$20,000",
		classification: "pipeline",
		roles: [],
		phases: [],
	};
}

function article(id: string, t: Text): ArticleItem {
	return { ...base(id, t), type: "articles", topic: "hiring", readMinutes: 4 };
}

const CORPUS: ExploreItem[] = [
	service("svc-logo-design", "branding", {
		title: "Logo design",
		tags: ["Logo design", "Branding"],
		summary: "A primary logo, two lockups and a usage sheet.",
		by: ANA,
		quality: 1.5,
	}),
	service("svc-logo-brand", "branding", {
		title: "Logo design and brand identity",
		tags: ["Branding", "Identity systems"],
		summary: "A logo, a palette and type pairing, delivered as a brand kit.",
		by: NORTHWIND,
		quality: 4.8,
	}),
	service("svc-identity-sprint", "branding", {
		title: "Brand identity sprint",
		tags: ["Branding", "Identity systems", "Typography"],
		summary: "A staged identity system from discovery to final kit.",
		by: CLARA,
		quality: 2.5,
	}),
	service("svc-packaging", "branding", {
		title: "Packaging art direction",
		tags: ["Packaging", "Branding", "Identity systems"],
		summary: "Dielines and print-ready files for a product range, matched to your identity.",
		by: BEN,
		quality: 4.0,
	}),
	service("svc-ds-foundation", "product", {
		title: "Design-system foundation",
		tags: ["Design systems", "Figma", "Accessibility"],
		summary: "Tokens, components and docs as a living Figma library.",
		by: DEV,
		quality: 3.0,
	}),
	service("svc-ds-workshop", "product", {
		title: "Design systems workshop",
		tags: ["Design systems", "Figma", "Mentoring"],
		summary: "A live multi-seat workshop: build a token-driven design system with a cohort.",
		by: CLARA,
		quality: 2.7,
	}),
	service("svc-mentorship", "product", {
		title: "Design mentorship",
		tags: ["Mentoring", "UX", "Design systems"],
		summary: "Six fortnightly 1:1s with a senior product designer.",
		by: GUILD,
		quality: 4.6,
	}),
	service("svc-motion-launch", "motion", {
		title: "Motion design for launches",
		tags: ["After Effects"],
		summary: "A 30-second launch film with cutdowns.",
		by: BEN,
		quality: 2.6,
	}),
	service("svc-launch-film", "motion", {
		title: "Product launch film",
		tags: ["Motion design", "Blender"],
		summary: "Script, 3D animation and sound, cut for every channel.",
		by: NORTHWIND,
		quality: 4.0,
	}),
	service("svc-explainer", "motion", {
		title: "Explainer video",
		tags: ["Video", "Scriptwriting"],
		summary: "An animated explainer film with motion design, ready for launch.",
		by: ANA,
		quality: 4.4,
	}),
	service("svc-logo-refresh", "branding", {
		title: "Logo refresh",
		tags: ["Branding"],
		summary: "We redraw your existing logo — no new design direction.",
		by: DEV,
		quality: 2.6,
	}),
	service("svc-guidelines", "branding", {
		title: "Brand guidelines",
		tags: ["Branding"],
		summary: "Logo logo logo logo logo: usage rules, logo spacing and logo colours.",
		by: BEN,
		quality: 1.6,
	}),
	service("svc-sign-painting", "branding", {
		title: "Sign painting workshop",
		tags: ["Signage", "Lettering"],
		summary: "Hand-lettered shop signs, taught live.",
		by: ANA,
		quality: 1.6,
	}),
	service("svc-identity-book", "branding", {
		title: "Identity brand book",
		tags: ["Branding"],
		summary: "Your identity rules and templates in one book.",
		by: DEV,
		quality: 2.1,
	}),
	service("svc-portfolio-review", "content", {
		title: "Portfolio review",
		tags: ["Mentoring", "Typography"],
		summary: "A booked call: an editor walks your portfolio.",
		by: GUILD,
		quality: 4.95,
	}),
	profile("ana", "freelancers", {
		title: "Ana Ruiz",
		tags: ["Branding", "Logo design"],
		summary: "Brand designer for early-stage startups",
		by: ANA,
		quality: 3.0,
	}),
	profile("northwind", "teams", {
		title: "Northwind Studio",
		summary: "Identity, packaging and launch films",
		by: NORTHWIND,
		quality: 4.6,
	}),
	profile("clara", "freelancers", {
		title: "Clara Voss",
		tags: ["Design systems", "Mentoring"],
		summary: "Design-systems lead and mentor",
		by: CLARA,
		quality: 2.8,
	}),
	profile("dev", "freelancers", {
		title: "Dev Patel",
		tags: ["React Native", "Swift", "TypeScript"],
		summary: "Mobile engineer — iOS and Android apps",
		by: DEV,
		quality: 3.5,
	}),
	profile("ben", "freelancers", {
		title: "Ben Okoro",
		tags: ["Motion design", "Blender"],
		summary: "Motion designer — launch films",
		by: BEN,
		quality: 2.2,
	}),
	profile("guild", "teams", {
		title: "Mentor Guild",
		tags: ["Mentoring"],
		summary: "Senior designers who mentor",
		by: GUILD,
		quality: 4.4,
	}),
	product("prd-aurora", "ui-kit", {
		title: "Aurora UI kit",
		tags: ["Figma", "Design systems"],
		summary: "A 400-component Figma UI kit.",
		by: DEV,
		quality: 2.0,
	}),
	product("prd-dashboard", "templates", {
		title: "Dashboard UI blocks",
		tags: ["Figma", "TypeScript"],
		summary: "Admin dashboard blocks for a UI kit or app.",
		by: NORTHWIND,
		quality: 3.2,
	}),
	product("prd-icon-set", "icons", {
		title: "Icon set",
		tags: ["Icons", "Figma"],
		summary: "640 icons for any UI kit.",
		by: ANA,
		quality: 3.4,
	}),
	product("prd-cafe-kit", "templates", {
		title: "Café branding kit",
		tags: ["Branding", "Templates"],
		summary: "Menus, cups and signage for a small café.",
		by: CLARA,
		quality: 1.8,
	}),
	product("prd-dielines", "templates", {
		title: "Packaging dieline templates",
		tags: ["Packaging", "Templates"],
		summary: "Fold-ready dielines for boxes and sleeves.",
		by: BEN,
		quality: 1.5,
	}),
	product("prd-icon-bundle", "icons", {
		title: "Icon set bundle — 2,000 icons",
		tags: ["Icons"],
		summary: "Every icon in one download.",
		by: DEV,
		quality: 4.8,
	}),
	product("prd-iconography", "icons", {
		title: "Iconography set",
		tags: ["Illustration"],
		summary: "Hand-drawn pictograms.",
		by: CLARA,
		quality: 3.0,
	}),
	project("prj-mobile-rebuild", {
		title: "Mobile app rebuild",
		tags: ["React Native", "Swift"],
		summary: "Rebuild the consumer app on iOS and Android.",
		by: LUMEN,
		quality: 1.9,
	}),
	project("prj-loyalty", {
		title: "Loyalty app for a coffee chain",
		tags: ["React Native", "Design systems"],
		summary: "A loyalty mobile app with stamps and offers.",
		by: LUMEN,
		quality: 2.4,
	}),
	project("prj-analytics", {
		title: "Analytics dashboard",
		tags: ["TypeScript", "Postgres"],
		summary: "Internal dashboards; a companion mobile app later.",
		by: LUMEN,
		quality: 2.6,
	}),
	article("art-brief-team", {
		title: "How to brief a design team",
		summary: "What to put in a brief so the team can quote it.",
		by: CLARA,
		quality: 1.7,
	}),
	article("art-brief-explained", {
		title: "The brief, explained",
		summary: "Writing a brief a team can build from.",
		by: ANA,
		quality: 1.65,
	}),
	article("art-escrow", {
		title: "Paying across stages",
		summary: "How escrow releases the money for each stage.",
		by: DEV,
		quality: 2.2,
	}),
];

function bestMatch(q: string, category: ExploreCategory, weights = WEIGHTS): string[] {
	const params: ExploreParams = { q, category, sort: "best_match", filters: {} };
	return getResults(CORPUS, params, QUALITY, weights).map((it) => it.id);
}
// #endregion

// #region Fixture
interface Case {
	q: string;
	category: ExploreCategory;
	top: string[];
	rule: string;
}

const CASES: Case[] = [
	{
		q: "logo design",
		category: "services",
		top: ["svc-logo-design", "svc-logo-brand", "svc-logo-refresh"],
		rule: "the exact title leads, though its seller has the lowest quality score",
	},
	{
		q: "logo",
		category: "services",
		top: ["svc-logo-brand", "svc-logo-refresh", "svc-logo-design"],
		rule: "three title matches order by quality; extra mentions do not outweigh a clear gap",
	},
	{
		q: "brand identity",
		category: "services",
		top: ["svc-logo-brand", "svc-identity-sprint", "svc-identity-book"],
		rule: "both words in the title, in either order, beat a better-reviewed tags-only match",
	},
	{
		q: "identity brand",
		category: "services",
		top: ["svc-logo-brand", "svc-identity-book", "svc-identity-sprint"],
		rule: "the words in the order typed lift the title that holds them so",
	},
	{
		q: "design system",
		category: "services",
		top: ["svc-ds-foundation", "svc-ds-workshop", "svc-mentorship"],
		rule:
			"the phrase in the title (hyphen and plural folded) beats a tag at a 1.7-point quality gap",
	},
	{
		q: "DESIGN SYSTEM",
		category: "services",
		top: ["svc-ds-foundation", "svc-ds-workshop", "svc-mentorship"],
		rule: "case is ignored",
	},
	{
		q: "motion design",
		category: "services",
		top: ["svc-motion-launch", "svc-launch-film", "svc-explainer"],
		rule: "title > tags > summary",
	},
	{
		q: "launch film",
		category: "services",
		top: ["svc-launch-film", "svc-explainer", "svc-motion-launch"],
		rule: "two weak matches of similar strength order by quality",
	},
	{
		q: "sign",
		category: "services",
		top: ["svc-sign-painting", "svc-logo-brand", "svc-mentorship"],
		rule: "a whole word beats one found inside another word ('design'), which earns nothing",
	},
	{
		q: "northwind studio",
		category: "all",
		top: ["northwind", "svc-logo-brand", "svc-launch-film"],
		rule: "the owner's own profile first, then their work by quality",
	},
	{
		q: "studio",
		category: "all",
		top: ["northwind", "svc-logo-brand", "svc-launch-film"],
		rule: "a title word beats the same word in an owner name",
	},
	{
		q: "mentoring",
		category: "services",
		top: ["svc-portfolio-review", "svc-mentorship", "svc-ds-workshop"],
		rule: "equal tag matches order by quality",
	},
	{
		q: "mobile app",
		category: "projects",
		top: ["prj-mobile-rebuild", "prj-loyalty", "prj-analytics"],
		rule: "phrase in title > words in title and summary > summary only",
	},
	{
		q: "ui kit",
		category: "products",
		top: ["prd-aurora", "prd-dashboard", "prd-icon-set"],
		rule: "a title word beats a summary mention at a small quality gap",
	},
	{
		q: "figma ui kit",
		category: "products",
		top: ["prd-aurora", "prd-dashboard", "prd-icon-set"],
		rule: "the phrase in the title leads a three-word query",
	},
	{
		q: "kit",
		category: "products",
		top: ["prd-aurora", "prd-cafe-kit", "prd-icon-set"],
		rule: "title matches lead summary matches with a better quality score",
	},
	{
		q: "react native",
		category: "all",
		top: ["dev", "prj-loyalty", "prj-mobile-rebuild"],
		rule: "equal tag matches across types order by quality",
	},
	{
		q: "packaging",
		category: "all",
		top: ["svc-packaging", "prd-dielines", "northwind"],
		rule: "a title match beats a 3-point better summary-only match",
	},
	{
		q: "brand",
		category: "services",
		top: ["svc-logo-brand", "svc-identity-sprint", "svc-identity-book"],
		rule: "the word itself beats a better-reviewed listing it only begins ('branding')",
	},
	{
		q: "icon set",
		category: "products",
		top: ["prd-icon-set", "prd-icon-bundle", "prd-iconography"],
		rule: "the exact title leads the better-reviewed phrase match; a prefix ('iconography') trails",
	},
	{
		q: "the",
		category: "articles",
		top: ["art-brief-explained", "art-escrow", "art-brief-team"],
		rule: "a stop-word-only query still scores its word: the title holding it first, then quality",
	},
];

for (const c of CASES) {
	Deno.test(`best match — "${c.q}" (${c.category}): ${c.rule}`, () => {
		assertEquals(bestMatch(c.q, c.category).slice(0, 3), c.top);
	});
}
// #endregion

// #region Contract
Deno.test("the fixture covers at least twenty queries, each with its top three", () => {
	assert(CASES.length >= 20);
	for (const c of CASES) assertEquals(c.top.length, 3, c.q);
});

Deno.test("best match reorders the text filter's result set and never changes it", () => {
	for (const c of CASES) {
		const recommended = getResults(
			CORPUS,
			{ q: c.q, category: c.category, sort: "recommended", filters: {} },
			QUALITY,
			WEIGHTS,
		).map((it) => it.id);
		assertEquals([...bestMatch(c.q, c.category)].sort(), [...recommended].sort(), c.q);
	}
});

Deno.test("repeating a word in a summary never outranks the word in a title", () => {
	const ranked = bestMatch("logo", "services");
	const stuffed = ranked.indexOf("svc-guidelines");
	for (const id of ["svc-logo-design", "svc-logo-brand", "svc-logo-refresh"]) {
		assert(ranked.indexOf(id) < stuffed, id);
	}
});

Deno.test("with text_relevance switched off, best match is the recommended order behind exact titles", () => {
	const off = { ...WEIGHTS, text_relevance: 0 };
	assertEquals(bestMatch("logo design", "services", off).slice(0, 3), [
		"svc-logo-design",
		"svc-logo-brand",
		"svc-logo-refresh",
	]);
	assertEquals(
		bestMatch("brand identity", "services", off),
		bestMatch("brand identity", "services", {
			...NO_WEIGHTS,
		}),
	);
});

Deno.test("stop-word-only and wordless queries degrade to the filter's set in a stable order", () => {
	for (const q of ["the", "for a", "a", "of the", "—", "!!!"]) {
		for (const category of ["all", "services", "articles"] as const) {
			const params: ExploreParams = { q, category, sort: "best_match", filters: {} };
			const first = getResults(CORPUS, params, QUALITY, WEIGHTS).map((it) => it.id);
			const again = getResults(CORPUS, params, QUALITY, WEIGHTS).map((it) => it.id);
			const recommended = getResults(CORPUS, { ...params, sort: "recommended" }, QUALITY, WEIGHTS)
				.map((it) => it.id);
			assertEquals(first, again, `${q} is deterministic`);
			assertEquals([...first].sort(), [...recommended].sort(), `${q} keeps the filter's set`);
		}
	}
	assertEquals(
		bestMatch("!!!", "all"),
		getResults(CORPUS, { q: "!!!", category: "all", sort: "recommended", filters: {} }, QUALITY)
			.map((it) => it.id),
		"a query with no word to match is the recommended order",
	);
});

Deno.test("recommended ignores the query: the same items rank by quality alone", () => {
	const ranked = getResults(
		CORPUS,
		{ q: "logo design", category: "services", sort: "recommended", filters: {} },
		QUALITY,
		WEIGHTS,
	).map((it) => it.id);
	assertEquals(ranked.slice(0, 2), ["svc-logo-brand", "svc-logo-refresh"]);
});
// #endregion
