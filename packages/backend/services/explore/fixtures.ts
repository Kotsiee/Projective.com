import { resolveSkills } from "./skills.ts";
import type {
	ArticleItem,
	CtaBanner,
	DualRating,
	HelpArticle,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
	ServiceType,
	SponsoredSlot,
} from "@projective/types/explore";

/**
 * Explore — static discovery fixtures (server side).
 *
 * The temporary discovery source, owned by the fat service layer: curated records shaped like their
 * eventual Zod-validated DB rows. `ExploreBackendService` reads these in stub mode; when the discovery
 * tables land, the same shapes validate the reads and this module is replaced by Supabase queries.
 * The app never imports this — it receives results via SSR props + the `/api/explore/*` routes.
 */

/**
 * Unsplash source builder (a self-contained copy — the backend cannot import the app's marketing
 * helper). Fixed transform params keep every thumbnail crisp, format-negotiated, and bandwidth-light.
 */
function unsplash(id: string, w = 900, h = 1100): string {
	return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&h=${h}&q=72`;
}

// #region Rating helpers
const dual = (helper: [number, number], client: [number, number]): DualRating => ({
	asHelper: { value: helper[0], count: helper[1] },
	asClient: { value: client[0], count: client[1] },
});
const helperOnly = (v: number, c: number): DualRating => ({ asHelper: { value: v, count: c } });
const clientOnly = (v: number, c: number): DualRating => ({ asClient: { value: v, count: c } });
// #endregion

// #region Owners
const OWNERS = {
	nova: {
		handle: "@ateliernova",
		name: "Atelier Nova",
		avatar: unsplash("1600880292203-757bb62b4baf", 160, 160),
		kind: "team",
		verified: true,
	},
	maris: {
		handle: "@marisdelacroix",
		name: "Maris Delacroix",
		avatar: unsplash("1494790108377-be9c29b29330", 160, 160),
		kind: "freelancer",
		verified: true,
	},
	north: {
		handle: "@northloop",
		name: "North Loop",
		avatar: unsplash("1633356122544-f134324a6cee", 160, 160),
		kind: "team",
	},
	ren: {
		handle: "@renkoda",
		name: "Ren Koda",
		avatar: unsplash("1507003211169-0a1dd7228f2d", 160, 160),
		kind: "freelancer",
		verified: true,
	},
	fern: {
		handle: "@studiofern",
		name: "Studio Fern",
		avatar: unsplash("1573496359142-b8d87734a5a2", 160, 160),
		kind: "team",
	},
	juno: {
		handle: "@juno",
		name: "Juno Park",
		avatar: unsplash("1519085360753-af0119f7cbe7", 160, 160),
		kind: "freelancer",
	},
	helia: {
		handle: "@heliafinance",
		name: "Helia Finance",
		avatar: unsplash("1611974789855-9c2a0a7236a3", 160, 160),
		kind: "business",
		verified: true,
	},
	atlas: {
		handle: "@atlaslabs",
		name: "Atlas Labs",
		avatar: unsplash("1451187580459-43490279c0fa", 160, 160),
		kind: "business",
	},
} as const satisfies Record<string, ProfileItem["owner"]>;
// #endregion

// #region Profiles (users / freelancers / teams / businesses)
export const FREELANCERS: ProfileItem[] = [
	{
		id: "fl-maris",
		type: "freelancers",
		title: "Maris Delacroix",
		craft: "Product design lead",
		owner: OWNERS.maris,
		cover: unsplash("1558655146-9f40138edfeb", 900, 500),
		delivered: 68,
		summary: "Senior product designer shaping design systems and end-to-end product work.",
		skills: resolveSkills(["UX", "Design systems", "Figma"]),
		rating: dual([5.0, 61], [4.9, 22]),
		// A promoted talent placement — surfaced as a subtle "Promoted" card badge.
		sponsored: true,
		// Includes a $5 loss-leader that the IQR fence trims, so the floor reads $120, not $5.
		servicePrices: [5, 120, 130, 140, 150, 160],
		products: 9,
		languages: ["EN", "FR"],
		highlights: [
			unsplash("1545235617-9465d2a55698", 200, 200),
			unsplash("1467232004584-a241de8bcf5d", 200, 200),
			unsplash("1620641788421-7a1c342ea42e", 200, 200),
		],
		workload: { level: 70, status: "Booked till Aug 4 · then ~15 hrs/week" },
		createdAt: "2026-06-30",
	},
	{
		id: "fl-ren",
		type: "freelancers",
		title: "Ren Koda",
		craft: "3D & spatial interfaces",
		owner: OWNERS.ren,
		cover: unsplash("1633356122544-f134324a6cee", 900, 500),
		delivered: 51,
		summary: "3D artist and creative technologist building spatial, WebGL-driven experiences.",
		skills: resolveSkills(["WebGL", "Blender", "Three.js"]),
		rating: dual([4.9, 44], [4.8, 9]),
		servicePrices: [8, 150, 160, 170, 180, 200],
		products: 6,
		languages: ["EN", "JP"],
		highlights: [
			unsplash("1536240478700-b869070f9279", 200, 200),
			unsplash("1633356122544-f134324a6cee", 200, 200),
			unsplash("1550745165-9bc0b252726f", 200, 200),
		],
		workload: { level: 92, status: "Fully booked · waitlist open" },
		createdAt: "2026-07-02",
	},
	{
		id: "fl-juno",
		type: "freelancers",
		title: "Juno Park",
		craft: "Frontend engineering",
		owner: OWNERS.juno,
		cover: unsplash("1487014679447-9f8336841d58", 900, 500),
		delivered: 77,
		summary: "Frontend engineer specialising in Preact, signals, and accessible interfaces.",
		skills: resolveSkills(["Preact", "Signals", "A11y"]),
		rating: dual([5.0, 70], [4.7, 15]),
		servicePrices: [90, 130, 135, 175],
		products: 3,
		languages: ["EN", "KR"],
		highlights: [
			unsplash("1467232004584-a241de8bcf5d", 200, 200),
			unsplash("1518432031352-d6fc5c10da5a", 200, 200),
			unsplash("1550745165-9bc0b252726f", 200, 200),
		],
		workload: { level: 28, status: "Available now · ~25 hrs/week" },
		createdAt: "2026-07-05",
	},
];

export const USERS: ProfileItem[] = [
	{
		id: "us-noor",
		type: "users",
		title: "Noor Haddad",
		craft: "Creative director",
		owner: {
			handle: "@noor",
			name: "Noor Haddad",
			avatar: unsplash("1544005313-94ddf0286df2", 160, 160),
			kind: "user",
		},
		cover: unsplash("1499750310107-5fef28a66643", 1200, 500),
		delivered: 34,
		summary: "Creative director hiring teams and occasionally taking on advisory work.",
		skills: resolveSkills(["Brand", "Strategy"]),
		rating: dual([4.8, 20], [4.9, 31]),
		languages: ["EN", "AR"],
		createdAt: "2026-06-20",
	},
	{
		id: "us-theo",
		type: "users",
		title: "Theo Almeida",
		craft: "Startup founder",
		owner: {
			handle: "@theo",
			name: "Theo Almeida",
			avatar: unsplash("1500648767791-00dcc994a43e", 160, 160),
			kind: "user",
		},
		cover: unsplash("1521737604893-d14cc237f11d", 1200, 500),
		delivered: 12,
		summary: "Founder assembling teams for early-stage product bets.",
		skills: resolveSkills(["Product", "Growth"]),
		rating: dual([4.6, 6], [4.8, 18]),
		languages: ["EN", "PT"],
		createdAt: "2026-07-01",
	},
];

export const TEAMS: ProfileItem[] = [
	{
		id: "tm-nova",
		type: "teams",
		title: "Atelier Nova",
		craft: "Brand systems & motion",
		owner: OWNERS.nova,
		cover: unsplash("1618005182384-a83a8bd57fbe", 1200, 500),
		delivered: 142,
		members: 5,
		summary: "A five-person studio delivering brand systems, motion, and Webflow builds.",
		skills: resolveSkills(["Identity", "Motion", "Webflow"]),
		rating: helperOnly(4.9, 118),
		languages: ["EN", "FR", "DE"],
		highlights: [
			unsplash("1626785774573-4b799315345d", 200, 200),
			unsplash("1536240478700-b869070f9279", 200, 200),
			unsplash("1620641788421-7a1c342ea42e", 200, 200),
		],
		createdAt: "2026-06-15",
	},
	{
		id: "tm-north",
		type: "teams",
		title: "North Loop",
		craft: "Full-stack product studio",
		owner: OWNERS.north,
		cover: unsplash("1461749280684-dccba630e2f6", 1200, 500),
		delivered: 203,
		members: 8,
		summary: "Full-stack product studio shipping realtime apps on Deno and Postgres.",
		skills: resolveSkills(["Deno", "Postgres", "Realtime"]),
		rating: helperOnly(4.8, 164),
		languages: ["EN", "ES"],
		highlights: [
			unsplash("1518432031352-d6fc5c10da5a", 200, 200),
			unsplash("1551288049-bebda4e38f71", 200, 200),
			unsplash("1467232004584-a241de8bcf5d", 200, 200),
		],
		createdAt: "2026-06-18",
	},
	{
		id: "tm-fern",
		type: "teams",
		title: "Studio Fern",
		craft: "Editorial & content ops",
		owner: OWNERS.fern,
		cover: unsplash("1499750310107-5fef28a66643", 1200, 500),
		delivered: 96,
		members: 4,
		summary: "Editorial studio running content strategy, copy, and SEO operations.",
		skills: resolveSkills(["Strategy", "Copy", "SEO"]),
		rating: helperOnly(4.7, 73),
		languages: ["EN", "IT"],
		highlights: [
			unsplash("1455390582262-044cdead277a", 200, 200),
			unsplash("1499750310107-5fef28a66643", 200, 200),
			unsplash("1552664730-d307ca884978", 200, 200),
		],
		createdAt: "2026-06-22",
	},
];

export const BUSINESSES: ProfileItem[] = [
	{
		id: "bz-helia",
		type: "businesses",
		title: "Helia Finance",
		craft: "Fintech · Series B",
		owner: OWNERS.helia,
		cover: unsplash("1551288049-bebda4e38f71", 1200, 500),
		delivered: 0,
		summary: "Fintech scale-up hiring design and engineering teams for its wallet product.",
		skills: resolveSkills(["Fintech", "Product"]),
		rating: clientOnly(4.9, 41),
		languages: ["EN", "DE"],
		createdAt: "2026-06-10",
	},
	{
		id: "bz-atlas",
		type: "businesses",
		title: "Atlas Labs",
		craft: "Data platform",
		owner: OWNERS.atlas,
		cover: unsplash("1551288259-cd19f3a1534e", 1200, 500),
		delivered: 0,
		summary: "Data platform company commissioning analytics and visualisation work.",
		skills: resolveSkills(["Data", "Analytics"]),
		rating: clientOnly(4.7, 28),
		languages: ["EN"],
		createdAt: "2026-06-12",
	},
];
// #endregion

// #region Services / Projects / Products / Articles
const SERVICE_SEED: Array<
	[string, string, keyof typeof OWNERS, string, string, string, ServiceType, string, string]
> = [
	[
		"brand-identity-sprint",
		"Brand identity sprint",
		"nova",
		"$4,800",
		"10-day delivery",
		"branding",
		"Pipeline",
		"A staged identity system — discovery, concept routes, and a final kit with a Webflow handoff.",
		"1626785774573-4b799315345d",
	],
	[
		"design-system-foundation",
		"Design-system foundation",
		"maris",
		"$3,200",
		"2-week delivery",
		"product",
		"Pipeline",
		"Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.",
		"1545235617-9465d2a55698",
	],
	[
		"landing-page-in-a-week",
		"Landing page in a week",
		"juno",
		"$2,400",
		"5-day delivery",
		"web",
		"One-Off",
		"One high-converting landing page — copy polish, responsive build, and analytics wired in five days.",
		"1467232004584-a241de8bcf5d",
	],
	[
		"realtime-mvp-build",
		"Realtime MVP build",
		"north",
		"$9,500",
		"4-week delivery",
		"product",
		"Pipeline",
		"A working realtime product MVP on Deno + Postgres, shipped in weekly milestones you sign off.",
		"1518432031352-d6fc5c10da5a",
	],
	[
		"product-launch-film",
		"Product launch film",
		"ren",
		"$6,100",
		"3-week delivery",
		"motion",
		"One-Off",
		"A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.",
		"1536240478700-b869070f9279",
	],
	[
		"portfolio-review-session",
		"Live portfolio review",
		"fern",
		"$180",
		"60-minute session",
		"content",
		"Session",
		"A booked 1:1 call — a working editor walks your portfolio and leaves a written action plan.",
		"1499750310107-5fef28a66643",
	],
];

/**
 * Per-service unit prices keyed by seed id. Pipeline services carry a standard `ticketPrice` (the card
 * shows a 0.5×–2.0× workload range around it); Session services carry a `sessionPrice`. One-Off
 * services keep only their fixed `price` string.
 */
const SERVICE_UNIT_PRICE: Record<string, { ticketPrice?: number; sessionPrice?: number }> = {
	"brand-identity-sprint": { ticketPrice: 240 },
	"design-system-foundation": { ticketPrice: 180 },
	"realtime-mvp-build": { ticketPrice: 320 },
	"portfolio-review-session": { sessionPrice: 180 },
};

export const SERVICES: ServiceItem[] = SERVICE_SEED.map(
	([id, title, owner, price, delivery, category, serviceType, blurb, photo], i) => ({
		id: `sv-${id}`,
		type: "services",
		title,
		owner: OWNERS[owner],
		price,
		delivery,
		category,
		serviceType,
		...SERVICE_UNIT_PRICE[id],
		summary: blurb,
		skills: resolveSkills([category, "design"]),
		rating: OWNERS[owner].kind === "team" ? helperOnly(4.8, 40 + i) : dual([4.9, 30 + i], [4.7, 8]),
		media: unsplash(photo, 800, 600),
		// The first service is a promoted placement — surfaced as a subtle "Promoted" card badge.
		sponsored: i === 0,
		createdAt: `2026-07-0${(i % 6) + 1}`,
	}),
);

const PROJECT_SEED: Array<
	[string, string, keyof typeof OWNERS, string, string, string[], string[], string, string]
> = [
	[
		"helia-wallet-redesign",
		"Helia wallet redesign",
		"helia",
		"Hiring · Step 1",
		"$48,000 held safe",
		["Product designer", "Frontend", "Motion"],
		["Discovery", "Flows & IA", "Hi-fi design", "Build", "QA & handoff"],
		"hiring",
		"Reimagine the Helia consumer wallet end-to-end — a research-backed redesign of onboarding, transfers, and card management, delivered as production-ready screens and a coded front end.",
	],
	[
		"atlas-analytics-platform",
		"Atlas analytics platform",
		"atlas",
		"In progress · Step 3",
		"$120,000 held safe",
		["Full-stack", "Data viz"],
		["Data model", "API layer", "Dashboards", "Realtime", "Hardening"],
		"in-progress",
		"Build the Atlas analytics platform: a multi-tenant dashboard suite over a streaming data model, with drill-downs, alerting, and a visualisation kit that scales to millions of rows.",
	],
	[
		"verdant-brand-refresh",
		"Verdant brand refresh",
		"helia",
		"Hiring · Step 1",
		"$32,000 held safe",
		["Brand lead", "Illustration"],
		["Audit", "Territory", "Identity", "Guidelines"],
		"hiring",
		"A full brand refresh for Verdant — audit the current identity, explore territories, and land a flexible logo system, palette, illustration language, and guidelines the team can run with.",
	],
	[
		"loop-mobile-app",
		"Loop mobile app",
		"atlas",
		"Planning · Step 0",
		"$76,000 held safe",
		["iOS", "Android", "Design"],
		["Scoping", "Design", "iOS build", "Android build", "Launch"],
		"planning",
		"Ship the Loop mobile app on iOS and Android from a validated prototype — native builds, offline-first sync, and an App Store / Play launch with staged rollouts.",
	],
	[
		"meridian-design-system",
		"Meridian design system",
		"helia",
		"In progress · Step 2",
		"$54,000 held safe",
		["Design systems", "Docs"],
		["Foundations", "Components", "Docs site", "Adoption"],
		"in-progress",
		"Stand up the Meridian design system — tokens and foundations, a governed component library, a searchable docs site, and a migration path that gets product teams onto it.",
	],
];

export const PROJECTS: ProjectItem[] = PROJECT_SEED.map(
	([id, title, owner, stage, budget, roles, phases, _stageKey, description], i) => ({
		id: `pj-${id}`,
		type: "projects",
		title,
		owner: OWNERS[owner],
		org: OWNERS[owner].name,
		stage,
		budget,
		roles,
		phases,
		summary: description,
		skills: resolveSkills(roles),
		rating: clientOnly(4.8, 20 + i),
		// The first project is a promoted placement — surfaced as a plain-text "Promoted" note.
		sponsored: i === 0,
		createdAt: `2026-07-0${(i % 6) + 1}`,
	}),
);

const PRODUCT_SEED: Array<
	[string, string, keyof typeof OWNERS, string, string, 1 | 2 | 3, string]
> = [
	["aurora-ui-kit", "Aurora UI kit", "nova", "$79", "ui-kit", 3, "1620641788421-7a1c342ea42e"],
	[
		"grain-lightroom-pack",
		"Grain — Lightroom pack",
		"ren",
		"$24",
		"presets",
		1,
		"1502920917128-1aa500764cbd",
	],
	[
		"motion-primitives",
		"Motion primitives",
		"juno",
		"$49",
		"templates",
		2,
		"1550745165-9bc0b252726f",
	],
	[
		"editorial-type-system",
		"Editorial type system",
		"fern",
		"$120",
		"templates",
		3,
		"1455390582262-044cdead277a",
	],
	[
		"dashboard-blocks",
		"Dashboard blocks",
		"north",
		"$65",
		"templates",
		2,
		"1551288049-bebda4e38f71",
	],
	[
		"iconography-set",
		"Iconography set — 640",
		"maris",
		"$38",
		"icons",
		1,
		"1516131206008-dd041a9764fd",
	],
	["3d-product-scenes", "3D product scenes", "ren", "$95", "3d", 2, "1633356122544-f134324a6cee"],
	[
		"notion-ops-suite",
		"Notion ops suite",
		"fern",
		"$29",
		"templates",
		1,
		"1499750310107-5fef28a66643",
	],
];

export const PRODUCTS: ProductItem[] = PRODUCT_SEED.map(
	([id, title, owner, price, category, span, photo], i) => ({
		id: `pr-${id}`,
		type: "products",
		title,
		owner: OWNERS[owner],
		price,
		category,
		span,
		summary: `${title} — a ready-to-buy download from ${OWNERS[owner].name}.`,
		skills: resolveSkills([category === "3d" ? "3D" : "design"]),
		rating: helperOnly(4.8, 25 + i),
		media: unsplash(photo, 800, span === 1 ? 600 : span === 2 ? 800 : 1000),
		// The first product is a promoted placement — surfaced as a subtle "Promoted" card badge.
		sponsored: i === 0,
		createdAt: `2026-07-0${(i % 6) + 1}`,
	}),
);

const ARTICLE_SEED: Array<[string, string, keyof typeof OWNERS, string, number, string]> = [
	[
		"hiring-a-team",
		"How to hire a whole team, not just one person",
		"fern",
		"hiring",
		6,
		"1522071820081-009f0129c71c",
	],
	[
		"escrow-explained",
		"Escrow, explained: how your money stays safe",
		"north",
		"payments",
		4,
		"1454165804606-c3d57bc86b40",
	],
	[
		"paying-step-by-step",
		"Paying step by step across stages",
		"maris",
		"payments",
		5,
		"1556740738-b6a63e27c4df",
	],
	[
		"running-a-small-team",
		"Running a small team without the chaos",
		"nova",
		"teams",
		7,
		"1552664730-d307ca884978",
	],
	[
		"getting-started",
		"Getting started on Projective",
		"juno",
		"getting-started",
		3,
		"1517048676732-d65bc937f952",
	],
];

export const ARTICLES: ArticleItem[] = ARTICLE_SEED.map(
	([id, title, owner, topic, readMinutes, photo], i) => ({
		id: `ar-${id}`,
		type: "articles",
		title,
		owner: OWNERS[owner],
		topic,
		readMinutes,
		summary: `${title} — a practical guide from the Projective team.`,
		skills: resolveSkills([topic]),
		media: unsplash(photo, 800, 500),
		createdAt: `2026-06-2${(i % 9) + 0}`,
	}),
);
// #endregion

// #region Promos + home feed
export const SPONSORED: SponsoredSlot[] = [
	{
		id: "sp-nova",
		eyebrow: "Promoted",
		title: "Book Atelier Nova's brand sprint",
		body: "A ten-day identity system with motion and a Webflow handoff. Two slots left this month.",
		media: unsplash("1626785774573-4b799315345d", 900, 600),
		owner: OWNERS.nova,
		href: "/view/sv-brand-identity-sprint?type=services",
		cta: "View the sprint",
	},
];

export const HELP_ARTICLES: HelpArticle[] = [
	{ id: "hp-1", title: "How hiring a team works", minutes: 4, href: "/help/hiring" },
	{ id: "hp-2", title: "Keeping your payments safe", minutes: 3, href: "/help/payments" },
	{
		id: "hp-3",
		title: "Your first project, start to finish",
		minutes: 6,
		href: "/help/first-project",
	},
];

export const CTAS: Record<"freelancer" | "team", CtaBanner> = {
	freelancer: {
		id: "cta-freelancer",
		eyebrow: "Offer your skills",
		title: "Become a Freelancer",
		body:
			"Turn your craft into income. Set up services, get hired, and get paid safely at each step.",
		href: "/join?intent=freelancer",
		cta: "Start freelancing",
		tone: "primary",
	},
	team: {
		id: "cta-team",
		eyebrow: "Build together",
		title: "Launch a Team",
		body: "Assemble a micro-agency, take on bigger projects, and share the work — and the reward.",
		href: "/join?intent=team",
		cta: "Launch a team",
		tone: "neutral",
	},
};
// #endregion
