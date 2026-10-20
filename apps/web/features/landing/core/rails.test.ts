/**
 * "Ways to work" as data (`flows/LANDING.md` §4.5): the three ways' words and exact links, and the
 * live rails sliced from the landing payload — none without a payload, each hidden below four items,
 * cut to eight, no products rail, paid placements left out, Explore's own hrefs, the avatar
 * fallback, and a price only where the listing carries a real one.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import type {
	ExploreOwner,
	LandingPayload,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
} from "@projective/types/explore";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import {
	RAIL_COPY,
	RAIL_IDS,
	RAIL_MAX_ITEMS,
	RAIL_MIN_ITEMS,
	railByline,
	railLabel,
	railMoney,
	railMonogram,
	railStepLabel,
	railTrackId,
	servicePriceLine,
	sliceRails,
	WAYS,
	WAYS_COPY,
	WAYS_SECTION_ID,
} from "./rails.ts";

// #region Fixtures
function owner(handle: string, avatar = `/test_images/${handle}.jpg`): ExploreOwner {
	return { handle: `@${handle}`, name: `Owner ${handle}`, avatar, kind: "freelancer" };
}

const BASE = { skills: [], summary: "", createdAt: "2026-10-01T00:00:00Z" };

function service(n: number, extra: Partial<ServiceItem> = {}): ServiceItem {
	return {
		...BASE,
		id: `svc-${n}`,
		type: "services",
		title: `Service ${n}`,
		owner: owner(`svc${n}`),
		media: `/test_images/cover_${n}.jpg`,
		price: "£150",
		delivery: "3 days",
		category: "web",
		serviceType: "One-Off",
		priceMinor: 15000,
		currency: "GBP",
		...extra,
	};
}

function project(n: number, extra: Partial<ProjectItem> = {}): ProjectItem {
	return {
		...BASE,
		id: `prj-${n}`,
		type: "projects",
		title: `Project ${n}`,
		owner: owner(`client${n}`),
		org: "Acme",
		stage: "Hiring",
		budget: "£2,000",
		budgetMinor: 200000,
		currency: "GBP",
		classification: "pipeline",
		roles: [],
		phases: [],
		...extra,
	};
}

function profile(type: "freelancers" | "teams", n: number, extra: Partial<ProfileItem> = {}) {
	const item: ProfileItem = {
		...BASE,
		id: `${type}-${n}`,
		type,
		title: `${type === "teams" ? "Team" : "Person"} ${n}`,
		owner: owner(`${type}${n}`),
		craft: "Brand and web design",
		cover: `/test_images/banner_${n}.jpg`,
		delivered: 3,
		...extra,
	};
	return item;
}

function product(n: number): ProductItem {
	return {
		...BASE,
		id: `prd-${n}`,
		type: "products",
		title: `Product ${n}`,
		owner: owner(`prd${n}`),
		price: "£20",
		category: "templates",
		span: 1,
	} as ProductItem;
}

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

/** A landing payload whose recommended lists hold the given items. */
function payload(lists: {
	services?: ServiceItem[];
	projects?: ProjectItem[];
	people?: ProfileItem[];
	products?: ProductItem[];
}): LandingPayload {
	const services = lists.services ?? [];
	const projects = lists.projects ?? [];
	const people = lists.people ?? [];
	const products = lists.products ?? [];
	return {
		home: {
			users: [],
			freelancers: people.filter((p) => p.type === "freelancers"),
			teams: people.filter((p) => p.type === "teams"),
			businesses: [],
			services,
			projects,
			products,
			articles: [],
			promos: [],
			recommended: { services, products, projects, people },
			personal: { viewed: null, saved: null },
			trending: null,
		},
		testimonials: [],
		stats: null,
		heroImage: null,
	};
}

/** Every rail full: 10 services, 6 projects, 5 teams, 9 freelancers, and 10 products. */
function fullPayload(): LandingPayload {
	return payload({
		services: range(10).map((n) => service(n)),
		projects: range(6).map((n) => project(n)),
		people: [
			...range(5).map((n) => profile("teams", n)),
			...range(9).map((n) => profile("freelancers", n)),
		],
		products: range(10).map(product),
	});
}
// #endregion

// #region Ways to work
Deno.test("ways: the three ways' links are exact — post a job, then Explore's delivery-model facet", () => {
	assertEquals(
		WAYS.map((way) => [way.label, way.href]),
		[
			["Post a single job", "/projects?create=1"],
			["Browse ongoing work", "/explore?category=services&model=Pipeline"],
			["Browse live sessions", "/explore?category=services&model=Session&model=Group+Session"],
		],
	);
	assertEquals(WAYS_SECTION_ID, "ways-to-work");
});

Deno.test("ways: the words are §4.5's, verbatim", () => {
	assertEquals(WAYS_COPY.title, "Work the way you want.");
	assertEquals(WAYS_COPY.subline, "Pick a single job, an ongoing workflow or a live session.");
	assertEquals(
		WAYS_COPY.note,
		"Need just one thing done? Start with a single task: one deliverable, one price.",
	);
	assertEquals(WAYS.map((way) => [way.title, `${way.body} ${way.money}`]), [
		[
			"A single job",
			"One clear piece of work, delivered in milestones. Each milestone is paid for as it starts.",
		],
		[
			"An ongoing workflow",
			"Ongoing work, task by task, across several stages. Each task is paid for when someone picks it up.",
		],
		[
			"A live session",
			"Book time with an expert: one session, a block, or a seat in a group. Your payment is held. It goes to them 24 hours after each session ends, unless you report a no-show. For a group seat, that's 24 hours after the last session.",
		],
	]);
});

Deno.test("ways: no copy uses a banned word or the absolutes #281 forbids", () => {
	const banned =
		/\b(squad|micro-agency|tvl|escrow|release|flat|next card)\b|until you approve|only paid when you approve|instant payout|no bidding|processing fee|card fee/i;
	const copy = [
		...Object.values(WAYS_COPY),
		...WAYS.flatMap((way) => [way.title, way.body, way.money, way.label]),
		...RAIL_IDS.flatMap((id) => [RAIL_COPY[id].title, RAIL_COPY[id].seeAll]),
	];
	for (const line of copy) assertFalse(banned.test(line), line);
});
// #endregion

// #region Rails
Deno.test("rails: no payload, no rails", () => {
	assertEquals(sliceRails(null), []);
});

Deno.test("rails: the four rails in §4.5's order, each with its See all into Explore", () => {
	const rails = sliceRails(fullPayload());
	assertEquals(
		rails.map((rail) => [rail.id, rail.title, rail.seeAllLabel, rail.seeAllHref]),
		[
			["services", "Services", "See all services", "/explore?category=services"],
			["projects", "Open projects", "See all projects", "/explore?category=projects"],
			["teams", "Ready-made teams", "See all teams", "/explore?category=teams"],
			["freelancers", "Freelancers", "See all freelancers", "/explore?category=freelancers"],
		],
	);
});

Deno.test("rails: no products rail, even with products in the feed", () => {
	assertFalse((RAIL_IDS as readonly string[]).includes("products"));
	const rails = sliceRails(fullPayload());
	assertFalse(rails.some((rail) => (rail.id as string) === "products"));
	assertFalse(rails.some((rail) => rail.items.some((item) => item.id.startsWith("prd-"))));
});

Deno.test("rails: a rail under four items is left out; four is enough", () => {
	assertEquals(RAIL_MIN_ITEMS, 4);
	const thin = payload({
		services: range(3).map((n) => service(n)),
		projects: range(4).map((n) => project(n)),
		people: [...range(3).map((n) => profile("teams", n))],
	});
	assertEquals(sliceRails(thin).map((rail) => rail.id), ["projects"]);
	assertEquals(sliceRails(payload({})), []);
});

Deno.test("rails: each rail is cut to eight, in the feed's own order", () => {
	assertEquals(RAIL_MAX_ITEMS, 8);
	const [services, projects, teams, freelancers] = sliceRails(fullPayload());
	assertEquals(services.items.map((item) => item.id), range(8).map((n) => `svc-${n}`));
	assertEquals(projects.items.length, 6);
	assertEquals(teams.items.length, 5);
	assertEquals(freelancers.items.length, 8);
	assertEquals(railLabel(services), "Services, 8 items");
});

Deno.test("rails: a paid placement is left out, and can thin a rail out of sight", () => {
	const items = range(5).map((n) => service(n, { sponsored: n <= 2 }));
	assertEquals(sliceRails(payload({ services: items })), []);
	const more = range(6).map((n) => service(n, { sponsored: n === 1 }));
	const [rail] = sliceRails(payload({ services: more }));
	assertEquals(rail.items.map((item) => item.id), ["svc-2", "svc-3", "svc-4", "svc-5", "svc-6"]);
});

Deno.test("rails: hrefs follow Explore's click matrix — a listing to /view, a profile to its handle", () => {
	const [services, projects, teams, freelancers] = sliceRails(fullPayload());
	assertEquals(services.items[0].href, "/view/svc-1?type=services");
	assertEquals(projects.items[0].href, "/view/prj-1?type=projects");
	assertEquals(teams.items[0].href, "/@teams1");
	assertEquals(freelancers.items[0].href, "/@freelancers1");
});

Deno.test("rails: a card carries only what it prints", () => {
	const [services, , , freelancers] = sliceRails(fullPayload());
	assertEquals(services.items[0], {
		id: "svc-1",
		kind: "listing",
		title: "Service 1",
		href: "/view/svc-1?type=services",
		ownerName: "Owner svc1",
		avatar: "/test_images/svc1.jpg",
		cover: "/test_images/cover_1.jpg",
		summary: null,
		detail: null,
		price: "£150 / project",
	});
	assertEquals(freelancers.items[0].kind, "profile");
	assertEquals(freelancers.items[0].detail, "Brand and web design");
	assertEquals(freelancers.items[0].cover, "/test_images/banner_1.jpg");
});

Deno.test("rails: a brief is text-forward — its description, its stages as meta text, its budget", () => {
	const briefs = range(4).map((n) =>
		project(n, {
			summary: n === 1 ? " Ship the app on iOS and Android. " : "",
			phases: n === 1 ? ["Architecture", " ", "iOS build", "QA"] : [],
			cover: "/test_images/client_banner.jpg",
			budgetMinor: n === 2 ? undefined : 7600000,
		})
	);
	const [rail] = sliceRails(payload({ projects: briefs }));
	assertEquals(rail.items[0], {
		id: "prj-1",
		kind: "brief",
		title: "Project 1",
		href: "/view/prj-1?type=projects",
		ownerName: "Owner client1",
		avatar: "/test_images/client1.jpg",
		cover: null,
		summary: "Ship the app on iOS and Android.",
		detail: "Architecture · iOS build · QA",
		price: "£76,000",
	});
	assertEquals(rail.items[1].summary, null);
	assertEquals(rail.items[1].detail, null);
	assertEquals(rail.items[1].price, null, "a brief without a budget prints none");
});

Deno.test("rails: a missing avatar falls back to DEFAULT_AVATAR_URL, a missing picture to none", () => {
	const items = range(4).map((n) =>
		service(n, { owner: owner(`svc${n}`, ""), media: n === 1 ? "" : undefined })
	);
	const [rail] = sliceRails(payload({ services: items }));
	assert(rail.items.every((item) => item.avatar === DEFAULT_AVATAR_URL));
	assert(rail.items.every((item) => item.cover === null));
	const people = range(4).map((n) => profile("teams", n, { cover: "  ", craft: "" }));
	const [teams] = sliceRails(payload({ people }));
	assert(teams.items.every((item) => item.cover === null && item.detail === null));
});

Deno.test("rails: a price only where the payload carries a real figure, by Explore's starting-price rule", () => {
	assertEquals(
		servicePriceLine(
			service(1, { serviceType: "Pipeline", ticketPrice: 95, priceMinor: undefined }),
		),
		"from £47.50 / ticket",
	);
	assertEquals(
		servicePriceLine(service(1, { serviceType: "Session", sessionPrice: 80 })),
		"£80 / session",
	);
	assertEquals(
		servicePriceLine(service(1, { serviceType: "Group Session", sessionPrice: 25 })),
		"£25 / seat",
	);
	assertEquals(servicePriceLine(service(1, { priceMinor: 150000 })), "£1,500 / project");
	assertEquals(servicePriceLine(service(1, { priceMinor: undefined })), null, "no figure: none");
	assertEquals(servicePriceLine(service(1, { priceMinor: 0 })), null, "never a confident zero");

	const freelancers = range(4).map((n) =>
		profile("freelancers", n, {
			servicePrices: n === 1 ? [120, 300] : undefined,
			serviceCurrency: n === 1 ? "GBP" : undefined,
		})
	);
	const teams = range(4).map((n) => profile("teams", n));
	const [teamRail, freelancerRail] = sliceRails(payload({ people: [...teams, ...freelancers] }));
	assertEquals(freelancerRail.items.map((item) => item.price), ["from £120", null, null, null]);
	assert(teamRail.items.every((item) => item.price === null), "a team carries no price");
});

Deno.test("rails: money prints in the listing's own currency, whole amounts without zero pence", () => {
	assertEquals(railMoney({ minor: 4750, currency: "GBP" }), "£47.50");
	assertEquals(railMoney({ minor: 200000, currency: "GBP" }), "£2,000");
	assertEquals(railMoney({ minor: 9000, currency: "USD" }), "US$90");
});

Deno.test("rails: the microcopy is §4.5's", () => {
	assertEquals(railStepLabel("Services", "back"), "Scroll Services back");
	assertEquals(railStepLabel("Services", "forward"), "Scroll Services forward");
	assertEquals(railByline("Northwind Studio"), "by Northwind Studio");
	assertEquals(railTrackId("services"), "lp-rail-services");
});

Deno.test("rails: a monogram is the name's first and last initials", () => {
	assertEquals(railMonogram("Tomasz Wójcik"), "TW");
	assertEquals(railMonogram("Studio Fern"), "SF");
	assertEquals(railMonogram("Saoirse Mary Byrne"), "SB");
	assertEquals(railMonogram("juno"), "J");
	assertEquals(railMonogram("  (North) Loop "), "NL");
	assertEquals(railMonogram("Ève Ålund"), "ÈÅ");
	assertEquals(railMonogram(""), "");
});
// #endregion
