import type {
	EducationEntry,
	ExperienceEntry,
	MemberEntry,
	ProfileKind,
	ProfileLanguage,
	ProfileTab,
	ProfileTabPayload,
	ProfileView,
	ReviewEntry,
	VerificationTier,
} from "@projective/types/profile";
import type { ExploreOwner, ProfileItem } from "@projective/types/explore";
import {
	ARTICLES,
	BUSINESSES,
	FREELANCERS,
	PRODUCTS,
	PROJECTS,
	SERVICES,
	TEAMS,
	USERS,
} from "../explore/fixtures.ts";
import { resolveSkills } from "../explore/skills.ts";

/**
 * profile fixtures — the fat {@link ProfileBackendService}'s in-memory answer for a public profile
 * (`/[handle]`), while `PROFILE_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10).
 *
 * Rather than author a third parallel corpus, this DERIVES a rich {@link ProfileView} + tab payloads
 * deterministically from the existing discovery fixtures (`@projective/backend/services/explore`) — so
 * a profile always agrees with the explore card that linked to it, and the live path (RLS-scoped
 * `org.users_public` + the profile tables) replaces this builder behind the same gate with zero shape
 * churn (the projection is already the SSOT {@link ProfileViewSchema}). No RNG — a small handle hash
 * gives stable per-profile variation (SSR/resume safe).
 */

// #region Deterministic helpers
/** Strip a leading `@` and lower-case — the lookup + hash key. */
function bareHandle(handle: string): string {
	return handle.replace(/^@+/, "").toLowerCase();
}

/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable). */
function hash(seed: string): number {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	return h;
}

/** Pick `n` distinct entries from `pool`, offset by the seed (stable, wraps). */
function pick<T>(pool: readonly T[], n: number, seed: number): T[] {
	const out: T[] = [];
	for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(seed + i) % pool.length]);
	return out;
}

function unsplash(id: string, w: number, h: number): string {
	return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&h=${h}&q=75`;
}

function face(id: string): string {
	return `https://images.unsplash.com/photo-${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;
}
// #endregion

// #region Pools
const LANGUAGE_LABELS: Record<string, string> = {
	EN: "English",
	FR: "French",
	DE: "German",
	ES: "Spanish",
	IT: "Italian",
	JP: "Japanese",
	KR: "Korean",
	AR: "Arabic",
	PT: "Portuguese",
	NL: "Dutch",
};

const LOCATIONS: ReadonlyArray<ProfileView["location"]> = [
	{ city: "London", country: "United Kingdom", timezone: "Europe/London" },
	{ city: "Lisbon", country: "Portugal", timezone: "Europe/Lisbon" },
	{ city: "Berlin", country: "Germany", timezone: "Europe/Berlin" },
	{ city: "New York", country: "United States", timezone: "America/New_York" },
	{ city: "Tokyo", country: "Japan", timezone: "Asia/Tokyo" },
	{ city: "Toronto", country: "Canada", timezone: "America/Toronto" },
	{ city: "Sydney", country: "Australia", timezone: "Australia/Sydney" },
];

const RESPONSE_TIMES = [
	"Usually responds within 1 hour",
	"Usually responds within 2 hours",
	"Usually responds within a few hours",
	"Usually responds within a day",
];

const BANNERS = [
	"1618005182384-a83a8bd57fbe",
	"1550684848-fac1c5b4e853",
	"1558655146-9f40138edfeb",
	"1487014679447-9f8336841d58",
	"1499750310107-5fef28a66643",
	"1461749280684-dccba630e2f6",
];

const FACES = [
	"1487412720507-e7ab37603c6f",
	"1519085360753-af0119f7cbe7",
	"1524504388940-b1c1722653e1",
	"1508214751196-bcfd4ca60f91",
	"1500648767791-00dcc994a43e",
	"1544005313-94ddf0286df2",
];

/** All discovery profile rows keyed by bare handle — the "known profile" lookup. */
const KNOWN: Record<string, ProfileItem> = {};
for (const row of [...FREELANCERS, ...USERS, ...TEAMS, ...BUSINESSES]) {
	KNOWN[bareHandle(row.owner.handle)] = row;
}

/** Map the discovery entity type to the profile kind that drives the tab matrix. */
function kindOf(type: ProfileItem["type"]): ProfileKind {
	switch (type) {
		case "freelancers":
			return "freelancer";
		case "teams":
			return "team";
		case "businesses":
			return "business";
		default:
			return "client";
	}
}
// #endregion

// #region Derivation
function languagesOf(codes: readonly string[] | undefined, seed: number): ProfileLanguage[] {
	const src = codes && codes.length ? codes : ["EN"];
	return src.map((code, i) => ({
		code,
		label: LANGUAGE_LABELS[code] ?? code,
		level: i === 0 ? "native" : (seed + i) % 2 === 0 ? "fluent" : "professional",
	}));
}

/** Ladder the attained tiers up to `top`. */
function tiersUpTo(top: VerificationTier): VerificationTier[] {
	const ladder: VerificationTier[] = ["L1", "L2", "L3", "architect"];
	const idx = ladder.indexOf(top);
	return ladder.slice(0, idx + 1);
}

function tierFor(kind: ProfileKind, verified: boolean, seed: number): VerificationTier {
	if (kind === "business") return "L3";
	if (verified && seed % 5 === 0) return "architect";
	if (verified) return "L2";
	return "L1";
}

/** A fuller multi-sentence story derived from a one-line summary + headline. */
function storyOf(name: string, headline: string, summary: string, kind: ProfileKind): string {
	const intro = kind === "team"
		? `${name} is a collaborative studio focused on ${headline.toLowerCase()}.`
		: kind === "business"
		? `${name} works with independent talent and teams across ${headline.toLowerCase()}.`
		: `I'm ${name}, ${headline.toLowerCase()}.`;
	return [
		intro,
		summary,
		"Over the past few years the focus has been shipping work that is measured, accountable, and built to last — every engagement structured in clear stages with the payment held safely until each milestone is signed off.",
	].join(" ");
}

/**
 * Build the {@link ProfileView} for a handle. A known discovery handle derives its identity from that
 * row; any other (non-reserved) handle synthesises a deterministic freelancer-shaped profile so every
 * handle in the stub resolves to a coherent page.
 */
export function findProfile(handle: string): ProfileView | null {
	const bare = bareHandle(handle);
	if (!bare) return null;
	const seed = hash(bare);
	const row = KNOWN[bare];

	const owner: ExploreOwner = row?.owner ?? {
		handle: `@${bare}`,
		name: bare.charAt(0).toUpperCase() + bare.slice(1),
		avatar: face(FACES[seed % FACES.length]),
		kind: "freelancer",
		verified: seed % 3 === 0,
	};
	const kind = row ? kindOf(row.type) : "freelancer";
	const name = row?.title ?? owner.name;
	const headline = row?.craft ?? "Independent maker on Projective";
	const summary = row?.summary ?? `${name} builds considered, high-craft work with clients worldwide.`;
	const verified = owner.verified ?? false;
	const tier = tierFor(kind, verified, seed);
	const location = LOCATIONS[seed % LOCATIONS.length];
	const rating = row?.rating ??
		{ asHelper: { value: 4.8, count: 40 + (seed % 30) }, asClient: { value: 4.7, count: 10 + (seed % 12) } };

	// Notable clients — a stable slice of the business/team rows (never the profile itself).
	const clientPool = [...BUSINESSES, ...TEAMS].filter((r) => bareHandle(r.owner.handle) !== bare);
	const notableClients = pick(clientPool, 4, seed).map((r) => ({
		name: r.title,
		logo: r.owner.avatar,
		handle: r.owner.handle,
		verified: r.owner.verified ?? false,
	}));

	return {
		handle: owner.handle,
		name,
		kind,
		avatar: owner.avatar,
		banner: unsplash(row?.cover ? bannerIdFrom(row.cover) : BANNERS[seed % BANNERS.length], 1600, 460),
		headline,
		story: storyOf(name, headline, summary, kind),
		skills: row?.skills ?? resolveSkills(["Design", "Product", "Strategy"]),
		languages: languagesOf(row?.languages, seed),
		notableClients,
		location,
		online: seed % 2 === 0,
		availabilityLabel: row?.workload?.status ??
			(kind === "business" ? "Actively hiring" : seed % 2 === 0 ? "Available for work" : "Booked — waitlist open"),
		// Sellers (freelancer/team) publish a bookable availability calendar; buyer entities don't.
		hasAvailability: kind === "freelancer" || kind === "team",
		responseTime: RESPONSE_TIMES[seed % RESPONSE_TIMES.length],
		rating,
		verified,
		tier,
		verifications: tiersUpTo(tier),
		followers: 120 + (seed % 900),
		following: 40 + (seed % 300),
		memberSince: row?.createdAt ?? "2026-01-15",
		userId: `user-${bare}`,
		metrics: metricsFor(kind, seed, bare),
	};
}

/** Recover the raw Unsplash photo id from a full cover URL (the explore fixtures embed it). */
function bannerIdFrom(cover: string): string {
	const m = cover.match(/photo-([0-9a-f-]+)/);
	return m ? m[1] : BANNERS[0];
}

/**
 * Per-tab count chips. Derived from the SAME fixed fixture slices the tab payloads render, so a chip
 * never diverges from the grid it labels — including the self-filtered team/business tab (the profile
 * itself is excluded from both the count and the grid). Reviews/members counts are the seed the payload
 * generators consume, so they agree too.
 */
function metricsFor(kind: ProfileKind, seed: number, bare: string): ProfileView["metrics"] {
	const seller = kind === "freelancer" || kind === "team";
	const teamsCount = TEAMS.filter((t) => bareHandle(t.owner.handle) !== bare).length;
	const businessesCount = BUSINESSES.filter((b) => bareHandle(b.owner.handle) !== bare).length;
	return {
		services: seller ? SERVICES.length : undefined,
		products: seller ? PRODUCTS.length : undefined,
		projects: PROJECTS.length,
		portfolio: seller ? Math.min(8, PRODUCTS.length) : undefined,
		education: kind === "freelancer" ? 2 : undefined,
		experience: kind === "freelancer" ? 3 : undefined,
		teams: seller ? teamsCount : undefined,
		businesses: businessesCount,
		articles: ARTICLES.length,
		reviews: 12 + (seed % 40),
		members: kind === "team" || kind === "business" ? 4 + (seed % 5) : undefined,
	};
}
// #endregion

// #region Tab payloads
/** Re-attribute item copies to the profile owner so the profile's OWN work reads as theirs. */
function reown<T extends { owner: ExploreOwner; id: string }>(
	items: readonly T[],
	owner: ExploreOwner,
	tag: string,
): T[] {
	return items.map((it, i) => ({ ...it, id: `${tag}-${bareHandle(owner.handle)}-${i}`, owner }));
}

function educationFor(name: string, seed: number): EducationEntry[] {
	return [
		{
			id: `edu-${seed}-0`,
			school: "Central Saint Martins",
			credential: "MA",
			field: "Communication Design",
			start: "2014",
			end: "2016",
			logo: unsplash("1523050854058-8df90110c9f1", 96, 96),
		},
		{
			id: `edu-${seed}-1`,
			school: "University of the Arts",
			credential: "BA (Hons)",
			field: "Graphic & Media Design",
			start: "2010",
			end: "2013",
			logo: unsplash("1592280771190-3e2e4d571952", 96, 96),
		},
	];
}

function experienceFor(name: string, seed: number): ExperienceEntry[] {
	const pool = [...TEAMS, ...BUSINESSES];
	return pick(pool, 3, seed).map((r, i) => ({
		id: `exp-${seed}-${i}`,
		org: r.title,
		role: i === 0 ? "Lead Designer" : i === 1 ? "Senior Designer" : "Product Designer",
		start: `${2016 + i * 2}`,
		end: i === 0 ? undefined : `${2018 + i * 2}`,
		current: i === 0,
		summary: `Drove design across ${r.craft.toLowerCase()} — shipping work end-to-end with cross-functional teams.`,
		logo: r.owner.avatar,
	}));
}

function membersFor(seed: number, count: number): MemberEntry[] {
	const roles = ["Founder", "Design lead", "Engineer", "Producer", "Strategist", "Motion lead"];
	return Array.from({ length: count }, (_, i) => ({
		handle: `@member-${(seed + i) % 97}`,
		name: ["Ivy Chen", "Marcus Lee", "Aria Novak", "Ravi Menon", "Sofia Marín", "Kenji Ito"][i % 6],
		avatar: face(FACES[(seed + i) % FACES.length]),
		role: roles[i % roles.length],
		kind: i % 3 === 0 ? "user" : "freelancer",
	}));
}

function reviewsFor(seed: number, count: number): ReviewEntry[] {
	const bodies = [
		"Delivered ahead of schedule and communicated clearly at every stage. Would hire again in a heartbeat.",
		"Exceptional craft and a genuine partner throughout. The staged payments made the whole thing feel safe.",
		"Turned a vague brief into something sharp and considered. Handoff was flawless.",
		"Reliable, thoughtful, and fast. Exactly the kind of collaborator you want on a hard project.",
	];
	return Array.from({ length: count }, (_, i) => ({
		id: `rv-${seed}-${i}`,
		authorName: ["Helia Finance", "Atlas Labs", "Noor Haddad", "Theo Almeida"][i % 4],
		authorHandle: ["@heliafinance", "@atlaslabs", "@noor", "@theo"][i % 4],
		authorAvatar: face(FACES[(seed + i + 2) % FACES.length]),
		role: i % 2 === 0 ? "client" : "freelancer",
		rating: 5 - (i % 2 === 0 ? 0 : (i % 3 === 0 ? 1 : 0)),
		date: `2026-0${(i % 6) + 1}-1${i % 9}`,
		body: bodies[i % bodies.length],
		contextTitle: pick(PROJECTS, 1, seed + i)[0]?.title,
	}));
}

/**
 * Build the payload for one profile tab. Only the collections relevant to the tab are populated; the
 * renderer reads what it needs. Item grids reuse the discovery fixtures so they flow into the same
 * explore cards.
 */
export function findProfileTab(handle: string, tab: ProfileTab): ProfileTabPayload | null {
	const profile = findProfile(handle);
	if (!profile) return null;
	const bare = bareHandle(handle);
	const seed = hash(bare + tab);
	// The owner attribution for the profile's own work.
	const owner: ExploreOwner = {
		handle: profile.handle,
		name: profile.name,
		avatar: profile.avatar,
		kind: profile.kind === "client" ? "user" : profile.kind === "freelancer" ? "freelancer" : profile.kind,
		verified: profile.verified,
	};

	const base: ProfileTabPayload = {
		handle: profile.handle,
		tab,
		items: [],
		openProjects: [],
		pastProjects: [],
		education: [],
		experience: [],
		members: [],
		reviews: [],
	};

	switch (tab) {
		case "services":
			return { ...base, items: reown(pick(SERVICES, SERVICES.length, seed), owner, "sv") };
		case "products":
			return { ...base, items: reown(pick(PRODUCTS, PRODUCTS.length, seed), owner, "pr") };
		case "portfolio":
			return { ...base, items: reown(pick(PRODUCTS, 8, seed), owner, "pf") };
		case "articles":
			return { ...base, items: reown(pick(ARTICLES, ARTICLES.length, seed), owner, "ar") };
		case "teams": {
			// Never list the profile itself among the teams it belongs to.
			const pool = TEAMS.filter((t) => bareHandle(t.owner.handle) !== bare);
			return { ...base, items: pick(pool, pool.length, seed) };
		}
		case "businesses": {
			const pool = BUSINESSES.filter((b) => bareHandle(b.owner.handle) !== bare);
			return { ...base, items: pick(pool, pool.length, seed) };
		}
		case "projects": {
			const all = reown(pick(PROJECTS, PROJECTS.length, seed), owner, "pj");
			// Split by a stable parity — half open/available, half past/completed.
			return {
				...base,
				openProjects: all.filter((_, i) => i % 2 === 0),
				pastProjects: all.filter((_, i) => i % 2 === 1),
			};
		}
		case "education":
			return { ...base, education: educationFor(profile.name, seed) };
		case "experience":
			return { ...base, experience: experienceFor(profile.name, seed) };
		case "members":
			return { ...base, members: membersFor(seed, profile.metrics.members ?? 5) };
		case "reviews":
			return {
				...base,
				reviews: reviewsFor(seed, profile.metrics.reviews ?? 8),
				reviewSummary: profile.rating,
			};
		case "about":
		default:
			return base;
	}
}
// #endregion
