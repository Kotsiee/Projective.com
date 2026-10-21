import { assertEquals } from "@std/assert";
import { ServiceType } from "../explore/items.ts";
import { CreateCategory } from "../org/standing.ts";
import { mintSlug } from "../slugs/slug.ts";
import { EditSection } from "./archetype.ts";
import {
	AnalyticsPeriod,
	CatalogueSort,
	CatalogueSortDir,
	CatalogueTypeFilter,
	defaultSortDir,
	ListingStatus,
} from "./catalogue.ts";
import {
	catalogueBase,
	ConsoleHighlight,
	consoleHref,
	type ConsoleUrlState,
	ConsoleView,
	isDefaultStatuses,
	isListingSlug,
	isTeamHandle,
	normaliseStatuses,
	parseCataloguePath,
	parseConsoleUrl,
	parseWorkspaceUrl,
	PreviewDevice,
	scopeRedirect,
	teamOfCataloguePath,
	teamScopedApiPath,
	workspaceHref,
	WorkspaceTab,
	type WorkspaceUrlState,
} from "./url.ts";

// #region Generators
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function oneOf<T>(next: () => number, options: readonly T[]): T {
	return options[Math.floor(next() * options.length)];
}

function maybe<T>(next: () => number, value: () => T): T | undefined {
	return next() < 0.5 ? value() : undefined;
}

function subset<T>(next: () => number, options: readonly T[]): T[] {
	return options.filter(() => next() < 0.4);
}

const SCOPES = [
	"all",
	"product",
	"service",
	"model:pipeline",
	"model:group_session",
	"collection:spring-set",
];
const SEARCHES = ["", "logo", "brand identity", "café & co", "50% off", "a/b test?", "#1 pick"];
const CLIENTS = ["@maris", "@north_studio", "@ab"];
const TEAMS = ["north-loop", "abc", "studio-9"];

function consoleState(next: () => number): ConsoleUrlState {
	const sort = oneOf(next, CatalogueSort.options);
	const state: ConsoleUrlState = {
		view: oneOf(next, ConsoleView.options),
		type: oneOf(next, CatalogueTypeFilter.options),
		sort,
		dir: oneOf(next, CatalogueSortDir.options),
		search: oneOf(next, SEARCHES),
		period: oneOf(next, AnalyticsPeriod.options),
		scope: oneOf(next, SCOPES),
		createOpen: next() < 0.5,
		status: normaliseStatuses(subset(next, ListingStatus.options)),
		model: subset(next, ServiceType.options),
		create: subset(next, CreateCategory.options),
		highlights: subset(next, ConsoleHighlight.options),
	};
	const team = maybe(next, () => oneOf(next, TEAMS));
	if (team) state.team = team;
	const client = maybe(next, () => oneOf(next, CLIENTS));
	if (client) state.client = client;
	if (state.createOpen) {
		const kind = maybe(next, () => oneOf(next, ["product", "service"] as const));
		if (kind) state.createKind = kind;
		if (kind === "service") {
			const createModel = maybe(next, () => oneOf(next, ServiceType.options));
			if (createModel) state.createModel = createModel;
		}
	}
	return state;
}

function workspaceState(next: () => number): WorkspaceUrlState {
	const state: WorkspaceUrlState = {
		tab: oneOf(next, WorkspaceTab.options),
		device: oneOf(next, PreviewDevice.options),
		period: oneOf(next, AnalyticsPeriod.options),
	};
	const section = maybe(next, () => oneOf(next, EditSection.options));
	if (section) state.section = section;
	const team = maybe(next, () => oneOf(next, TEAMS));
	if (team) state.team = team;
	const client = maybe(next, () => oneOf(next, CLIENTS));
	if (client) state.client = client;
	return state;
}

const KEYS = [
	"view",
	"type",
	"status",
	"model",
	"category",
	"highlight",
	"scope",
	"search",
	"sort",
	"dir",
	"period",
	"client",
	"create",
	"tab",
	"section",
	"device",
	"junk",
];
const VALUES = [
	"",
	"1",
	"analytics",
	"service:session",
	"service:nope",
	"model:pipeline",
	"model:",
	"svc-23456789ab",
	"%E0%A4%A",
	"@@",
	"%00",
	"<script>",
	"desc",
	"12m",
	"Group Session",
	"=&=",
	"x".repeat(400),
];

function randomQuery(next: () => number): string {
	const n = Math.floor(next() * 8);
	const parts: string[] = [];
	for (let i = 0; i < n; i++) {
		parts.push(`${oneOf(next, KEYS)}=${oneOf(next, VALUES)}`);
	}
	return parts.join(oneOf(next, ["&", "&&", ";"]));
}
// #endregion

// #region Totality
Deno.test("console and workspace parsers are total over random query strings", () => {
	const next = rng(217);
	for (let i = 0; i < 500; i++) {
		const url = new URL(`https://projective.test/catalogue?${randomQuery(next)}`);
		const consoleState = parseConsoleUrl(url);
		assertEquals(ConsoleView.safeParse(consoleState.view).success, true);
		assertEquals(consoleState.search.length <= 160, true);
		parseWorkspaceUrl(url);
		scopeRedirect(url);
	}
});

Deno.test("an empty URL parses to the defaults", () => {
	const url = new URL("https://projective.test/catalogue");
	assertEquals(parseConsoleUrl(url), {
		view: "listings",
		type: "all",
		status: ["draft", "published", "paused"],
		model: [],
		create: [],
		highlights: [],
		sort: "recent",
		dir: "desc",
		search: "",
		period: "30d",
		scope: "all",
		createOpen: false,
	});
	assertEquals(parseWorkspaceUrl(url), { tab: "edit", device: "desktop", period: "30d" });
});

Deno.test("a team catalogue path parses its team into both states", () => {
	const slug = mintSlug("service");
	const at = (path: string) => new URL(`https://projective.test${path}`);
	assertEquals(parseConsoleUrl(at("/teams/north-loop/catalogue")).team, "north-loop");
	assertEquals(parseWorkspaceUrl(at(`/teams/north-loop/catalogue/${slug}`)).team, "north-loop");
	assertEquals(parseConsoleUrl(at("/catalogue")).team, undefined);
	assertEquals(parseConsoleUrl(at("/teams/North-Loop/catalogue")).team, undefined);
});

Deno.test("a bad value falls back to its default without disturbing the others", () => {
	const url = new URL(
		"https://projective.test/catalogue?view=nope&sort=title&dir=sideways&scope=svc-x",
	);
	const state = parseConsoleUrl(url);
	assertEquals(state.view, "listings");
	assertEquals(state.sort, "title");
	assertEquals(state.dir, defaultSortDir("title"));
	assertEquals(state.scope, "all");
});
// #endregion

// #region Round trip
Deno.test("parse(consoleHref(x)) deep-equals x", () => {
	const next = rng(53);
	for (let i = 0; i < 500; i++) {
		const state = consoleState(next);
		const href = consoleHref(state);
		assertEquals(parseConsoleUrl(new URL(href, "https://projective.test")), state, href);
	}
});

Deno.test("parse(workspaceHref(slug, x)) deep-equals x", () => {
	const next = rng(88);
	const slug = mintSlug("service");
	for (let i = 0; i < 300; i++) {
		const state = workspaceState(next);
		const href = workspaceHref(slug, state);
		assertEquals(href.startsWith(`${catalogueBase(state.team)}/${slug}`), true);
		assertEquals(parseWorkspaceUrl(new URL(href, "https://projective.test")), state, href);
	}
});
// #endregion

// #region Canonical form
Deno.test("consoleHref emits params in canonical order and omits defaults", () => {
	assertEquals(consoleHref({}), "/catalogue");
	assertEquals(consoleHref({ sort: "recent", dir: "desc", view: "listings" }), "/catalogue");
	assertEquals(
		consoleHref({
			createOpen: true,
			createKind: "service",
			createModel: "Group Session",
			client: "@maris",
			period: "90d",
			dir: "desc",
			sort: "title",
			search: "brand kit",
			scope: "model:session",
			create: ["test", "educate"],
			model: ["Session", "Direct Deliverable"],
			status: ["archived", "draft"],
			type: "service",
			view: "clients",
		}),
		"/catalogue?view=clients&type=service&status=draft,archived" +
			"&model=direct_deliverable,session&category=educate,test" +
			"&scope=model:session&search=brand%20kit&sort=title&dir=desc&period=90d&client=@maris" +
			"&create=service:group_session",
	);
	assertEquals(
		consoleHref({ team: "north-loop", highlights: ["best-selling", "attention"] }),
		"/teams/north-loop/catalogue?highlight=attention,best-selling",
	);
});

Deno.test("the highlight facet reads a list and drops what it does not know", () => {
	const at = (q: string) => parseConsoleUrl(new URL(`https://projective.test/catalogue?${q}`));
	assertEquals(at("highlight=promoted,attention,nope").highlights, ["attention", "promoted"]);
	assertEquals(at("highlight=").highlights, []);
	assertEquals(consoleHref({ highlights: [] }), "/catalogue");
});

Deno.test("the status facet opens on everything but Archived, and that set is omitted", () => {
	const at = (q: string) => parseConsoleUrl(new URL(`https://projective.test/catalogue?${q}`));
	assertEquals(at("").status, ["draft", "published", "paused"]);
	assertEquals(at("status=draft").status, ["draft"]);
	assertEquals(at("status=archived,draft,bogus,draft").status, ["draft", "archived"]);
	assertEquals(at("status=bogus").status, ["draft", "published", "paused"]);
	assertEquals(consoleHref({ status: ["paused", "published", "draft"] }), "/catalogue");
	assertEquals(consoleHref({ status: [] }), "/catalogue");
	assertEquals(
		consoleHref({ status: ["draft", "published", "paused", "archived"] }),
		"/catalogue?status=draft,published,paused,archived",
	);
	assertEquals(isDefaultStatuses(["published", "paused", "draft"]), true);
	assertEquals(isDefaultStatuses(["published"]), false);
});

Deno.test("the model and category facets read a list and drop what they do not know", () => {
	const at = (q: string) => parseConsoleUrl(new URL(`https://projective.test/catalogue?${q}`));
	assertEquals(at("model=session,pipeline,nope").model, ["Pipeline", "Session"]);
	assertEquals(at("category=test,educate,x").create, ["educate", "test"]);
	assertEquals(at("model=").model, []);
});

Deno.test("?create= opens the modal and seeds the kind and model", () => {
	const at = (q: string) => parseConsoleUrl(new URL(`https://projective.test/catalogue?${q}`));
	assertEquals(at("create=1").createOpen, true);
	assertEquals(at("create=1").createKind, undefined);
	assertEquals(at("create=product").createKind, "product");
	const seeded = at("create=service:session");
	assertEquals([seeded.createOpen, seeded.createKind, seeded.createModel], [
		true,
		"service",
		"Session",
	]);
	assertEquals(at("create=service:bogus").createOpen, false);
	assertEquals(at("create=0").createOpen, false);
	assertEquals(consoleHref({ createOpen: true }), "/catalogue?create=1");
	assertEquals(consoleHref({ createKind: "product" }), "/catalogue");
});

Deno.test("workspaceHref emits params in canonical order and omits defaults", () => {
	assertEquals(workspaceHref("prd-23456789ab", {}), "/catalogue/prd-23456789ab");
	assertEquals(
		workspaceHref("svc-23456789ab", {
			client: "@ab",
			period: "12m",
			device: "mobile",
			section: "seo",
			tab: "preview",
		}),
		"/catalogue/svc-23456789ab?tab=preview&section=seo&device=mobile&period=12m&client=@ab",
	);
});
// #endregion

// #region Scope redirect
Deno.test("scopeRedirect sends a listing scope to its workspace tab", () => {
	const slug = mintSlug("service");
	const product = mintSlug("product");
	const at = (q: string) => scopeRedirect(new URL(`https://projective.test/catalogue?${q}`));
	assertEquals(at(`scope=${slug}&view=analytics`), `/catalogue/${slug}?tab=analytics`);
	assertEquals(
		at(`view=clients&scope=${product}&period=7d&client=@maris`),
		`/catalogue/${product}?tab=clients&period=7d&client=@maris`,
	);
	assertEquals(at(`scope=${slug}`), `/catalogue/${slug}`);
	assertEquals(
		scopeRedirect(
			new URL(`https://projective.test/teams/north-loop/catalogue?scope=${slug}&view=clients`),
		),
		`/teams/north-loop/catalogue/${slug}?tab=clients`,
	);
});

Deno.test("scopeRedirect leaves a catalogue scope alone", () => {
	const at = (q: string) => scopeRedirect(new URL(`https://projective.test/catalogue?${q}`));
	assertEquals(at(""), null);
	assertEquals(at("scope=all"), null);
	assertEquals(at("scope=model:session&view=analytics"), null);
	assertEquals(at(`scope=${mintSlug("project")}`), null);
	assertEquals(at("scope=svc-0000000000"), null);
});

Deno.test("isListingSlug accepts service and product slugs only", () => {
	assertEquals(isListingSlug(mintSlug("service")), true);
	assertEquals(isListingSlug(mintSlug("product")), true);
	assertEquals(isListingSlug(mintSlug("project")), false);
	assertEquals(isListingSlug("new"), false);
});
// #endregion

// #region Seller scope
Deno.test("parseCataloguePath reads whose catalogue a path addresses", () => {
	assertEquals(parseCataloguePath("/catalogue"), { rest: [] });
	assertEquals(parseCataloguePath("/catalogue/svc-x/simulate"), { rest: ["svc-x", "simulate"] });
	assertEquals(parseCataloguePath("/teams/north-loop/catalogue"), { team: "north-loop", rest: [] });
	assertEquals(parseCataloguePath("/teams/north-loop/catalogue/prd-y/"), {
		team: "north-loop",
		rest: ["prd-y"],
	});
	assertEquals(parseCataloguePath("/teams/North-Loop/catalogue"), null);
	assertEquals(parseCataloguePath("/teams/north-loop/members"), null);
	assertEquals(parseCataloguePath("/catalogue/%E0%A4%A"), null);
	assertEquals(parseCataloguePath("/projects"), null);
	assertEquals(teamOfCataloguePath("/teams/abc/catalogue/svc-x"), "abc");
	assertEquals(teamOfCataloguePath("/catalogue"), undefined);
});

Deno.test("isTeamHandle accepts canonical handles only", () => {
	assertEquals(isTeamHandle("north-loop"), true);
	assertEquals(isTeamHandle("ab"), false);
	assertEquals(isTeamHandle("North"), false);
	assertEquals(isTeamHandle("-lead"), false);
	assertEquals(isTeamHandle("a".repeat(41)), false);
});

Deno.test("teamScopedApiPath appends the team to an API path, or leaves it", () => {
	assertEquals(teamScopedApiPath("/api/catalogue/update", undefined), "/api/catalogue/update");
	assertEquals(teamScopedApiPath("/api/catalogue/update", "abc"), "/api/catalogue/update?team=abc");
	assertEquals(
		teamScopedApiPath("/api/catalogue/list?type=all", "north-loop"),
		"/api/catalogue/list?type=all&team=north-loop",
	);
	assertEquals(
		teamScopedApiPath("/api/catalogue/list?team=studio-fern&limit=20", "north-loop"),
		"/api/catalogue/list?team=studio-fern&limit=20",
	);
});
// #endregion
