import type {
	DepartmentEntry,
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
import { mockAvatar, mockCover } from "../../mocks/assets.ts";

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
	return mockCover(id, w, h, 75);
}

function face(id: string): string {
	return mockAvatar(id);
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

// #region Organisations (department-structured buyer entities)
/**
 * Organisations are a distinct buyer-only profile kind (root CLAUDE.md Decision #16 — the
 * `organisation` context) with a DEPARTMENT structure. There is no organisation corpus in the
 * discovery fixtures, so this module owns a small deterministic set: a handful of NAMED organisations
 * plus an open `org-*` handle convention, so any `/@org-<name>` also resolves to a coherent org page.
 * Everything derives from the handle (no RNG) so the Departments tab and the department-grouped Members
 * view always agree.
 */
interface OrgIdentity {
	name: string;
	headline: string;
	summary: string;
}

/** Named organisations — clean demo handles that resolve to a department-structured org profile. */
const NAMED_ORGS: Record<string, OrgIdentity> = {
	northwind: {
		name: "Northwind Collective",
		headline: "A product & brand studio, org-wide",
		summary:
			"Northwind commissions independent talent across design, engineering and operations — running every engagement in clear, escrow-backed stages.",
	},
	meridian: {
		name: "Meridian Labs",
		headline: "Research-led product organisation",
		summary:
			"Meridian brings together specialist teams to ship measured, accountable work for its partners worldwide.",
	},
	atlasgroup: {
		name: "Atlas Group",
		headline: "Multi-department delivery organisation",
		summary:
			"Atlas Group coordinates design, engineering, product and operations to deliver end-to-end for its clients.",
	},
};

/** The department catalogue an organisation draws from (stable order → deterministic slices). */
const DEPARTMENTS_POOL: ReadonlyArray<{ id: string; name: string; summary: string }> = [
	{ id: "design", name: "Design", summary: "Brand, product & experience design." },
	{ id: "engineering", name: "Engineering", summary: "Platform, web & infrastructure." },
	{ id: "operations", name: "Operations", summary: "Delivery, finance & people operations." },
	{ id: "product", name: "Product", summary: "Strategy, research & roadmap." },
	{ id: "marketing", name: "Marketing", summary: "Growth, content & communications." },
];

const MEMBER_NAMES = [
	"Ivy Chen",
	"Marcus Lee",
	"Aria Novak",
	"Ravi Menon",
	"Sofia Marín",
	"Kenji Ito",
	"Noah Bianchi",
	"Lena Fischer",
	"Diego Alvarez",
	"Priya Nair",
	"Tomas Berg",
	"Hana Suzuki",
];

/** Title-case an `org-north-wind` slug into "North Wind" for a synthesised organisation name. */
function titleize(bare: string): string {
	return bare
		.replace(/^org-/, "")
		.split(/[-_]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ") || "Organisation";
}

/** Resolve a handle to its organisation identity, or `null` if it isn't an organisation. */
function resolveOrg(bare: string): OrgIdentity | null {
	if (NAMED_ORGS[bare]) return NAMED_ORGS[bare];
	if (bare.startsWith("org-")) {
		const name = titleize(bare);
		return {
			name,
			headline: "A multi-department organisation on Projective",
			summary:
				`${name} commissions independent talent across its departments, running every engagement in clear, escrow-backed stages.`,
		};
	}
	return null;
}

/**
 * The organisation's roster — its departments AND its members, built together so the two always agree
 * (a department's `memberCount` is exactly the members assigned to it, and every member's
 * `departments` reference a real department). Members may sit in MORE than one department (root
 * CLAUDE.md — Part 2.2, multi-department assignment): ~1 in 4 gets a second department, and the grouped
 * Members view renders such a member under each. Derived only from the bare handle → stable across the
 * Departments and Members tabs.
 */
function orgRoster(bare: string): { departments: DepartmentEntry[]; members: MemberEntry[] } {
	const dSeed = hash(bare + ":depts");
	const mSeed = hash(bare + ":members");
	const deptCount = 3 + (dSeed % 3); // 3–5 departments
	const base = DEPARTMENTS_POOL.slice(0, deptCount);
	const perDept = 2 + (dSeed % 2); // 2–3 primary members per department

	const members: MemberEntry[] = [];
	let idx = 0;
	for (let d = 0; d < base.length; d++) {
		const dept = base[d];
		for (let k = 0; k < perDept; k++) {
			const name = MEMBER_NAMES[idx % MEMBER_NAMES.length];
			// ~1 in 4 members also belong to the next department (multi-department assignment).
			const multi = base.length > 1 && (mSeed + idx) % 4 === 0;
			const departments = multi ? [dept.id, base[(d + 1) % base.length].id] : [dept.id];
			const role = k === 0
				? `${dept.name} lead`
				: `${dept.name} ${["Specialist", "Associate", "Manager"][k % 3]}`;
			members.push({
				handle: `@${bare}-${idx}`,
				name,
				avatar: face(FACES[(mSeed + idx) % FACES.length]),
				role,
				kind: idx % 3 === 0 ? "user" : "freelancer",
				departments,
			});
			idx++;
		}
	}

	const departments: DepartmentEntry[] = base.map((d) => {
		const inDept = members.filter((m) => m.departments.includes(d.id));
		// The department's OWN designated lead (role `<Dept> lead`), not a multi-department member whose
		// lead role belongs to another department.
		const lead = inDept.find((m) => m.role === `${d.name} lead`) ?? inDept[0];
		return {
			id: d.id,
			name: d.name,
			summary: d.summary,
			leadHandle: lead?.handle,
			memberCount: inDept.length,
		};
	});
	return { departments, members };
}
// #endregion

// #region Derivation
/** Proficiency ramp — the first language is native, then descending, so the color-coded chips (Part 4)
 * read as a legible ladder rather than a random pair. */
const LEVEL_RAMP: ProfileLanguage["level"][] = [
	"native",
	"fluent",
	"professional",
	"conversational",
	"basic",
];

function languagesOf(codes: readonly string[] | undefined, seed: number): ProfileLanguage[] {
	const src = codes && codes.length ? codes : ["EN"];
	return src.map((code, i) => ({
		code,
		label: LANGUAGE_LABELS[code] ?? code,
		// Ramp by position, nudged by the seed so a two-language profile isn't always native+fluent.
		level: i === 0 ? "native" : LEVEL_RAMP[Math.min(1 + ((seed + i) % 4), LEVEL_RAMP.length - 1)],
	}));
}

/** Ladder the attained tiers up to `top`. */
function tiersUpTo(top: VerificationTier): VerificationTier[] {
	const ladder: VerificationTier[] = ["L1", "L2", "L3", "architect"];
	const idx = ladder.indexOf(top);
	return ladder.slice(0, idx + 1);
}

function tierFor(kind: ProfileKind, verified: boolean, seed: number): VerificationTier {
	if (kind === "business" || kind === "organisation") return "L3";
	if (verified && seed % 5 === 0) return "architect";
	if (verified) return "L2";
	return "L1";
}

/** A fuller multi-sentence story derived from a one-line summary + headline. */
function storyOf(name: string, headline: string, summary: string, kind: ProfileKind): string {
	const intro = kind === "team"
		? `${name} is a collaborative studio focused on ${headline.toLowerCase()}.`
		: kind === "organisation"
		? `${name} is a multi-department organisation commissioning work across its teams.`
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
	// A known discovery row wins; otherwise the handle may resolve as an organisation; else it
	// synthesises a freelancer-shaped profile so every handle in the stub resolves to a coherent page.
	const org = row ? null : resolveOrg(bare);

	const owner: ExploreOwner = row?.owner ?? (org
		? {
			handle: `@${bare}`,
			name: org.name,
			// Organisations use a square brand-mark banner crop as their avatar (a logo, not a face).
			avatar: unsplash(BANNERS[seed % BANNERS.length], 96, 96),
			kind: "business",
			verified: true,
		}
		: {
			handle: `@${bare}`,
			name: bare.charAt(0).toUpperCase() + bare.slice(1),
			avatar: face(FACES[seed % FACES.length]),
			kind: "freelancer",
			verified: seed % 3 === 0,
		});
	const kind: ProfileKind = org ? "organisation" : row ? kindOf(row.type) : "freelancer";
	const name = org?.name ?? row?.title ?? owner.name;
	const headline = org?.headline ?? row?.craft ?? "Independent maker on Projective";
	const summary = org?.summary ?? row?.summary ??
		`${name} builds considered, high-craft work with clients worldwide.`;
	const verified = owner.verified ?? false;
	const tier = tierFor(kind, verified, seed);
	const location = LOCATIONS[seed % LOCATIONS.length];
	const rating = row?.rating ??
		{
			asHelper: { value: 4.8, count: 40 + (seed % 30) },
			asClient: { value: 4.7, count: 10 + (seed % 12) },
		};

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
		banner: unsplash(
			row?.cover ? bannerIdFrom(row.cover) : BANNERS[seed % BANNERS.length],
			1600,
			460,
		),
		headline,
		story: storyOf(name, headline, summary, kind),
		skills: row?.skills ?? resolveSkills(["Design", "Product", "Strategy"]),
		languages: languagesOf(row?.languages, seed),
		notableClients,
		location,
		online: seed % 2 === 0,
		availabilityLabel: row?.workload?.status ??
			(kind === "organisation"
				? "Actively commissioning"
				: kind === "business"
				? "Actively hiring"
				: seed % 2 === 0
				? "Available for work"
				: "Booked — waitlist open"),
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
	// Organisations carry a real department + member roster (derived from the handle), so their
	// Departments/Members chips read the SAME roster the tabs render (never divergent).
	const roster = kind === "organisation" ? orgRoster(bare) : null;
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
		members: roster
			? roster.members.length
			: kind === "team" || kind === "business"
			? 4 + (seed % 5)
			: undefined,
		departments: roster ? roster.departments.length : undefined,
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

function educationFor(_name: string, seed: number): EducationEntry[] {
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

function experienceFor(_name: string, seed: number): ExperienceEntry[] {
	const pool = [...TEAMS, ...BUSINESSES];
	return pick(pool, 3, seed).map((r, i) => ({
		id: `exp-${seed}-${i}`,
		org: r.title,
		role: i === 0 ? "Lead Designer" : i === 1 ? "Senior Designer" : "Product Designer",
		start: `${2016 + i * 2}`,
		end: i === 0 ? undefined : `${2018 + i * 2}`,
		current: i === 0,
		summary:
			`Drove design across ${r.craft.toLowerCase()} — shipping work end-to-end with cross-functional teams.`,
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
		// Team/business rosters are flat (no departments) — only organisations group by department.
		departments: [],
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
		// Map the profile kind onto the narrower discovery-owner kind (organisation reads as a business
		// buyer for attribution; client reads as a plain user).
		kind: profile.kind === "client"
			? "user"
			: profile.kind === "freelancer"
			? "freelancer"
			: profile.kind === "team"
			? "team"
			: "business",
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
		departments: [],
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
		case "members": {
			// Organisations group their roster by department (multi-department members included); every
			// other entity has a flat roster.
			if (profile.kind === "organisation") {
				const { members, departments } = orgRoster(bare);
				return { ...base, members, departments };
			}
			return { ...base, members: membersFor(seed, profile.metrics.members ?? 5) };
		}
		case "departments": {
			const { departments } = orgRoster(bare);
			return { ...base, departments };
		}
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
