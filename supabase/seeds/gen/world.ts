/**
 * world.ts — the hand-authored development world layered over the mock corpus.
 *
 * The discovery corpus (`packages/backend/mocks`) already names the identities the app renders:
 * `@marisdelacroix`, `@juno`, `@ateliernova`, `@heliafinance` and so on. What it does NOT model is
 * anything a running product accumulates — who is a member of what, who was hired into which stage,
 * which tickets were paid, who messaged whom, what is unread. That is this file.
 *
 * Two rules keep it honest:
 *
 *  1. **Corpus identities are never renamed.** A persona that IS a corpus principal carries that
 *     principal's handle (`corpusHandle`), so a listing owned by `@juno` in the app is owned by the
 *     same account in the database. The synthetic `<entity>-owner` accounts the earlier generator
 *     minted are replaced by real people (Inês owns Atelier Nova; Priya owns Helia Finance).
 *  2. **Everything references by key, never by id.** Ids are derived at emit time
 *     ({@link ../generate.ts}) through `uuidFor`, so a relationship declared here cannot dangle —
 *     an unknown key is a generator error, not a foreign-key violation at reset time.
 *
 * All timestamps are RELATIVE (`daysAgo`), so the seeded world always reads as recent activity
 * rather than a snapshot that ages out of the "last 30 days" views.
 */

// #region Personas
export type PersonaRole = "freelancer" | "client" | "operator";
export type KycState = "verified" | "pending" | "unverified";

export interface Education {
	school: string;
	credential: string;
	field: string;
	startYear: string;
	endYear: string | null;
}

export interface Experience {
	org: string;
	role: string;
	startYear: string;
	endYear: string | null;
	summary: string;
	/** A brandmark image (from `test_images/`) shown as the employer's logo. */
	logo?: string;
}

export interface Persona {
	key: string;
	/** The `org.users_public.username` and the `@handle` the app resolves. */
	handle: string;
	/** The corpus principal this persona IS (`@handle` form), when it is one. */
	corpusHandle?: string;
	name: string;
	headline: string;
	bio: string;
	city: string;
	country: string;
	timezone: string;
	languages: string[];
	/** `[language code, level]` per `org.user_languages`. */
	languageLevels: Array<
		[string, "native" | "fluent" | "professional" | "conversational" | "basic"]
	>;
	dob: string;
	role: PersonaRole;
	interests: string[];
	/** Skill slugs (seeded into `org.skills` + `org.user_skills` + `freelancer_profiles.skills`). */
	skills: string[];
	avatar?: string;
	banner?: string;
	workload?: number;
	kyc?: KycState;
	payoutReady?: boolean;
	plan?: "individual_pro";
	education?: Education[];
	experience?: Experience[];
	links?: Array<[string, string]>;
	/** Preferred display currency (`org.user_preferences`). */
	displayCurrency?: string;
	/** Days since the account was created. */
	joinedDaysAgo: number;
}

export const PERSONAS: Persona[] = [
	{
		key: "maris",
		handle: "marisdelacroix",
		corpusHandle: "@marisdelacroix",
		name: "Maris Delacroix",
		headline: "Product design lead — design systems and end-to-end product work",
		bio:
			"I lead product design for fintech and SaaS teams: from research and flows through to tokenised design systems that engineering can ship from. Twelve years in, still hands-on in Figma every day.",
		city: "London",
		country: "United Kingdom",
		timezone: "Europe/London",
		languages: ["English", "French"],
		languageLevels: [["en", "native"], ["fr", "fluent"]],
		dob: "1989-03-14",
		role: "freelancer",
		interests: ["fintech", "design systems", "accessibility"],
		skills: ["ux", "design-systems", "figma", "prototyping"],
		avatar: "profile_1.jpg",
		banner: "banner_1.jpg",
		workload: 70,
		kyc: "verified",
		payoutReady: true,
		plan: "individual_pro",
		education: [{
			school: "Central Saint Martins",
			credential: "BA (Hons)",
			field: "Graphic Design",
			startYear: "2008",
			endYear: "2011",
		}],
		experience: [
			{
				org: "Lumen Bank",
				role: "Senior Product Designer",
				startYear: "2019",
				endYear: "2023",
				summary: "Owned the consumer app's design system and led the savings product redesign.",
				logo: "brandmark_6.jpg",
			},
			{
				org: "Independent",
				role: "Product design lead",
				startYear: "2023",
				endYear: null,
				summary: "Design systems and end-to-end product work for early-stage and scaling teams.",
			},
		],
		links: [["website", "https://marisdelacroix.design"], [
			"linkedin",
			"https://linkedin.com/in/marisdelacroix",
		]],
		displayCurrency: "GBP",
		joinedDaysAgo: 420,
	},
	{
		key: "ren",
		handle: "renkoda",
		corpusHandle: "@renkoda",
		name: "Ren Koda",
		headline: "3D and motion designer — launch films, WebGL, packaging",
		bio:
			"Motion and 3D for product launches. I script, model and render the sixty seconds that make a product feel inevitable, and I art-direct packaging when the product is something you can hold.",
		city: "Berlin",
		country: "Germany",
		timezone: "Europe/Berlin",
		languages: ["English", "Japanese", "German"],
		languageLevels: [["ja", "native"], ["en", "fluent"], ["de", "conversational"]],
		dob: "1992-11-02",
		role: "freelancer",
		interests: ["motion", "3d", "packaging"],
		skills: ["webgl", "blender", "three-js", "motion-design"],
		avatar: "profile_2.webp",
		banner: "banner_2.jpg",
		workload: 92,
		kyc: "verified",
		payoutReady: true,
		experience: [{
			org: "Halcyon Motion",
			role: "Motion designer",
			startYear: "2020",
			endYear: "2024",
			summary: "Launch films and interactive 3D for consumer hardware brands.",
			logo: "brandmark_7.png",
		}],
		links: [["website", "https://renkoda.studio"]],
		displayCurrency: "EUR",
		joinedDaysAgo: 380,
	},
	{
		key: "juno",
		handle: "juno",
		corpusHandle: "@juno",
		name: "Juno Park",
		headline: "Frontend engineer — Preact, signals, accessibility",
		bio:
			"I build fast, accessible frontends and the landing pages that sell them. Preact and signals by preference, Deno on the server, and an audit pass on every page before it ships.",
		city: "Lisbon",
		country: "Portugal",
		timezone: "Europe/Lisbon",
		languages: ["English", "Korean", "Portuguese"],
		languageLevels: [["ko", "native"], ["en", "fluent"], ["pt", "conversational"]],
		dob: "1995-06-21",
		role: "freelancer",
		interests: ["frontend", "accessibility", "performance"],
		skills: ["preact", "typescript", "a11y", "deno"],
		avatar: "profile_3.jpg",
		banner: "banner_4.jpg",
		workload: 28,
		kyc: "pending",
		payoutReady: false,
		education: [{
			school: "KAIST",
			credential: "BSc",
			field: "Computer Science",
			startYear: "2013",
			endYear: "2017",
		}],
		links: [["github", "https://github.com/junopark"]],
		displayCurrency: "EUR",
		joinedDaysAgo: 210,
	},
	{
		key: "noor",
		handle: "noor",
		corpusHandle: "@noor",
		name: "Noor Haddad",
		headline: "Creative director — hires teams, occasionally takes on advisory work",
		bio:
			"Creative director running a small studio in Dubai. I commission brand, web and campaign work from independent talent and occasionally advise founders on creative direction.",
		city: "Dubai",
		country: "United Arab Emirates",
		timezone: "Asia/Dubai",
		languages: ["English", "Arabic"],
		languageLevels: [["ar", "native"], ["en", "fluent"]],
		dob: "1986-01-30",
		role: "client",
		interests: ["branding", "web", "campaigns"],
		skills: [],
		avatar: "profile_4.jpg",
		banner: "banner_5.jpg",
		displayCurrency: "AED",
		joinedDaysAgo: 300,
	},
	{
		key: "theo",
		handle: "theo",
		corpusHandle: "@theo",
		name: "Theo Almeida",
		headline: "Founder, Almeida Coffee Co. — brand and packaging",
		bio:
			"I run a specialty coffee roastery in São Paulo and buy design work for our packaging, retail and web presence.",
		city: "São Paulo",
		country: "Brazil",
		timezone: "America/Sao_Paulo",
		languages: ["Portuguese", "English"],
		languageLevels: [["pt", "native"], ["en", "professional"]],
		dob: "1990-09-09",
		role: "client",
		interests: ["packaging", "branding", "retail"],
		skills: [],
		avatar: "profile_5.jpg",
		displayCurrency: "BRL",
		joinedDaysAgo: 140,
	},
	{
		key: "ines",
		handle: "inesduarte",
		name: "Inês Duarte",
		headline: "Brand designer — founder of Atelier Nova",
		bio:
			"I founded Atelier Nova to do identity work properly: strategy first, then a system that survives contact with a real marketing team. Ten years of brand work across Portugal and the UK.",
		city: "Porto",
		country: "Portugal",
		timezone: "Europe/Lisbon",
		languages: ["Portuguese", "English", "Spanish"],
		languageLevels: [["pt", "native"], ["en", "fluent"], ["es", "professional"]],
		dob: "1987-04-17",
		role: "freelancer",
		interests: ["branding", "typography", "strategy"],
		skills: ["branding", "identity-systems", "typography", "art-direction"],
		avatar: "profile_6.jpg",
		banner: "banner_3.jpg",
		workload: 55,
		kyc: "verified",
		payoutReady: true,
		education: [{
			school: "Faculdade de Belas Artes, Universidade do Porto",
			credential: "MA",
			field: "Communication Design",
			startYear: "2009",
			endYear: "2011",
		}],
		links: [["website", "https://ateliernova.pt"]],
		displayCurrency: "EUR",
		joinedDaysAgo: 400,
	},
	{
		key: "kwame",
		handle: "kwamemensah",
		name: "Kwame Mensah",
		headline: "Full-stack engineer — Deno, Postgres, realtime — North Loop",
		bio:
			"I lead North Loop, a small engineering studio shipping realtime products on Deno and Postgres. I care about boring infrastructure and exciting demos, in that order.",
		city: "Manchester",
		country: "United Kingdom",
		timezone: "Europe/London",
		languages: ["English", "Twi"],
		languageLevels: [["en", "native"], ["tw", "native"]],
		dob: "1988-12-05",
		role: "freelancer",
		interests: ["realtime", "postgres", "developer tools"],
		skills: ["deno", "postgres", "typescript", "realtime"],
		avatar: "profile_7.jpg",
		banner: "banner_7.jpg",
		workload: 60,
		kyc: "verified",
		payoutReady: true,
		links: [["github", "https://github.com/kwamemensah"]],
		displayCurrency: "GBP",
		joinedDaysAgo: 365,
	},
	{
		key: "saoirse",
		handle: "saoirsebyrne",
		name: "Saoirse Byrne",
		headline: "Editorial designer and mentor — Studio Fern",
		bio:
			"Editorial and typographic design, and a mentoring practice for designers moving from agency into product. Studio Fern is where the two meet.",
		city: "Dublin",
		country: "Ireland",
		timezone: "Europe/Dublin",
		languages: ["English", "Irish"],
		languageLevels: [["en", "native"], ["ga", "conversational"]],
		dob: "1984-07-23",
		role: "freelancer",
		interests: ["editorial", "typography", "mentoring"],
		skills: ["editorial-design", "typography", "mentoring", "notion"],
		avatar: "profile_8.jpeg",
		banner: "banner_8.webp",
		workload: 35,
		kyc: "verified",
		payoutReady: true,
		links: [["website", "https://studiofern.ie"]],
		displayCurrency: "EUR",
		joinedDaysAgo: 330,
	},
	{
		key: "priya",
		handle: "priyaraman",
		name: "Priya Raman",
		headline: "Head of Product, Helia Finance",
		bio:
			"I run product at Helia Finance. We hire independent designers and engineers for the work our core team cannot get to, and we pay on time.",
		city: "London",
		country: "United Kingdom",
		timezone: "Europe/London",
		languages: ["English", "Tamil"],
		languageLevels: [["en", "native"], ["ta", "native"]],
		dob: "1985-10-11",
		role: "operator",
		interests: ["fintech", "product"],
		skills: [],
		displayCurrency: "GBP",
		joinedDaysAgo: 260,
	},
	{
		key: "daniel",
		handle: "danielokafor",
		name: "Daniel Okafor",
		headline: "CTO, Atlas Labs",
		bio:
			"CTO at Atlas Labs, a Toronto analytics company. I bring in outside teams for well-scoped builds and keep the core platform in-house.",
		city: "Toronto",
		country: "Canada",
		timezone: "America/Toronto",
		languages: ["English"],
		languageLevels: [["en", "native"]],
		dob: "1983-02-27",
		role: "operator",
		interests: ["analytics", "data platforms"],
		skills: [],
		displayCurrency: "CAD",
		joinedDaysAgo: 240,
	},
	{
		key: "lena",
		handle: "lenamueller",
		name: "Lena Müller",
		headline: "UX researcher — Atelier Nova",
		bio:
			"Qualitative research for brand and product teams: interviews, diary studies and the synthesis that turns them into decisions.",
		city: "Berlin",
		country: "Germany",
		timezone: "Europe/Berlin",
		languages: ["German", "English"],
		languageLevels: [["de", "native"], ["en", "fluent"]],
		dob: "1993-05-19",
		role: "freelancer",
		interests: ["research", "interviews"],
		skills: ["ux-research", "user-interviews", "figma"],
		workload: 40,
		kyc: "verified",
		payoutReady: true,
		displayCurrency: "EUR",
		joinedDaysAgo: 200,
	},
	{
		key: "tomasz",
		handle: "tomaszwojcik",
		name: "Tomasz Wójcik",
		headline: "Backend engineer — North Loop",
		bio: "Postgres, queues and the parts of a system nobody sees until they break.",
		city: "Kraków",
		country: "Poland",
		timezone: "Europe/Warsaw",
		languages: ["Polish", "English"],
		languageLevels: [["pl", "native"], ["en", "professional"]],
		dob: "1991-08-08",
		role: "freelancer",
		interests: ["postgres", "data pipelines"],
		skills: ["postgres", "deno", "typescript"],
		workload: 50,
		kyc: "verified",
		payoutReady: true,
		displayCurrency: "PLN",
		joinedDaysAgo: 180,
	},
	{
		key: "aiko",
		handle: "aikotanaka",
		name: "Aiko Tanaka",
		headline: "Illustrator and visual designer — Studio Fern, Atelier Nova",
		bio:
			"Illustration and visual design for brands that want a hand-drawn edge. I work with two studios and take a small number of direct commissions.",
		city: "Osaka",
		country: "Japan",
		timezone: "Asia/Tokyo",
		languages: ["Japanese", "English"],
		languageLevels: [["ja", "native"], ["en", "professional"]],
		dob: "1996-03-03",
		role: "freelancer",
		interests: ["illustration", "branding"],
		skills: ["illustration", "procreate", "branding"],
		workload: 45,
		kyc: "verified",
		payoutReady: true,
		displayCurrency: "JPY",
		joinedDaysAgo: 150,
	},
	{
		key: "samuel",
		handle: "samuelnkemelu",
		name: "Samuel Nkemelu",
		headline: "Mobile engineer (iOS and Android) — North Loop mobile lead",
		bio:
			"Native mobile for products that need to feel native. I lead mobile at North Loop and still write most of the Swift myself.",
		city: "Lagos",
		country: "Nigeria",
		timezone: "Africa/Lagos",
		languages: ["English", "Igbo"],
		languageLevels: [["en", "native"], ["ig", "native"]],
		dob: "1990-11-15",
		role: "freelancer",
		interests: ["mobile", "swift", "kotlin"],
		skills: ["swift", "kotlin", "react-native"],
		workload: 65,
		kyc: "verified",
		payoutReady: true,
		displayCurrency: "USD",
		joinedDaysAgo: 220,
	},
	{
		key: "hannah",
		handle: "hannahcole",
		name: "Hannah Cole",
		headline: "Product manager at Helia Finance",
		bio:
			"I run the wallet and design-system workstreams at Helia and manage the external talent we bring in on them.",
		city: "London",
		country: "United Kingdom",
		timezone: "Europe/London",
		languages: ["English"],
		languageLevels: [["en", "native"]],
		dob: "1991-01-25",
		role: "operator",
		interests: ["fintech", "design systems"],
		skills: [],
		displayCurrency: "GBP",
		joinedDaysAgo: 230,
	},
	{
		key: "miguel",
		handle: "miguelsantos",
		name: "Miguel Santos",
		headline: "Design ops at Atlas Labs",
		bio: "Design operations at Atlas: tooling, hiring and keeping the design system honest.",
		city: "Toronto",
		country: "Canada",
		timezone: "America/Toronto",
		languages: ["English", "Portuguese"],
		languageLevels: [["pt", "native"], ["en", "fluent"]],
		dob: "1989-06-30",
		role: "operator",
		interests: ["design ops", "mobile"],
		skills: [],
		displayCurrency: "CAD",
		joinedDaysAgo: 190,
	},
	{
		key: "chloe",
		handle: "chloewinters",
		name: "Chloe Winters",
		headline: "Freelance copywriter — brand voice and UX writing",
		bio:
			"Words for products and brands: naming, voice guidelines, onboarding copy and the microcopy nobody notices until it is wrong. New here — say hello.",
		city: "Edinburgh",
		country: "United Kingdom",
		timezone: "Europe/London",
		languages: ["English"],
		languageLevels: [["en", "native"]],
		dob: "1994-12-12",
		role: "freelancer",
		interests: ["copywriting", "ux writing"],
		skills: ["copywriting", "ux-writing", "brand-voice"],
		workload: 10,
		kyc: "unverified",
		payoutReady: false,
		displayCurrency: "GBP",
		joinedDaysAgo: 12,
	},
];

/** The skills vocabulary the personas reference, seeded into `org.skills`. */
export const SKILLS: Array<[slug: string, label: string]> = [
	["ux", "UX"],
	["design-systems", "Design systems"],
	["figma", "Figma"],
	["prototyping", "Prototyping"],
	["webgl", "WebGL"],
	["blender", "Blender"],
	["three-js", "Three.js"],
	["motion-design", "Motion design"],
	["preact", "Preact"],
	["typescript", "TypeScript"],
	["a11y", "Accessibility"],
	["deno", "Deno"],
	["branding", "Branding"],
	["identity-systems", "Identity systems"],
	["typography", "Typography"],
	["art-direction", "Art direction"],
	["postgres", "Postgres"],
	["realtime", "Realtime systems"],
	["editorial-design", "Editorial design"],
	["mentoring", "Mentoring"],
	["notion", "Notion"],
	["ux-research", "UX research"],
	["user-interviews", "User interviews"],
	["illustration", "Illustration"],
	["procreate", "Procreate"],
	["swift", "Swift"],
	["kotlin", "Kotlin"],
	["react-native", "React Native"],
	["copywriting", "Copywriting"],
	["ux-writing", "UX writing"],
	["brand-voice", "Brand voice"],
];
// #endregion

// #region Entities (teams + businesses)
export interface Membership {
	persona: string;
	role: "owner" | "admin" | "lead" | "member";
	title: string;
	/** Team only: `contribution_agreements.percent_bp` share (sums to 10000 across the team). */
	splitBp?: number;
	joinedDaysAgo: number;
}

export interface Entity {
	key: string;
	corpusHandle: string;
	kind: "team" | "business";
	name: string;
	slug: string;
	headline: string;
	bio: string;
	country: string;
	city?: string;
	timezone: string;
	owner: string;
	members: Membership[];
	avatar?: string;
	banner?: string;
	/** Business only. */
	legalName?: string;
	taxId?: string;
	billingEmail?: string;
	kyb?: KycState;
	invoicingMode?: "per_transaction" | "intervaled_monthly";
	billingDay?: number;
	/** Team only. */
	teamPlan?: "team_pro";
	/** Pending `org.org_invitations` (persona key → role). */
	pendingInvites?: Array<
		{ persona: string; role: "member" | "admin"; note: string; daysAgo: number }
	>;
	createdDaysAgo: number;
}

export const ENTITIES: Entity[] = [
	{
		key: "nova",
		corpusHandle: "@ateliernova",
		kind: "team",
		name: "Atelier Nova",
		slug: "ateliernova",
		headline: "Brand identity studio — strategy, identity systems and launch assets",
		bio:
			"A three-person identity studio in Porto and Berlin. We take brands from a positioning workshop through to a system a marketing team can actually run.",
		country: "Portugal",
		city: "Porto",
		timezone: "Europe/Lisbon",
		owner: "ines",
		members: [
			{
				persona: "ines",
				role: "owner",
				title: "Founder and creative director",
				splitBp: 5000,
				joinedDaysAgo: 400,
			},
			{ persona: "lena", role: "admin", title: "Research lead", splitBp: 2500, joinedDaysAgo: 200 },
			{ persona: "aiko", role: "member", title: "Illustrator", splitBp: 2500, joinedDaysAgo: 120 },
		],
		avatar: "brandmark_1.webp",
		banner: "banner_6.webp",
		teamPlan: "team_pro",
		createdDaysAgo: 400,
	},
	{
		key: "north",
		corpusHandle: "@northloop",
		kind: "team",
		name: "North Loop",
		slug: "northloop",
		headline: "Realtime product engineering — Deno, Postgres, native mobile",
		bio:
			"An engineering studio that ships realtime products end to end: schema, API, web and native mobile. Small on purpose.",
		country: "United Kingdom",
		city: "Manchester",
		timezone: "Europe/London",
		owner: "kwame",
		members: [
			{
				persona: "kwame",
				role: "owner",
				title: "Founder and engineering lead",
				splitBp: 4000,
				joinedDaysAgo: 365,
			},
			{ persona: "samuel", role: "lead", title: "Mobile lead", splitBp: 3000, joinedDaysAgo: 220 },
			{
				persona: "tomasz",
				role: "member",
				title: "Backend engineer",
				splitBp: 3000,
				joinedDaysAgo: 180,
			},
		],
		avatar: "brandmark_2.webp",
		banner: "banner_9.webp",
		createdDaysAgo: 365,
	},
	{
		key: "fern",
		corpusHandle: "@studiofern",
		kind: "team",
		name: "Studio Fern",
		slug: "studiofern",
		headline: "Editorial design, illustration and mentoring for designers",
		bio:
			"Editorial and illustration work, plus a mentoring practice — portfolio reviews, live sessions and a six-session mentorship block.",
		country: "Ireland",
		city: "Dublin",
		timezone: "Europe/Dublin",
		owner: "saoirse",
		members: [
			{ persona: "saoirse", role: "owner", title: "Founder", splitBp: 7000, joinedDaysAgo: 330 },
			{ persona: "aiko", role: "member", title: "Illustrator", splitBp: 3000, joinedDaysAgo: 150 },
		],
		avatar: "brandmark_3.webp",
		pendingInvites: [{
			persona: "chloe",
			role: "member",
			note: "We could use a writer on the editorial side — fancy joining Fern?",
			daysAgo: 3,
		}],
		createdDaysAgo: 330,
	},
	{
		key: "helia",
		corpusHandle: "@heliafinance",
		kind: "business",
		name: "Helia Finance",
		slug: "heliafinance",
		headline: "Consumer fintech — wallets, savings and a design system to match",
		bio:
			"Helia is a consumer finance app with two million customers. We bring in independent designers and engineers for well-scoped product work.",
		country: "United Kingdom",
		city: "London",
		timezone: "Europe/London",
		owner: "priya",
		members: [
			{ persona: "priya", role: "owner", title: "Head of Product", joinedDaysAgo: 260 },
			{ persona: "hannah", role: "admin", title: "Product Manager", joinedDaysAgo: 230 },
		],
		avatar: "brandmark_4.jpg",
		legalName: "Helia Finance Ltd",
		taxId: "GB 987 6543 21",
		billingEmail: "accounts@heliafinance.co.uk",
		kyb: "verified",
		invoicingMode: "intervaled_monthly",
		billingDay: 28,
		createdDaysAgo: 260,
	},
	{
		key: "atlas",
		corpusHandle: "@atlaslabs",
		kind: "business",
		name: "Atlas Labs",
		slug: "atlaslabs",
		headline: "Analytics platform for operations teams",
		bio:
			"Atlas builds an analytics platform for operations teams. Toronto-based, remote-friendly, and always hiring good outside teams for scoped builds.",
		country: "Canada",
		city: "Toronto",
		timezone: "America/Toronto",
		owner: "daniel",
		members: [
			{ persona: "daniel", role: "owner", title: "CTO", joinedDaysAgo: 240 },
			{ persona: "miguel", role: "member", title: "Design Ops", joinedDaysAgo: 190 },
		],
		avatar: "brandmark_5.webp",
		legalName: "Atlas Labs Inc.",
		taxId: "CA 123456789 RT0001",
		billingEmail: "ap@atlaslabs.io",
		kyb: "pending",
		invoicingMode: "per_transaction",
		createdDaysAgo: 240,
	},
];

/** Who follows whom (`org.profile_follows`). Targets are persona OR entity keys. */
export const FOLLOWS: Array<[follower: string, target: string]> = [
	["noor", "maris"],
	["noor", "nova"],
	["noor", "juno"],
	["theo", "ren"],
	["theo", "fern"],
	["maris", "ren"],
	["juno", "maris"],
	["hannah", "maris"],
	["hannah", "north"],
	["chloe", "saoirse"],
	["chloe", "fern"],
	["chloe", "maris"],
	["lena", "maris"],
	["priya", "nova"],
	["daniel", "north"],
	["aiko", "ines"],
	["samuel", "kwame"],
];

/** `org.user_bookmarks`: entity_type + a key resolved by kind. */
export const BOOKMARKS: Array<
	{
		persona: string;
		type: "freelancer" | "team" | "business" | "project" | "service_blueprint";
		target: string;
	}
> = [
	{ persona: "noor", type: "freelancer", target: "maris" },
	{ persona: "noor", type: "team", target: "nova" },
	{ persona: "theo", type: "service_blueprint", target: "sv-packaging-art-direction" },
	{ persona: "chloe", type: "project", target: "helia-wallet" },
	{ persona: "hannah", type: "team", target: "north" },
];
// #endregion

// #region Media assignments
/** Corpus service id → cover image. Two listings deliberately carry no cover (a real gap to render). */
export const SERVICE_COVERS: Record<string, string> = {
	"sv-brand-identity-sprint": "service_1.jpg",
	"sv-design-system-foundation": "service_2.jpg",
	"sv-landing-page-in-a-week": "service_3.webp",
	"sv-realtime-mvp-build": "service_4.webp",
	"sv-product-launch-film": "service_5.webp",
	"sv-portfolio-review-session": "service_6.webp",
	"sv-design-mentorship-block": "service_7.jpg",
};

/** Corpus product id → cover image. */
export const PRODUCT_COVERS: Record<string, string> = {
	"pr-grain-lightroom-pack": "product_1.jpg",
	"pr-motion-primitives": "product_2.jpg",
	"pr-editorial-type-system": "product_3.jpg",
	"pr-dashboard-blocks": "product_4.jpg",
	"pr-iconography-set": "product_5.webp",
	"pr-notion-ops-suite": "product_6.jpg",
};
// #endregion

// #region Projects
export type StageStatus =
	| "open"
	| "assigned"
	| "in_progress"
	| "submitted"
	| "approved"
	| "revisions"
	| "paid"
	| "cancelled";
export type TicketStatus =
	| "backlog"
	| "todo"
	| "claimed"
	| "in_progress"
	| "in_review"
	| "completed"
	| "cancelled";
export type PaymentStatus = "unpaid" | "escrow_funded" | "released";

export interface StageSpec {
	key: string;
	name: string;
	brief: string;
	priceCents: number;
	status: StageStatus;
	skills: string[];
	completedDaysAgo?: number;
}

export interface TicketTask {
	text: string;
	done: boolean;
}

export interface TicketSpec {
	key: string;
	title: string;
	brief: string;
	stage: string;
	status: TicketStatus;
	priority: "low" | "normal" | "high" | "urgent";
	intensity: number;
	assignee?: string;
	claimedDaysAgo?: number;
	dueInDays?: number;
	payment: PaymentStatus;
	/** When the escrow was funded / released, days ago. */
	fundedDaysAgo?: number;
	releasedDaysAgo?: number;
	tasks: TicketTask[];
	/** The client-side accountable seat (`tickets.owner_user_id`). */
	owner?: string;
}

export interface SubmissionSpec {
	key: string;
	ticket: string;
	by: string;
	title: string;
	notes: string;
	status: "draft" | "pending_review" | "accepted" | "revisions_requested";
	daysAgo: number;
	reviewedBy?: string;
	feedback?: string;
	/** `[image file, display name]` deliverables stored in the `project` bucket. */
	files: Array<[string, string]>;
	revisionOf?: string;
}

export interface InvitationSpec {
	to: string;
	stage?: string;
	status: "pending" | "accepted" | "declined" | "expired" | "revoked";
	offerCents?: number;
	message: string;
	by: string;
	daysAgo: number;
	placeholder?: boolean;
}

export interface ApplicationSpec {
	by: string;
	stage: string;
	status: "pending" | "accepted" | "rejected" | "withdrawn";
	message: string;
	daysAgo: number;
}

export interface AssignmentSpec {
	/** A persona key (freelancer) or an entity key (team). */
	assignee: string;
	stage: string;
	status: "accepted" | "completed";
	by: string;
	daysAgo: number;
}

export interface ChannelMessage {
	/** `general` or a stage key. */
	channel: string;
	from: string;
	body: string;
	daysAgo: number;
}

export interface ReviewSpec {
	from: string;
	/** Persona key (reviewed as freelancer) or entity key. */
	target: string;
	rating: number;
	title: string;
	comment: string;
	daysAgo: number;
}

export interface ProjectSpec {
	key: string;
	/** The corpus `ProjectItem.id` this project IS, when it is one. */
	corpusId?: string;
	title: string;
	summary: string;
	/** An entity key (business client) or a persona key (individual client). */
	client: string;
	/** The account that created the project (a member of the client business, or the client). */
	owner: string;
	format: "one_off" | "pipeline";
	structure: "standard" | "one_off" | "single_task" | "single_stage";
	status: "draft" | "active" | "on_hold" | "completed";
	visibility: "public" | "invite_only" | "unlisted";
	budgetCents: number;
	allowDeadlineBonuses: boolean;
	startsInDays: number;
	createdDaysAgo: number;
	stages: StageSpec[];
	assignments: AssignmentSpec[];
	invitations: InvitationSpec[];
	applications: ApplicationSpec[];
	tickets: TicketSpec[];
	submissions: SubmissionSpec[];
	messages: ChannelMessage[];
	reviews: ReviewSpec[];
}

export const PROJECTS: ProjectSpec[] = [
	{
		key: "helia-wallet",
		corpusId: "pj-helia-wallet-redesign",
		title: "Helia wallet redesign",
		summary:
			"Reimagine the Helia consumer wallet end to end: research, flows, visual design and a handoff engineering can build from without a second round of questions.",
		client: "helia",
		owner: "hannah",
		format: "pipeline",
		structure: "standard",
		status: "active",
		visibility: "public",
		budgetCents: 4_800_000,
		allowDeadlineBonuses: true,
		startsInDays: 0,
		createdDaysAgo: 21,
		stages: [
			{
				key: "s1",
				name: "Discovery and research",
				brief:
					"Stakeholder interviews, a competitive teardown and a synthesis that names the three problems worth solving.",
				priceCents: 800_000,
				status: "in_progress",
				skills: ["ux-research", "user-interviews"],
			},
			{
				key: "s2",
				name: "UX and flows",
				brief: "Onboarding, top-up, send and the savings pot flows as annotated wireframes.",
				priceCents: 1_600_000,
				status: "open",
				skills: ["ux", "figma", "prototyping"],
			},
			{
				key: "s3",
				name: "Visual design and handoff",
				brief: "High-fidelity screens on the Helia design system, plus tokens and a handoff pack.",
				priceCents: 2_400_000,
				status: "open",
				skills: ["design-systems", "figma"],
			},
		],
		assignments: [{ assignee: "maris", stage: "s1", status: "accepted", by: "hannah", daysAgo: 7 }],
		invitations: [
			{
				to: "maris",
				stage: "s1",
				status: "accepted",
				offerCents: 800_000,
				message:
					"We loved the Meridian tokens work — would you take the discovery stage on the wallet too?",
				by: "hannah",
				daysAgo: 8,
			},
			{
				to: "juno",
				stage: "s2",
				status: "pending",
				offerCents: 1_600_000,
				message:
					"Hi Juno — Maris suggested you for the flows stage. Interested in a quick call this week?",
				by: "hannah",
				daysAgo: 4,
			},
			{
				to: "ren",
				stage: "s3",
				status: "declined",
				offerCents: 2_400_000,
				message: "Would you consider the visual stage? We know it is not your usual 3D work.",
				by: "hannah",
				daysAgo: 10,
			},
		],
		applications: [
			{
				by: "chloe",
				stage: "s2",
				status: "pending",
				message:
					"I write onboarding and transactional copy for fintech apps — happy to pair with whoever takes the flows stage on the words.",
				daysAgo: 2,
			},
			{
				by: "lena",
				stage: "s1",
				status: "rejected",
				message:
					"I run interview programmes for brand and product teams and could take the discovery stage.",
				daysAgo: 9,
			},
		],
		tickets: [
			{
				key: "t1",
				title: "Stakeholder interviews and research synthesis",
				brief:
					"Eight interviews across product, support and risk, synthesised into three problem statements with evidence.",
				stage: "s1",
				status: "in_progress",
				priority: "high",
				intensity: 1.0,
				assignee: "maris",
				claimedDaysAgo: 6,
				dueInDays: 5,
				payment: "escrow_funded",
				fundedDaysAgo: 6,
				tasks: [
					{ text: "Recruit and schedule eight stakeholders", done: true },
					{ text: "Run and record the interviews", done: true },
					{ text: "Synthesise into problem statements", done: false },
				],
				owner: "hannah",
			},
			{
				key: "t2",
				title: "Competitive teardown of six wallets",
				brief: "Annotated flows for six competitor wallets, focused on top-up and send.",
				stage: "s1",
				status: "todo",
				priority: "normal",
				intensity: 0.5,
				payment: "unpaid",
				tasks: [{ text: "Pick the six wallets with product", done: false }],
				owner: "hannah",
			},
			{
				key: "t3",
				title: "Onboarding flow redesign",
				brief: "New onboarding from install to first top-up, as annotated wireframes.",
				stage: "s2",
				status: "backlog",
				priority: "normal",
				intensity: 1.0,
				payment: "unpaid",
				tasks: [],
				owner: "hannah",
			},
		],
		submissions: [{
			key: "sub1",
			ticket: "t1",
			by: "maris",
			title: "Research synthesis — round 1",
			notes: "Interview clips are linked in the board; the three problem statements are on page 2.",
			status: "pending_review",
			daysAgo: 1,
			files: [["product_1.jpg", "wallet-research-synthesis-v1.jpg"]],
		}],
		messages: [
			{
				channel: "general",
				from: "hannah",
				body: "Welcome Maris! Kickoff is Tuesday 10:00 — I will send the interview list tonight.",
				daysAgo: 7,
			},
			{
				channel: "general",
				from: "maris",
				body:
					"Perfect. I have blocked the week for interviews. Could someone from risk be on the list?",
				daysAgo: 6.9,
			},
			{
				channel: "general",
				from: "priya",
				body: "Yes — I will add Rob from risk. Good call.",
				daysAgo: 6.8,
			},
			{
				channel: "s1",
				from: "hannah",
				body:
					"Loved the interview clips you shared. The top-up pain is even worse than we thought.",
				daysAgo: 2,
			},
			{
				channel: "s1",
				from: "maris",
				body: "Synthesis is up for review. Three problem statements, evidence on page 2.",
				daysAgo: 1,
			},
		],
		reviews: [],
	},
	{
		key: "atlas-analytics",
		corpusId: "pj-atlas-analytics-platform",
		title: "Atlas analytics platform",
		summary:
			"Build the Atlas analytics platform: ingestion and warehouse model, a realtime dashboard shell, mobile companion screens, then rollout and documentation.",
		client: "atlas",
		owner: "daniel",
		format: "pipeline",
		structure: "standard",
		status: "active",
		visibility: "public",
		budgetCents: 12_000_000,
		allowDeadlineBonuses: false,
		startsInDays: -30,
		createdDaysAgo: 45,
		stages: [
			{
				key: "s1",
				name: "Data model and ingestion",
				brief: "Event taxonomy, warehouse schema and the ingestion pipeline with replay.",
				priceCents: 1_500_000,
				status: "paid",
				skills: ["postgres", "deno"],
				completedDaysAgo: 20,
			},
			{
				key: "s2",
				name: "Dashboard build",
				brief: "The realtime dashboard shell on the web plus companion screens on mobile.",
				priceCents: 2_250_000,
				status: "in_progress",
				skills: ["typescript", "realtime", "swift"],
			},
			{
				key: "s3",
				name: "Rollout and documentation",
				brief: "Staged rollout to three customer cohorts and the operator runbook.",
				priceCents: 4_500_000,
				status: "open",
				skills: ["typescript"],
			},
		],
		assignments: [
			{ assignee: "north", stage: "s1", status: "completed", by: "daniel", daysAgo: 42 },
			{ assignee: "north", stage: "s2", status: "accepted", by: "daniel", daysAgo: 19 },
		],
		invitations: [{
			to: "kwame",
			status: "accepted",
			offerCents: 1_500_000,
			message:
				"Daniel here — we would like North Loop on the whole build, starting with ingestion.",
			by: "daniel",
			daysAgo: 43,
		}],
		applications: [],
		tickets: [
			{
				key: "t1",
				title: "Ingestion pipeline and warehouse schema",
				brief: "Idempotent ingestion with replay, and the warehouse schema behind it.",
				stage: "s1",
				status: "completed",
				priority: "high",
				intensity: 1.0,
				assignee: "tomasz",
				claimedDaysAgo: 40,
				payment: "released",
				fundedDaysAgo: 40,
				releasedDaysAgo: 20,
				tasks: [
					{ text: "Define the event envelope", done: true },
					{ text: "Ingestion worker with replay", done: true },
					{ text: "Load test at 5k events/s", done: true },
				],
				owner: "daniel",
			},
			{
				key: "t2",
				title: "Event taxonomy and warehouse model",
				brief: "The taxonomy every dashboard reads from, agreed with the ops team.",
				stage: "s1",
				status: "completed",
				priority: "normal",
				intensity: 1.0,
				assignee: "kwame",
				claimedDaysAgo: 38,
				payment: "released",
				fundedDaysAgo: 38,
				releasedDaysAgo: 22,
				tasks: [{ text: "Taxonomy workshop", done: true }, { text: "Warehouse model", done: true }],
				owner: "daniel",
			},
			{
				key: "t3",
				title: "Realtime dashboard shell",
				brief: "The web dashboard shell: layout, live tiles and the query layer.",
				stage: "s2",
				status: "in_progress",
				priority: "high",
				intensity: 2.0,
				assignee: "kwame",
				claimedDaysAgo: 9,
				payment: "escrow_funded",
				fundedDaysAgo: 9,
				tasks: [
					{ text: "Tile grid and layout persistence", done: true },
					{ text: "Live query layer", done: false },
					{ text: "Alert thresholds", done: false },
				],
				owner: "daniel",
			},
			{
				key: "t4",
				title: "Mobile companion screens",
				brief: "iOS and Android companion screens for the three most-used dashboards.",
				stage: "s2",
				status: "in_review",
				priority: "normal",
				intensity: 1.0,
				assignee: "samuel",
				claimedDaysAgo: 12,
				payment: "escrow_funded",
				fundedDaysAgo: 12,
				tasks: [{ text: "Overview screen", done: true }, { text: "Drill-down screen", done: true }],
				owner: "miguel",
			},
			{
				key: "t5",
				title: "Rollout runbook",
				brief: "Operator runbook for the staged rollout.",
				stage: "s3",
				status: "backlog",
				priority: "low",
				intensity: 0.5,
				payment: "unpaid",
				tasks: [],
				owner: "miguel",
			},
		],
		submissions: [
			{
				key: "sub1",
				ticket: "t1",
				by: "tomasz",
				title: "Ingestion pipeline — final",
				notes: "Replay verified against the March backlog. Schema migration attached.",
				status: "accepted",
				daysAgo: 21,
				reviewedBy: "daniel",
				feedback: "Clean. Replay held up under the load test — accepted.",
				files: [["product_3.jpg", "ingestion-architecture.jpg"]],
			},
			{
				key: "sub2",
				ticket: "t4",
				by: "samuel",
				title: "Companion screens — v1",
				notes: "Overview and drill-down on both platforms.",
				status: "revisions_requested",
				daysAgo: 6,
				reviewedBy: "daniel",
				feedback:
					"The drill-down chart clips on small Android screens — can we get a v2 with that fixed?",
				files: [["product_4.jpg", "companion-screens-v1.jpg"]],
			},
			{
				key: "sub3",
				ticket: "t4",
				by: "samuel",
				title: "Companion screens — v2",
				notes: "Drill-down chart now scrolls horizontally below 360dp. Both platforms re-tested.",
				status: "pending_review",
				daysAgo: 2,
				files: [["product_4.jpg", "companion-screens-v2.jpg"]],
				revisionOf: "sub2",
			},
		],
		messages: [
			{
				channel: "general",
				from: "daniel",
				body: "North Loop are on the build — welcome Kwame, Samuel and Tomasz.",
				daysAgo: 42,
			},
			{
				channel: "general",
				from: "kwame",
				body:
					"Thanks Daniel. Ingestion first; we will have the taxonomy workshop booked by Friday.",
				daysAgo: 41.5,
			},
			{
				channel: "s1",
				from: "tomasz",
				body: "Replay is working end to end. Load test tomorrow.",
				daysAgo: 24,
			},
			{
				channel: "s1",
				from: "daniel",
				body: "Accepted both stage-one tickets. Great work — releasing escrow now.",
				daysAgo: 20,
			},
			{
				channel: "s2",
				from: "samuel",
				body: "v2 of the companion screens is up. The clipping is fixed on the Pixel 4a.",
				daysAgo: 2,
			},
			{ channel: "s2", from: "miguel", body: "Looking now — thanks Samuel.", daysAgo: 1.8 },
		],
		reviews: [
			{
				from: "daniel",
				target: "north",
				rating: 4.8,
				title: "Reliable, communicative, and the load test held",
				comment:
					"North Loop delivered the ingestion stage a week early and the replay design has already saved us once. Communication was proactive throughout and the handoff notes were the best we have received from an outside team.",
				daysAgo: 19,
			},
			{
				from: "kwame",
				target: "atlas",
				rating: 5.0,
				title: "A client who reviews on time",
				comment:
					"Daniel reviewed every submission within a day, gave specific feedback, and released escrow the moment a stage was accepted. Atlas is exactly the kind of client a small studio wants to keep working with.",
				daysAgo: 18,
			},
		],
	},
	{
		key: "verdant-brand",
		corpusId: "pj-verdant-brand-refresh",
		title: "Verdant brand refresh",
		summary:
			"A full brand refresh for Verdant, Helia's savings product — positioning, identity system, and launch assets — delivered as one scoped engagement.",
		client: "helia",
		owner: "priya",
		format: "one_off",
		structure: "one_off",
		status: "active",
		visibility: "public",
		budgetCents: 3_200_000,
		allowDeadlineBonuses: false,
		startsInDays: -10,
		createdDaysAgo: 16,
		stages: [{
			key: "s1",
			name: "Brand refresh delivery",
			brief: "Positioning workshop, identity system and a launch asset pack, delivered together.",
			priceCents: 3_200_000,
			status: "assigned",
			skills: ["branding", "identity-systems", "typography"],
		}],
		assignments: [{ assignee: "nova", stage: "s1", status: "accepted", by: "priya", daysAgo: 12 }],
		invitations: [{
			to: "ines",
			stage: "s1",
			status: "accepted",
			offerCents: 3_200_000,
			message:
				"We saw the identity sprint listing — would Atelier Nova take the Verdant refresh as a single engagement?",
			by: "priya",
			daysAgo: 14,
		}],
		applications: [],
		tickets: [{
			key: "t1",
			title: "Verdant brand refresh — full delivery",
			brief: "Positioning, identity system, and launch assets. One ticket, one delivery.",
			stage: "s1",
			status: "claimed",
			priority: "high",
			intensity: 2.0,
			assignee: "ines",
			claimedDaysAgo: 11,
			payment: "escrow_funded",
			fundedDaysAgo: 11,
			tasks: [
				{ text: "Positioning workshop", done: true },
				{ text: "Identity concepts (three routes)", done: false },
				{ text: "Chosen route developed", done: false },
				{ text: "Launch asset pack", done: false },
			],
			owner: "priya",
		}],
		submissions: [],
		messages: [
			{
				channel: "general",
				from: "priya",
				body: "Workshop notes are in the shared folder. Excited to see the three routes.",
				daysAgo: 8,
			},
			{
				channel: "general",
				from: "ines",
				body:
					"Thanks Priya — routes land next Thursday. Lena is running a quick round of customer interviews first.",
				daysAgo: 7.5,
			},
		],
		reviews: [],
	},
	{
		key: "loop-mobile",
		corpusId: "pj-loop-mobile-app",
		title: "Loop mobile app",
		summary:
			"Ship the Loop mobile app on iOS and Android for Atlas customers: architecture, two native builds, and a release with QA.",
		client: "atlas",
		owner: "miguel",
		format: "pipeline",
		structure: "standard",
		status: "active",
		visibility: "public",
		budgetCents: 7_600_000,
		allowDeadlineBonuses: false,
		startsInDays: 21,
		createdDaysAgo: 6,
		stages: [
			{
				key: "s1",
				name: "Architecture and design",
				brief: "Technical architecture and the mobile design system.",
				priceCents: 1_600_000,
				status: "open",
				skills: ["swift", "kotlin", "design-systems"],
			},
			{
				key: "s2",
				name: "iOS build",
				brief: "The native iOS app.",
				priceCents: 2_500_000,
				status: "open",
				skills: ["swift"],
			},
			{
				key: "s3",
				name: "Android build",
				brief: "The native Android app.",
				priceCents: 2_500_000,
				status: "open",
				skills: ["kotlin"],
			},
			{
				key: "s4",
				name: "QA and release",
				brief: "Device matrix QA and the store release.",
				priceCents: 1_000_000,
				status: "open",
				skills: ["react-native"],
			},
		],
		assignments: [],
		invitations: [
			{
				to: "samuel",
				stage: "s2",
				status: "pending",
				offerCents: 2_500_000,
				message:
					"Samuel — after the Atlas companion screens, would you take the iOS build on Loop?",
				by: "miguel",
				daysAgo: 1,
			},
			{
				to: "ren",
				stage: "s1",
				status: "declined",
				message: "Would you help with the mobile design system?",
				by: "miguel",
				daysAgo: 5,
			},
		],
		applications: [
			{
				by: "juno",
				stage: "s1",
				status: "pending",
				message:
					"I can own the architecture stage and set up the shared design tokens for both native builds.",
				daysAgo: 3,
			},
			{
				by: "tomasz",
				stage: "s3",
				status: "pending",
				message:
					"Happy to take the Android build once architecture lands — I have shipped two Kotlin apps this year.",
				daysAgo: 2,
			},
		],
		tickets: [
			{
				key: "t1",
				title: "Technical architecture document",
				brief: "Module boundaries, sync strategy and the offline story.",
				stage: "s1",
				status: "todo",
				priority: "high",
				intensity: 1.0,
				payment: "unpaid",
				tasks: [],
				owner: "miguel",
			},
			{
				key: "t2",
				title: "Mobile design system",
				brief: "Tokens and core components for both platforms.",
				stage: "s1",
				status: "backlog",
				priority: "normal",
				intensity: 1.0,
				payment: "unpaid",
				tasks: [],
				owner: "miguel",
			},
		],
		submissions: [],
		messages: [{
			channel: "general",
			from: "miguel",
			body: "Project is open for applications — architecture stage first.",
			daysAgo: 6,
		}],
		reviews: [],
	},
	{
		key: "meridian-ds",
		corpusId: "pj-meridian-design-system",
		title: "Meridian design system",
		summary:
			"Stand up the Meridian design system for Helia: tokens and foundations, core components, and a documentation site.",
		client: "helia",
		owner: "hannah",
		format: "pipeline",
		structure: "standard",
		status: "active",
		visibility: "public",
		budgetCents: 5_400_000,
		allowDeadlineBonuses: true,
		startsInDays: -35,
		createdDaysAgo: 50,
		stages: [
			{
				key: "s1",
				name: "Tokens and foundations",
				brief: "Colour, type, spacing and theming tokens with light and dark modes.",
				priceCents: 1_400_000,
				status: "paid",
				skills: ["design-systems"],
				completedDaysAgo: 15,
			},
			{
				key: "s2",
				name: "Core components",
				brief: "Button, field, layout and feedback primitives on the tokens.",
				priceCents: 2_200_000,
				status: "in_progress",
				skills: ["design-systems", "figma"],
			},
			{
				key: "s3",
				name: "Documentation site",
				brief: "The documentation site with live examples.",
				priceCents: 1_800_000,
				status: "open",
				skills: ["typescript", "a11y"],
			},
		],
		assignments: [
			{ assignee: "maris", stage: "s1", status: "completed", by: "hannah", daysAgo: 48 },
			{ assignee: "maris", stage: "s2", status: "accepted", by: "hannah", daysAgo: 14 },
		],
		invitations: [{
			to: "maris",
			stage: "s1",
			status: "accepted",
			offerCents: 1_400_000,
			message: "Priya recommended you for the token architecture. Would you take stage one?",
			by: "hannah",
			daysAgo: 49,
		}],
		applications: [],
		tickets: [
			{
				key: "t1",
				title: "Token architecture and theming",
				brief: "Semantic token tiers, light and dark modes, and the theming contract.",
				stage: "s1",
				status: "completed",
				priority: "high",
				intensity: 1.0,
				assignee: "maris",
				claimedDaysAgo: 28,
				dueInDays: -16,
				payment: "released",
				fundedDaysAgo: 28,
				releasedDaysAgo: 15,
				tasks: [{ text: "Semantic tiers", done: true }, { text: "Dark mode", done: true }, {
					text: "Theming contract",
					done: true,
				}],
				owner: "hannah",
			},
			{
				key: "t2",
				title: "Button, field and layout primitives",
				brief: "The core component set, each with states and a11y notes.",
				stage: "s2",
				status: "in_progress",
				priority: "high",
				intensity: 1.0,
				assignee: "maris",
				claimedDaysAgo: 8,
				dueInDays: 10,
				payment: "escrow_funded",
				fundedDaysAgo: 8,
				tasks: [{ text: "Button", done: true }, { text: "Field family", done: false }, {
					text: "Layout primitives",
					done: false,
				}],
				owner: "hannah",
			},
			{
				key: "t3",
				title: "Documentation IA",
				brief: "Information architecture for the docs site.",
				stage: "s3",
				status: "backlog",
				priority: "low",
				intensity: 0.5,
				payment: "unpaid",
				tasks: [],
				owner: "hannah",
			},
		],
		submissions: [{
			key: "sub1",
			ticket: "t1",
			by: "maris",
			title: "Token architecture — final",
			notes:
				"Tokens exported as JSON and CSS; theming contract documented in the attached preview.",
			status: "accepted",
			daysAgo: 16,
			reviewedBy: "hannah",
			feedback: "Exactly what engineering needed. Accepted — thank you.",
			files: [["service_3.webp", "meridian-tokens-preview.webp"]],
		}],
		messages: [
			{
				channel: "general",
				from: "hannah",
				body: "Tokens accepted and escrow released. On to components!",
				daysAgo: 15,
			},
			{
				channel: "s2",
				from: "maris",
				body: "Button is done with all states. Field family next — expect a first pass Friday.",
				daysAgo: 3,
			},
		],
		reviews: [
			{
				from: "hannah",
				target: "maris",
				rating: 5.0,
				title: "The token work engineering actually adopted",
				comment:
					"Maris delivered a token architecture our engineers adopted the same week, with a theming contract that made dark mode a configuration change rather than a project. Clear communication, on time, and thoughtful about accessibility throughout.",
				daysAgo: 14,
			},
			{
				from: "maris",
				target: "helia",
				rating: 4.7,
				title: "Well-run, fast reviews",
				comment:
					"Helia is a well-run client: the brief was clear, reviews came back within two days, and payment was released promptly once a stage was accepted. Occasional scope creep in the details stage, but always negotiated in the open.",
				daysAgo: 13,
			},
		],
	},
	{
		key: "noor-site",
		title: "Haddad Studio portfolio site",
		summary:
			"A one-page portfolio site for the studio: fast, accessible, and easy for me to update myself.",
		client: "noor",
		owner: "noor",
		format: "one_off",
		structure: "one_off",
		status: "active",
		visibility: "invite_only",
		budgetCents: 240_000,
		allowDeadlineBonuses: false,
		startsInDays: -5,
		createdDaysAgo: 9,
		stages: [{
			key: "s1",
			name: "Site build",
			brief: "Design and build the one-page site with a simple content editor.",
			priceCents: 240_000,
			status: "assigned",
			skills: ["preact", "a11y"],
		}],
		assignments: [{ assignee: "juno", stage: "s1", status: "accepted", by: "noor", daysAgo: 7 }],
		invitations: [{
			to: "juno",
			stage: "s1",
			status: "accepted",
			offerCents: 240_000,
			message: "Loved your landing page listing — could you build the studio site as a one-off?",
			by: "noor",
			daysAgo: 8,
		}],
		applications: [],
		tickets: [{
			key: "t1",
			title: "Portfolio site — build and launch",
			brief: "One page, six case studies, contact form, editable copy.",
			stage: "s1",
			status: "in_progress",
			priority: "normal",
			intensity: 1.0,
			assignee: "juno",
			claimedDaysAgo: 7,
			payment: "unpaid",
			tasks: [{ text: "Layout and typography", done: true }, {
				text: "Case study pages",
				done: false,
			}, { text: "Launch", done: false }],
			owner: "noor",
		}],
		submissions: [],
		messages: [
			{
				channel: "general",
				from: "noor",
				body: "Brief and the six case studies are attached. Go wild with the type.",
				daysAgo: 7,
			},
			{
				channel: "general",
				from: "juno",
				body: "On it — first layout pass Thursday.",
				daysAgo: 6.5,
			},
		],
		reviews: [],
	},
	{
		key: "theo-packaging",
		title: "Almeida Coffee — packaging refresh",
		summary: "New bag artwork and a retail display concept for three single-origin lines.",
		client: "theo",
		owner: "theo",
		format: "pipeline",
		structure: "standard",
		status: "draft",
		visibility: "unlisted",
		budgetCents: 190_000,
		allowDeadlineBonuses: false,
		startsInDays: 30,
		createdDaysAgo: 2,
		stages: [
			{
				key: "s1",
				name: "Concepts",
				brief: "Three artwork directions for the bag range.",
				priceCents: 70_000,
				status: "open",
				skills: ["art-direction", "illustration"],
			},
			{
				key: "s2",
				name: "Final artwork",
				brief: "Print-ready artwork for three bags and the display.",
				priceCents: 120_000,
				status: "open",
				skills: ["art-direction"],
			},
		],
		assignments: [],
		invitations: [{
			to: "ren",
			stage: "s1",
			status: "pending",
			offerCents: 70_000,
			message:
				"Your packaging art direction listing is exactly what we need for the new range — are you free in a month?",
			by: "theo",
			daysAgo: 1,
			placeholder: true,
		}],
		applications: [],
		tickets: [],
		submissions: [],
		messages: [],
		reviews: [],
	},
];
// #endregion

// #region Commerce
export interface OrderSpec {
	key: string;
	/** Persona key (personal) or entity key (business). */
	buyer: string;
	/** The account that placed it. */
	placedBy: string;
	/** Corpus listing ids: `pr-…` (a digital product) or `sv-…` (a service bought outright). */
	items: string[];
	daysAgo: number;
	cardLast4: string;
	status: "confirmed" | "processing" | "refunded";
	/** Paid from the buyer's wallet/vault rather than the card on file. */
	fromWallet?: boolean;
	/** A session order: when the seat is booked for, in days from now. */
	scheduledInDays?: number;
}

export const ORDERS: OrderSpec[] = [
	{
		key: "o1",
		buyer: "noor",
		placedBy: "noor",
		items: ["pr-editorial-type-system"],
		daysAgo: 25,
		cardLast4: "4242",
		status: "confirmed",
	},
	{
		key: "o2",
		buyer: "theo",
		placedBy: "theo",
		items: ["pr-notion-ops-suite", "pr-motion-primitives"],
		daysAgo: 12,
		cardLast4: "1881",
		status: "confirmed",
	},
	{
		key: "o3",
		buyer: "helia",
		placedBy: "hannah",
		items: ["pr-dashboard-blocks", "pr-iconography-set"],
		daysAgo: 33,
		cardLast4: "0005",
		status: "confirmed",
		fromWallet: true,
	},
	{
		key: "o4",
		buyer: "chloe",
		placedBy: "chloe",
		items: ["pr-grain-lightroom-pack"],
		daysAgo: 4,
		cardLast4: "5556",
		status: "confirmed",
	},
	{
		key: "o5",
		buyer: "juno",
		placedBy: "juno",
		items: ["pr-iconography-set"],
		daysAgo: 60,
		cardLast4: "4444",
		status: "refunded",
	},
	{
		key: "o6",
		buyer: "theo",
		placedBy: "theo",
		items: ["sv-packaging-art-direction"],
		daysAgo: 70,
		cardLast4: "1881",
		status: "confirmed",
	},
	{
		key: "o7",
		buyer: "noor",
		placedBy: "noor",
		items: ["sv-landing-page-in-a-week"],
		daysAgo: 45,
		cardLast4: "4242",
		status: "confirmed",
	},
	{
		key: "o8",
		buyer: "chloe",
		placedBy: "chloe",
		items: ["sv-portfolio-review-session"],
		daysAgo: 3,
		cardLast4: "5556",
		status: "confirmed",
		scheduledInDays: 5,
	},
];

/** Basket lines a buyer has not checked out yet. */
export const BASKETS: Array<{ owner: string; products: string[] }> = [
	{ owner: "noor", products: ["pr-motion-primitives"] },
	{ owner: "theo", products: ["pr-grain-lightroom-pack", "pr-dashboard-blocks"] },
];

/** Card on file per buyer (personal or business): `[brand, last4, expMonth, expYear, holder]`. */
export const CARDS: Record<string, [string, string, number, number, string]> = {
	noor: ["visa", "4242", 9, 2028, "Noor Haddad"],
	theo: ["mastercard", "1881", 3, 2027, "Theo Almeida"],
	helia: ["amex", "0005", 11, 2027, "Helia Finance Ltd"],
	atlas: ["visa", "4444", 6, 2029, "Atlas Labs Inc."],
	chloe: ["mastercard", "5556", 1, 2028, "Chloe Winters"],
	juno: ["visa", "4444", 4, 2027, "Juno Park"],
};

/** Wallet top-ups and payouts that are not derivable from projects/orders. */
export const TOPUPS: Array<{ owner: string; cents: number; daysAgo: number }> = [
	{ owner: "noor", cents: 500_000, daysAgo: 28 },
	{ owner: "theo", cents: 250_000, daysAgo: 15 },
	{ owner: "juno", cents: 20_000, daysAgo: 62 },
	{ owner: "chloe", cents: 5_000, daysAgo: 5 },
	{ owner: "atlas", cents: 6_000_000, daysAgo: 44 },
	{ owner: "helia", cents: 6_000_000, daysAgo: 30 },
];

export const PAYOUTS: Array<{ owner: string; cents: number; daysAgo: number; instant?: boolean }> =
	[
		{ owner: "maris", cents: 900_000, daysAgo: 10 },
		{ owner: "kwame", cents: 500_000, daysAgo: 16, instant: true },
		{ owner: "tomasz", cents: 300_000, daysAgo: 14 },
		{ owner: "ren", cents: 120_000, daysAgo: 40 },
	];
// #endregion

// #region Messaging
export interface DmSpec {
	key: string;
	kind: "dm" | "group" | "service_inquiry";
	title?: string;
	participants: string[];
	createdBy: string;
	messages: Array<{ from: string; body: string; daysAgo: number }>;
	/** Persona keys who have read everything (everyone else has unread messages). */
	readBy: string[];
	starredBy?: string[];
}

export const DMS: DmSpec[] = [
	{
		key: "noor-maris",
		kind: "dm",
		participants: ["noor", "maris"],
		createdBy: "noor",
		messages: [
			{
				from: "noor",
				body:
					"Hi Maris — I have a brand refresh coming up in Q4 and would love to talk about your design-system offer.",
				daysAgo: 20,
			},
			{
				from: "maris",
				body:
					"Hi Noor, happy to. I am mostly booked with Helia until mid-October but could take a foundations stage after that.",
				daysAgo: 19.5,
			},
			{
				from: "noor",
				body: "That timing works. I will send the brief over next week.",
				daysAgo: 19,
			},
			{ from: "maris", body: "Looking forward to it!", daysAgo: 18.9 },
		],
		readBy: ["noor", "maris"],
		starredBy: ["noor"],
	},
	{
		key: "noor-juno",
		kind: "dm",
		participants: ["noor", "juno"],
		createdBy: "noor",
		messages: [
			{
				from: "noor",
				body:
					"Juno, quick one on the studio site — can the case studies be reordered from the editor?",
				daysAgo: 1.2,
			},
			{ from: "juno", body: "Yes, drag to reorder. I will show you Thursday.", daysAgo: 1.1 },
			{ from: "noor", body: "Brilliant. Also — could we get a dark mode?", daysAgo: 0.4 },
		],
		readBy: ["noor"],
	},
	{
		key: "theo-ren",
		kind: "dm",
		participants: ["theo", "ren"],
		createdBy: "theo",
		messages: [
			{
				from: "theo",
				body:
					"Ren — I just sent an invitation for our packaging project. Three bags, one display, a month from now.",
				daysAgo: 1,
			},
			{
				from: "ren",
				body:
					"Saw it, thank you. I am wrapping a launch film this fortnight but a month out is realistic. Let me look at the brief properly tomorrow.",
				daysAgo: 0.6,
			},
		],
		readBy: ["ren"],
	},
	{
		key: "atlas-north",
		kind: "group",
		title: "Atlas × North Loop",
		participants: ["daniel", "miguel", "kwame", "samuel", "tomasz"],
		createdBy: "daniel",
		messages: [
			{
				from: "daniel",
				body: "Group for anything cross-project between Atlas and North Loop.",
				daysAgo: 42,
			},
			{ from: "kwame", body: "Perfect. Samuel and Tomasz are here.", daysAgo: 41.9 },
			{
				from: "miguel",
				body: "Heads up: Loop mobile is open for applications — Samuel, an invite is on its way.",
				daysAgo: 1,
			},
			{
				from: "samuel",
				body: "Seen it — will reply once the companion screens are accepted.",
				daysAgo: 0.8,
			},
		],
		readBy: ["daniel", "miguel", "samuel"],
	},
	{
		key: "chloe-saoirse",
		kind: "service_inquiry",
		participants: ["chloe", "saoirse"],
		createdBy: "chloe",
		messages: [
			{
				from: "chloe",
				body:
					"Hi Saoirse — I would love to book a portfolio review before I start pitching for product roles. Is the 60-minute session right for that?",
				daysAgo: 3.5,
			},
			{
				from: "saoirse",
				body:
					"Hi Chloe! Yes, that is exactly what it is for. Also — I have just sent you an invite to join Studio Fern on the writing side, no pressure.",
				daysAgo: 3,
			},
			{
				from: "chloe",
				body: "Oh wow, thank you. Let me book the review first and think about Fern properly.",
				daysAgo: 2.8,
			},
		],
		readBy: ["chloe", "saoirse"],
	},
	{
		key: "hannah-maris",
		kind: "dm",
		participants: ["hannah", "maris"],
		createdBy: "hannah",
		messages: [
			{
				from: "hannah",
				body: "Synthesis received — reviewing with Priya tomorrow morning.",
				daysAgo: 0.9,
			},
			{
				from: "maris",
				body: "Great. I am around all day if you want to talk through the third problem statement.",
				daysAgo: 0.7,
			},
		],
		readBy: ["maris"],
	},
	{
		key: "nova-internal",
		kind: "group",
		title: "Atelier Nova",
		participants: ["ines", "lena", "aiko"],
		createdBy: "ines",
		messages: [
			{
				from: "ines",
				body:
					"Verdant workshop notes are in. Lena — can you do four customer interviews before Thursday?",
				daysAgo: 7,
			},
			{ from: "lena", body: "Yes, recruiting now.", daysAgo: 6.8 },
			{
				from: "aiko",
				body: "I will start on illustration directions for route two once the interviews land.",
				daysAgo: 6,
			},
		],
		readBy: ["ines", "lena", "aiko"],
	},
];
// #endregion

// #region Notifications
export interface NotificationSpec {
	to: string;
	type: string;
	title: string;
	body: string;
	daysAgo: number;
	read: boolean;
	actor?: string;
	/** `[context_type, key]` — resolved to an id by the emitter. */
	context?: ["project", string] | ["conversation", string] | ["team", string] | [
		"business",
		string,
	];
	actionUrl?: string;
}

export const NOTIFICATIONS: NotificationSpec[] = [
	{
		to: "maris",
		type: "escrow.funded",
		title: "Escrow secured for Discovery and research",
		body: "Helia Finance funded $8,000.00 for your ticket on Helia wallet redesign.",
		daysAgo: 6,
		read: true,
		actor: "hannah",
		context: ["project", "helia-wallet"],
	},
	{
		to: "maris",
		type: "escrow.released",
		title: "$13,300.00 released to your wallet",
		body: "Tokens and foundations on Meridian design system was accepted and paid out.",
		daysAgo: 15,
		read: true,
		actor: "hannah",
		context: ["project", "meridian-ds"],
		actionUrl: "/wallet/transactions",
	},
	{
		to: "maris",
		type: "review.received",
		title: "Hannah Cole left you a 5-star review",
		body: '"The token work engineering actually adopted"',
		daysAgo: 14,
		read: true,
		actor: "hannah",
	},
	{
		to: "maris",
		type: "message.new",
		title: "Hannah Cole",
		body: "Synthesis received — reviewing with Priya tomorrow morning.",
		daysAgo: 0.9,
		read: true,
		actor: "hannah",
		context: ["conversation", "hannah-maris"],
	},
	{
		to: "maris",
		type: "profile.followed",
		title: "Chloe Winters started following you",
		body: "Freelance copywriter — brand voice and UX writing",
		daysAgo: 4,
		read: false,
		actor: "chloe",
	},
	{
		to: "maris",
		type: "payout.sent",
		title: "Payout of $9,000.00 sent",
		body: "Your payout to the account ending 2210 is on its way.",
		daysAgo: 10,
		read: true,
		actionUrl: "/wallet/payouts",
	},
	{
		to: "hannah",
		type: "submission.received",
		title: "Maris submitted Research synthesis — round 1",
		body: "Ticket: Stakeholder interviews and research synthesis",
		daysAgo: 1,
		read: false,
		actor: "maris",
		context: ["project", "helia-wallet"],
	},
	{
		to: "hannah",
		type: "application.received",
		title: "Chloe Winters applied to UX and flows",
		body: '"I write onboarding and transactional copy for fintech apps…"',
		daysAgo: 2,
		read: false,
		actor: "chloe",
		context: ["project", "helia-wallet"],
	},
	{
		to: "hannah",
		type: "application.received",
		title: "Lena Müller applied to Discovery and research",
		body: '"I run interview programmes for brand and product teams…"',
		daysAgo: 9,
		read: true,
		actor: "lena",
		context: ["project", "helia-wallet"],
	},
	{
		to: "hannah",
		type: "message.new",
		title: "Maris Delacroix",
		body: "Great. I am around all day if you want to talk through the third problem statement.",
		daysAgo: 0.7,
		read: false,
		actor: "maris",
		context: ["conversation", "hannah-maris"],
	},
	{
		to: "priya",
		type: "ticket.claimed",
		title: "Inês Duarte claimed the Verdant brand refresh ticket",
		body: "Escrow of $32,000.00 is now held for Atelier Nova.",
		daysAgo: 11,
		read: true,
		actor: "ines",
		context: ["project", "verdant-brand"],
	},
	{
		to: "priya",
		type: "review.received",
		title: "Maris Delacroix reviewed Helia Finance",
		body: '"Well-run, fast reviews" — 4.7 stars',
		daysAgo: 13,
		read: false,
		actor: "maris",
	},
	{
		to: "juno",
		type: "stage.invite",
		title: "Hannah Cole invited you to UX and flows",
		body: "Helia wallet redesign — offer $16,000.00",
		daysAgo: 4,
		read: false,
		actor: "hannah",
		context: ["project", "helia-wallet"],
	},
	{
		to: "juno",
		type: "application.received",
		title: "Your application to Loop mobile app was received",
		body: "Architecture and design — Atlas Labs will respond within five days.",
		daysAgo: 3,
		read: true,
		context: ["project", "loop-mobile"],
	},
	{
		to: "juno",
		type: "message.new",
		title: "Noor Haddad",
		body: "Brilliant. Also — could we get a dark mode?",
		daysAgo: 0.4,
		read: false,
		actor: "noor",
		context: ["conversation", "noor-juno"],
	},
	{
		to: "juno",
		type: "escrow.refunded",
		title: "$38.00 refunded for Iconography set — 640",
		body: "Your refund has been credited to your wallet.",
		daysAgo: 58,
		read: true,
		actionUrl: "/wallet/transactions",
	},
	{
		to: "ren",
		type: "stage.invite",
		title: "Theo Almeida invited you to Concepts",
		body: "Almeida Coffee — packaging refresh — offer $700.00",
		daysAgo: 1,
		read: false,
		actor: "theo",
		context: ["project", "theo-packaging"],
	},
	{
		to: "ren",
		type: "message.new",
		title: "Theo Almeida",
		body: "Ren — I just sent an invitation for our packaging project.",
		daysAgo: 1,
		read: true,
		actor: "theo",
		context: ["conversation", "theo-ren"],
	},
	{
		to: "ren",
		type: "profile.followed",
		title: "Maris Delacroix started following you",
		body: "Product design lead",
		daysAgo: 30,
		read: true,
		actor: "maris",
	},
	{
		to: "noor",
		type: "message.new",
		title: "Juno Park",
		body: "Yes, drag to reorder. I will show you Thursday.",
		daysAgo: 1.1,
		read: true,
		actor: "juno",
		context: ["conversation", "noor-juno"],
	},
	{
		to: "noor",
		type: "wallet.topup_succeeded",
		title: "Top-up of $5,000.00 landed",
		body: "Your wallet balance has been updated.",
		daysAgo: 28,
		read: true,
		actionUrl: "/wallet/transactions",
	},
	{
		to: "noor",
		type: "project.member_joined",
		title: "Juno Park joined Haddad Studio portfolio site",
		body: "Assigned to Site build.",
		daysAgo: 7,
		read: true,
		actor: "juno",
		context: ["project", "noor-site"],
	},
	{
		to: "theo",
		type: "message.new",
		title: "Ren Koda",
		body:
			"Saw it, thank you. I am wrapping a launch film this fortnight but a month out is realistic.",
		daysAgo: 0.6,
		read: false,
		actor: "ren",
		context: ["conversation", "theo-ren"],
	},
	{
		to: "daniel",
		type: "submission.received",
		title: "Samuel submitted Companion screens — v2",
		body: "Ticket: Mobile companion screens",
		daysAgo: 2,
		read: false,
		actor: "samuel",
		context: ["project", "atlas-analytics"],
	},
	{
		to: "daniel",
		type: "review.received",
		title: "Kwame Mensah reviewed Atlas Labs",
		body: '"A client who reviews on time" — 5 stars',
		daysAgo: 18,
		read: true,
		actor: "kwame",
	},
	{
		to: "daniel",
		type: "invoice.issued",
		title: "Invoice from North Loop",
		body: "Ingestion pipeline and warehouse schema — $15,000.00",
		daysAgo: 20,
		read: true,
		actionUrl: "/wallet/invoices",
	},
	{
		to: "miguel",
		type: "application.received",
		title: "Tomasz Wójcik applied to Android build",
		body: '"Happy to take the Android build once architecture lands…"',
		daysAgo: 2,
		read: false,
		actor: "tomasz",
		context: ["project", "loop-mobile"],
	},
	{
		to: "miguel",
		type: "application.received",
		title: "Juno Park applied to Architecture and design",
		body: '"I can own the architecture stage…"',
		daysAgo: 3,
		read: false,
		actor: "juno",
		context: ["project", "loop-mobile"],
	},
	{
		to: "kwame",
		type: "escrow.released",
		title: "$14,250.00 released to North Loop",
		body: "Event taxonomy and warehouse model was accepted and paid out; your share is $5,130.00.",
		daysAgo: 22,
		read: true,
		actor: "daniel",
		context: ["project", "atlas-analytics"],
		actionUrl: "/wallet/transactions",
	},
	{
		to: "kwame",
		type: "review.received",
		title: "Daniel Okafor left North Loop a 4.8-star review",
		body: '"Reliable, communicative, and the load test held"',
		daysAgo: 19,
		read: true,
		actor: "daniel",
	},
	{
		to: "kwame",
		type: "payout.sent",
		title: "Instant payout of $5,000.00 sent",
		body: "A small fee applies to instant payouts.",
		daysAgo: 16,
		read: true,
		actionUrl: "/wallet/payouts",
	},
	{
		to: "samuel",
		type: "stage.invite",
		title: "Miguel Santos invited you to iOS build",
		body: "Loop mobile app — offer $25,000.00",
		daysAgo: 1,
		read: false,
		actor: "miguel",
		context: ["project", "loop-mobile"],
	},
	{
		to: "samuel",
		type: "submission.revision_requested",
		title: "Revisions requested on Companion screens — v1",
		body: '"The drill-down chart clips on small Android screens…"',
		daysAgo: 6,
		read: true,
		actor: "daniel",
		context: ["project", "atlas-analytics"],
	},
	{
		to: "tomasz",
		type: "escrow.released",
		title: "$14,250.00 released to North Loop",
		body: "Ingestion pipeline and warehouse schema was accepted; your share is $3,847.50.",
		daysAgo: 20,
		read: true,
		actor: "daniel",
		context: ["project", "atlas-analytics"],
		actionUrl: "/wallet/transactions",
	},
	{
		to: "tomasz",
		type: "message.new",
		title: "Atlas × North Loop",
		body: "Miguel: Heads up: Loop mobile is open for applications.",
		daysAgo: 1,
		read: false,
		actor: "miguel",
		context: ["conversation", "atlas-north"],
	},
	{
		to: "ines",
		type: "stage.invite",
		title: "Priya Raman invited Atelier Nova to Brand refresh delivery",
		body: "Verdant brand refresh — offer $32,000.00",
		daysAgo: 14,
		read: true,
		actor: "priya",
		context: ["project", "verdant-brand"],
	},
	{
		to: "ines",
		type: "escrow.funded",
		title: "Escrow secured for Brand refresh delivery",
		body: "Helia Finance funded $32,000.00 for the Verdant brand refresh.",
		daysAgo: 11,
		read: true,
		actor: "priya",
		context: ["project", "verdant-brand"],
	},
	{
		to: "chloe",
		type: "team.invite",
		title: "Saoirse Byrne invited you to join Studio Fern",
		body: '"We could use a writer on the editorial side — fancy joining Fern?"',
		daysAgo: 3,
		read: false,
		actor: "saoirse",
		context: ["team", "fern"],
	},
	{
		to: "chloe",
		type: "account.email_verified",
		title: "Email verified",
		body: "Your address is confirmed — welcome to Projective.",
		daysAgo: 12,
		read: true,
	},
	{
		to: "chloe",
		type: "message.new",
		title: "Saoirse Byrne",
		body: "Hi Chloe! Yes, that is exactly what it is for.",
		daysAgo: 3,
		read: true,
		actor: "saoirse",
		context: ["conversation", "chloe-saoirse"],
	},
	{
		to: "saoirse",
		type: "message.new",
		title: "Chloe Winters",
		body: "Oh wow, thank you. Let me book the review first and think about Fern properly.",
		daysAgo: 2.8,
		read: false,
		actor: "chloe",
		context: ["conversation", "chloe-saoirse"],
	},
	{
		to: "saoirse",
		type: "profile.followed",
		title: "Chloe Winters started following you",
		body: "Freelance copywriter",
		daysAgo: 5,
		read: true,
		actor: "chloe",
	},
	{
		to: "lena",
		type: "application.declined",
		title: "Your application to Discovery and research was declined",
		body: "Helia wallet redesign — the stage was filled.",
		daysAgo: 7,
		read: true,
		context: ["project", "helia-wallet"],
	},
	{
		to: "aiko",
		type: "team.member_joined",
		title: "You joined Atelier Nova",
		body: "Inês Duarte added you as Illustrator.",
		daysAgo: 120,
		read: true,
		actor: "ines",
		context: ["team", "nova"],
	},
];
// #endregion
