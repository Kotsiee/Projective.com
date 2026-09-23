/**
 * profiles.ts — the public profile's presentation layer for the development world: each seller's
 * SHOWCASE (the hero's six-slot grid), a freelancer's SELECTED WORK, an individual's certifications,
 * and the owner's privacy switches.
 *
 * Declared by persona / entity KEY, like everything in `world.ts`, and resolved in `resolve.ts`, so a
 * key that names nobody fails at generate time. Kept out of `world.ts` because nothing else in the
 * world reads it: these rows exist for `/[handle]` alone (`org.profile_showcase_items`,
 * `org.portfolios`, `org.certifications`, `org.profile_settings`).
 *
 * The rules the live write path enforces hold here too, because a seed that breaks them is a demo of a
 * state the product cannot reach:
 *  - Slot 1 is the thumbnail every card of the profile leads with, so it is a STILL (all seeded slots
 *    are, since `test_images/` carries no video).
 *  - A showcase slot is a RENDITION in the public `showcase` bucket (`purpose = 'showcase'`), laid out
 *    as the media pipeline writes one: `{owner}/showcase/{rendition}/full.{ext}`. Seeded renditions
 *    carry no WebP tiers; the reader serves the original, exactly as it does for a seeded avatar.
 *  - A certification is `verified` only where the platform would have checked it, and then it carries
 *    `verifiedDaysAgo` (the table's CHECK requires a `verified_at` for every verified row).
 *  - `allow_avatar_expand` defaults to OFF, so only the owners who opted in are listed with it on.
 */

// #region Types

/** One showcase slot: a still from `test_images/` and its alternative text. */
export interface ShowcaseSlotSpec {
	image: string;
	alt: string;
}

/** A profile's showcase — slot 1 first, at most six. `owner` is a persona OR an entity key. */
export interface ShowcaseSpec {
	owner: string;
	slots: ShowcaseSlotSpec[];
}

/** One "Selected work" piece on a freelancer's profile. */
export interface PortfolioSpec {
	persona: string;
	title: string;
	description: string;
	/** The piece's cover, from `test_images/`. */
	image: string;
	/** The client it was made for; omitted for undisclosed work. */
	client?: string;
	category?: string;
}

/** A certification on an individual's Experience section. */
export interface CertificationSpec {
	persona: string;
	name: string;
	issuer: string;
	issuedYear: string;
	expiresYear?: string;
	/** The issuer's public verification page — https only. */
	url?: string;
	/** Days since the platform checked it; present only for a verified certification. */
	verifiedDaysAgo?: number;
}

/** The owner's presentation switches, where they differ from the defaults. */
export interface SettingsSpec {
	owner: string;
	allowAvatarExpand?: boolean;
	showLocation?: boolean;
	showLocalTime?: boolean;
}

// #endregion

// #region Showcases

export const SHOWCASES: ShowcaseSpec[] = [
	{
		owner: "maris",
		slots: [
			{ image: "service_1.jpg", alt: "Design system component sheet for a fintech dashboard" },
			{ image: "banner_1.jpg", alt: "Workshop wall of journey maps and product flows" },
			{ image: "product_2.jpg", alt: "Mobile onboarding screens in light and dark themes" },
			{ image: "service_5.webp", alt: "Token audit laid out across three brand palettes" },
		],
	},
	{
		owner: "ren",
		slots: [
			{ image: "service_3.webp", alt: "Still from a 3D product launch film" },
			{ image: "product_5.webp", alt: "Packaging render with studio lighting" },
			{ image: "banner_2.jpg", alt: "Motion storyboard frames for a launch sequence" },
		],
	},
	{
		owner: "juno",
		slots: [
			{ image: "service_2.jpg", alt: "Accessible component library shown in a browser" },
			{ image: "product_1.jpg", alt: "Signal-driven dashboard running at sixty frames a second" },
			{ image: "banner_4.jpg", alt: "Keyboard navigation map for a data table" },
		],
	},
	{
		owner: "ines",
		slots: [
			{ image: "brandmark_6.jpg", alt: "Identity system for a coffee roaster" },
			{ image: "service_7.jpg", alt: "Brand guidelines spread with type and colour pages" },
			{ image: "banner_3.jpg", alt: "Launch assets across print and social" },
			{ image: "product_3.jpg", alt: "Packaging family in the new identity" },
			{ image: "service_4.webp", alt: "Logo construction grid" },
		],
	},
	{
		owner: "kwame",
		slots: [
			{ image: "service_6.webp", alt: "Realtime operations dashboard" },
			{ image: "banner_7.jpg", alt: "Architecture diagram for a Deno and Postgres service" },
		],
	},
	{
		owner: "saoirse",
		slots: [
			{ image: "banner_8.webp", alt: "Editorial feature spread with pull quotes" },
			{ image: "product_4.jpg", alt: "Magazine cover series" },
			{ image: "service_1.jpg", alt: "Typographic grid for a long-read layout" },
		],
	},
	{
		owner: "aiko",
		slots: [
			{ image: "product_6.jpg", alt: "Illustrated campaign poster" },
			{ image: "banner_9.webp", alt: "Character sheet for a children's app" },
			{ image: "service_3.webp", alt: "Spot illustrations for an onboarding flow" },
		],
	},
	{
		owner: "nova",
		slots: [
			{ image: "banner_6.webp", alt: "Atelier Nova studio work across identity and launch" },
			{ image: "brandmark_6.jpg", alt: "A roaster's identity system" },
			{ image: "service_7.jpg", alt: "Guidelines system delivered to a client team" },
		],
	},
	{
		owner: "north",
		slots: [
			{ image: "banner_9.webp", alt: "North Loop's realtime product work" },
			{ image: "service_6.webp", alt: "Live operations dashboard shipped for a logistics client" },
		],
	},
	{
		owner: "fern",
		slots: [
			{ image: "banner_8.webp", alt: "Studio Fern editorial and illustration work" },
			{ image: "product_4.jpg", alt: "Cover series for an independent magazine" },
		],
	},
];

// #endregion

// #region Selected work

export const PORTFOLIO: PortfolioSpec[] = [
	{
		persona: "maris",
		title: "Helia wallet design system",
		description: "A token-driven component library across web and native, shipped with its own contribution model.",
		image: "service_1.jpg",
		client: "Helia Finance",
		category: "Design systems",
	},
	{
		persona: "maris",
		title: "Checkout that explains itself",
		description: "A four-step purchase flow rebuilt around one visible total and plain-language fees.",
		image: "product_2.jpg",
		category: "Product design",
	},
	{
		persona: "maris",
		title: "Research-led onboarding",
		description: "Onboarding reworked from twelve interviews; activation up by a third in the first month.",
		image: "banner_1.jpg",
		client: "Atlas Labs",
		category: "Product design",
	},
	{
		persona: "ren",
		title: "Launch film for a smart speaker",
		description: "Forty-five seconds of product motion, modelled, lit and cut in-house.",
		image: "service_3.webp",
		category: "Motion",
	},
	{
		persona: "ren",
		title: "Packaging in 3D",
		description: "Photoreal packaging renders delivered before the first print run existed.",
		image: "product_5.webp",
		category: "3D",
	},
	{
		persona: "juno",
		title: "An accessible data table",
		description: "Keyboard-first sorting, filtering and virtualised rows that a screen reader can follow.",
		image: "service_2.jpg",
		category: "Frontend",
	},
	{
		persona: "juno",
		title: "Realtime analytics dashboard",
		description: "Preact and signals rendering thousands of live points without dropping a frame.",
		image: "product_1.jpg",
		client: "Atlas Labs",
		category: "Frontend",
	},
	{
		persona: "ines",
		title: "Almeida Coffee Co. identity",
		description: "Wordmark, packaging system and launch assets for a family roaster.",
		image: "brandmark_6.jpg",
		client: "Almeida Coffee Co.",
		category: "Brand identity",
	},
	{
		persona: "ines",
		title: "Guidelines people actually open",
		description: "A brand book rebuilt as a searchable site with ready-to-use templates.",
		image: "service_7.jpg",
		category: "Brand identity",
	},
	{
		persona: "kwame",
		title: "Live operations board",
		description: "A realtime Postgres-backed board for a dispatch team, built on Deno.",
		image: "service_6.webp",
		category: "Engineering",
	},
	{
		persona: "saoirse",
		title: "Long-read layout system",
		description: "An editorial grid and type scale for an independent magazine's web edition.",
		image: "banner_8.webp",
		category: "Editorial design",
	},
	{
		persona: "aiko",
		title: "Campaign illustration series",
		description: "Six posters and their social cut-downs for a city arts festival.",
		image: "product_6.jpg",
		category: "Illustration",
	},
];

// #endregion

// #region Certifications

export const CERTIFICATIONS: CertificationSpec[] = [
	{
		persona: "maris",
		name: "Certified Usability Analyst",
		issuer: "Human Factors International",
		issuedYear: "2021",
		url: "https://www.humanfactors.com/certification",
		verifiedDaysAgo: 120,
	},
	{
		persona: "juno",
		name: "Web Accessibility Specialist",
		issuer: "IAAP",
		issuedYear: "2023",
		expiresYear: "2026",
		url: "https://www.accessibilityassociation.org/certification",
		verifiedDaysAgo: 45,
	},
	{
		persona: "kwame",
		name: "AWS Certified Solutions Architect – Associate",
		issuer: "Amazon Web Services",
		issuedYear: "2022",
		expiresYear: "2025",
	},
	{
		persona: "lena",
		name: "UX Research Certification",
		issuer: "Nielsen Norman Group",
		issuedYear: "2020",
		url: "https://www.nngroup.com/ux-certification/",
	},
];

// #endregion

// #region Settings

export const PROFILE_SETTINGS: SettingsSpec[] = [
	{ owner: "maris", allowAvatarExpand: true },
	{ owner: "juno", allowAvatarExpand: true },
	{ owner: "ren", showLocalTime: false },
	{ owner: "theo", showLocation: false },
];

// #endregion
