import type { FeedbackCategory, FeedbackIdeaState } from "@projective/types/community";

/**
 * feedback-fixtures — the feedback board the fixture road serves (`COMMUNITY_BACKEND_LIVE` off,
 * Decision #272): the SAME sixteen ideas the development seed loads (`supabase/seeds/gen/world.ts`
 * `FEEDBACK_IDEAS` → `12_community_feedback.sql`), with the ids and `fbk-` slugs the seed derives
 * and the personas who wrote and voted for them. `feedback-fixtures.contract.test.ts` reads the seed
 * world and fails on any difference, so flipping the gate never changes what the board says.
 *
 * Authored relative to "now" (`daysAgo`), like the seed, so the board always reads as recent; the
 * records themselves are built by `feedback-store.ts` at the instant the store first loads.
 */

// #region Shapes
/** A person on the demo board, as the profile cards would show them. */
export interface FeedbackDemoPerson {
	/** `org.users_public.user_id` — the seed's deterministic id for the persona. */
	userId: string;
	handle: string;
	name: string;
	/** The persona's seeded profile picture, served statically in fixture mode; `null` for initials. */
	avatar: string | null;
}

/** One demo idea: the seed world's spec plus the id and slug the seed derives from its key. */
export interface FeedbackDemoIdea {
	key: string;
	id: string;
	slug: string;
	/** A key of {@link FEEDBACK_DEMO_PEOPLE}. */
	author: string;
	title: string;
	impact: string;
	body?: string;
	category: FeedbackCategory;
	daysAgo: number;
	/** The operator moves after the submission, oldest first; the last is where the idea stands. */
	moves: ReadonlyArray<{ to: FeedbackIdeaState; daysAgo: number }>;
	/** Who voted besides the author, whose own vote is cast with the idea. */
	voters: readonly string[];
	response?: { text: string; daysAgo: number };
}
// #endregion

// #region The board
/** Everyone who wrote or voted for a demo idea, keyed by the seed world's persona key. */
export const FEEDBACK_DEMO_PEOPLE: Readonly<Record<string, FeedbackDemoPerson>> = {
	maris: {
		userId: "6ce1906f-caab-4708-a19e-df3d8960666e",
		handle: "marisdelacroix",
		name: "Maris Delacroix",
		avatar: "/test_images/profile_1.jpg",
	},
	ren: {
		userId: "bdff9d38-7124-4a49-af5d-c88eb4fe8b57",
		handle: "renkoda",
		name: "Ren Koda",
		avatar: "/test_images/profile_2.webp",
	},
	juno: {
		userId: "45a4c6ae-d818-45fd-a62b-db44f1f69eab",
		handle: "juno",
		name: "Juno Park",
		avatar: "/test_images/profile_3.jpg",
	},
	noor: {
		userId: "1fee216e-a637-4619-a90a-4ae03bb1ed8b",
		handle: "noor",
		name: "Noor Haddad",
		avatar: "/test_images/profile_4.jpg",
	},
	theo: {
		userId: "2bdebf14-f7dc-40af-acd8-fe22cb9916fd",
		handle: "theo",
		name: "Theo Almeida",
		avatar: "/test_images/profile_5.jpg",
	},
	ines: {
		userId: "9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d",
		handle: "inesduarte",
		name: "Inês Duarte",
		avatar: "/test_images/profile_6.jpg",
	},
	kwame: {
		userId: "c7173d3f-8b15-4876-afbf-499d17513a44",
		handle: "kwamemensah",
		name: "Kwame Mensah",
		avatar: "/test_images/profile_7.jpg",
	},
	saoirse: {
		userId: "c859a726-490c-4f6d-a184-8984de3994d3",
		handle: "saoirsebyrne",
		name: "Saoirse Byrne",
		avatar: "/test_images/profile_8.jpeg",
	},
	priya: {
		userId: "de29f2ce-0f36-4db5-a417-4edc88cedf83",
		handle: "priyaraman",
		name: "Priya Raman",
		avatar: null,
	},
	daniel: {
		userId: "292e1827-f189-4f34-ab35-27c9f0320926",
		handle: "danielokafor",
		name: "Daniel Okafor",
		avatar: null,
	},
	lena: {
		userId: "3fc3da04-549b-4239-aca3-fa82f713dbaf",
		handle: "lenamueller",
		name: "Lena Müller",
		avatar: null,
	},
	tomasz: {
		userId: "2e4274fb-e76b-4640-ad31-c66d7fbea842",
		handle: "tomaszwojcik",
		name: "Tomasz Wójcik",
		avatar: null,
	},
	aiko: {
		userId: "0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb",
		handle: "aikotanaka",
		name: "Aiko Tanaka",
		avatar: null,
	},
	samuel: {
		userId: "5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd",
		handle: "samuelnkemelu",
		name: "Samuel Nkemelu",
		avatar: null,
	},
	hannah: {
		userId: "35ce4987-15b3-4c38-a438-2bb9c35df15a",
		handle: "hannahcole",
		name: "Hannah Cole",
		avatar: null,
	},
	miguel: {
		userId: "b30145ef-f693-439c-a2c4-8b3db32a54a2",
		handle: "miguelsantos",
		name: "Miguel Santos",
		avatar: null,
	},
	chloe: {
		userId: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
		handle: "chloewinters",
		name: "Chloe Winters",
		avatar: null,
	},
};

/** The sixteen demo ideas, in the seed world's order. */
export const FEEDBACK_DEMO_IDEAS: readonly FeedbackDemoIdea[] = [
	{
		key: "named-saved-lists",
		id: "0351db27-3323-46cc-a59f-058d9cda6452",
		slug: "fbk-kbyrph7gdt",
		author: "juno",
		title: "Save listings into named lists",
		impact:
			"I bookmark services for different clients and they all land in one long pile. A list per client would let me send a shortlist without rebuilding it every time.",
		category: "explore",
		daysAgo: 120,
		moves: [{ to: "ready", daysAgo: 105 }, { to: "in_progress", daysAgo: 80 }, {
			to: "complete",
			daysAgo: 60,
		}],
		voters: ["noor", "theo", "ren", "chloe", "aiko"],
		response: {
			text:
				"Shipped. Save anything to a named collection from its page, then find every list under Saved.",
			daysAgo: 60,
		},
	},
	{
		key: "pin-messages",
		id: "ecb48b0a-463d-4afb-a76e-fe54436c2e2d",
		slug: "fbk-n3juwv2t2f",
		author: "hannah",
		title: "Pin the important message in a busy conversation",
		impact:
			"Scope decisions get buried under fifty messages of back-and-forth. Pinning the agreed brief would save everyone scrolling up to find it.",
		category: "messaging",
		daysAgo: 95,
		moves: [{ to: "ready", daysAgo: 85 }, { to: "in_progress", daysAgo: 70 }, {
			to: "complete",
			daysAgo: 48,
		}],
		voters: ["priya", "maris", "samuel", "kwame"],
		response: {
			text: "Shipped. Pin a message from its menu and everyone in the room sees it at the top.",
			daysAgo: 48,
		},
	},
	{
		key: "card-stage-funding",
		id: "3e8cc34d-4253-46c0-a201-19eb4af0e38e",
		slug: "fbk-8caxcq6che",
		author: "priya",
		title: "Fund a stage by card, not only from the wallet",
		impact:
			"Topping up the wallet and then funding the stage is two steps and two receipts for one payment. Our finance team asked for one.",
		category: "escrow_payments",
		daysAgo: 150,
		moves: [{ to: "ready", daysAgo: 140 }, { to: "in_progress", daysAgo: 110 }, {
			to: "complete",
			daysAgo: 90,
		}],
		voters: ["hannah", "miguel", "daniel", "noor", "theo", "ines"],
		response: {
			text:
				"Shipped. Choose “Continue to payment” when you fund a stage to pay its escrow by card in one step.",
			daysAgo: 90,
		},
	},
	{
		key: "reading-comfort",
		id: "8e0eacb1-9691-45a6-a386-b2d358cf6110",
		slug: "fbk-vvg3hx9ogb",
		author: "lena",
		title: "A dyslexia-friendly font and a reduced-motion setting",
		impact:
			"Long briefs are tiring for me to read, and some of the sliding panels make me feel queasy. I'd like both settings to follow me across devices.",
		category: "other",
		daysAgo: 70,
		moves: [{ to: "ready", daysAgo: 64 }, { to: "in_progress", daysAgo: 50 }, {
			to: "complete",
			daysAgo: 30,
		}],
		voters: ["aiko", "chloe", "tomasz"],
		response: {
			text:
				"Shipped. Appearance settings now include a dyslexia-friendly font, high contrast and reduced motion, saved to your account.",
			daysAgo: 30,
		},
	},
	{
		key: "command-palette",
		id: "ec41d453-b79a-4330-a0a5-aa9116dd86a6",
		slug: "fbk-uvz5jm44es",
		author: "maris",
		title: "Jump anywhere from the keyboard",
		impact:
			"I move between five projects, my wallet and the inbox all day. A command palette would save me a dozen clicks an hour.",
		body:
			"Something like Cmd+K: type a project, a person or a setting, press Enter, and you are there.",
		category: "other",
		daysAgo: 45,
		moves: [{ to: "ready", daysAgo: 38 }, { to: "in_progress", daysAgo: 12 }],
		voters: ["juno", "ren", "samuel", "tomasz", "saoirse", "kwame", "lena", "aiko"],
		response: {
			text:
				"In progress. The first version searches your projects, people and settings from one shortcut.",
			daysAgo: 12,
		},
	},
	{
		key: "calendar-sync",
		id: "5c024306-5d85-4c2d-a754-4120f7495fdf",
		slug: "fbk-n3uqay55h4",
		author: "saoirse",
		title: "Sync booked sessions to my Google Calendar",
		impact:
			"Clients book review sessions here, but my day lives in Google Calendar. I have double-booked twice because I forgot to copy one across.",
		category: "projects",
		daysAgo: 60,
		moves: [{ to: "ready", daysAgo: 50 }, { to: "in_progress", daysAgo: 9 }],
		voters: ["chloe", "aiko", "juno", "maris", "noor"],
		response: {
			text:
				"In progress, starting with a one-way sync of booked sessions to a calendar you connect.",
			daysAgo: 9,
		},
	},
	{
		key: "stage-payment-split",
		id: "784f9758-0aa3-4847-afe3-55324da68159",
		slug: "fbk-ghna9u6per",
		author: "kwame",
		title: "Split one stage's payment between two freelancers",
		impact:
			"When two of us share a stage we settle the split ourselves afterwards, which defeats the point of escrow.",
		category: "escrow_payments",
		daysAgo: 33,
		moves: [{ to: "ready", daysAgo: 25 }, { to: "in_progress", daysAgo: 6 }],
		voters: ["tomasz", "samuel", "ines", "aiko", "lena"],
	},
	{
		key: "pause-stage",
		id: "171588ad-e8d3-4e36-a1cb-398bc14dc9d4",
		slug: "fbk-2trxnwfsgp",
		author: "priya",
		title: "Pause a stage without cancelling it",
		impact:
			"Sometimes our side is the blocker — a legal review, a holiday. Today we either keep the clock running or end the stage under Fair Exit, and neither is fair to the freelancer.",
		body:
			"A pause would freeze the deadline and keep the escrow held, with a reason the freelancer can see.",
		category: "projects",
		daysAgo: 28,
		moves: [{ to: "ready", daysAgo: 20 }],
		voters: ["hannah", "daniel", "miguel", "noor", "kwame", "ines", "maris", "theo", "samuel"],
		response: {
			text:
				"Planned. A paused stage will freeze its deadline and keep its escrow held, and the freelancer will be told why and for how long.",
			daysAgo: 19,
		},
	},
	{
		key: "client-review-reminders",
		id: "1a547c30-9640-441f-ab3d-f39e9e6b93ed",
		slug: "fbk-m4n2u2dt6u",
		author: "noor",
		title: "Remind me before a stage is due for my review",
		impact:
			"I only notice a stage is ready when the freelancer chases me. A heads-up the day before would let me block time to give proper feedback.",
		category: "projects",
		daysAgo: 22,
		moves: [{ to: "ready", daysAgo: 15 }],
		voters: ["theo", "hannah", "miguel"],
	},
	{
		key: "saved-replies",
		id: "c818784e-bac3-4689-aafa-f460bc7ee5eb",
		slug: "fbk-bdryfgh9fh",
		author: "ines",
		title: "Saved replies for the questions I answer every week",
		impact:
			"Half my first messages explain the same three things: how I scope, my revision policy and what I need to start. I retype them every time.",
		category: "messaging",
		daysAgo: 18,
		moves: [{ to: "ready", daysAgo: 10 }],
		voters: ["saoirse", "kwame", "juno", "ren"],
	},
	{
		key: "working-hours-overlap",
		id: "7533564f-1fe7-43bc-ac23-34f122d5a60e",
		slug: "fbk-m7pzkd9434",
		author: "daniel",
		title: "Filter freelancers by working-hours overlap",
		impact:
			"Our team is in Lagos and we need at least three shared hours a day. I end up opening every profile to check the time zone.",
		category: "explore",
		daysAgo: 26,
		moves: [{ to: "ready", daysAgo: 17 }],
		voters: ["miguel", "priya", "hannah", "noor", "theo", "chloe"],
		response: {
			text:
				"Planned. Explore will use each freelancer's published working hours to show how many overlap with yours.",
			daysAgo: 16,
		},
	},
	{
		key: "portfolio-case-studies",
		id: "281212cf-011e-4c12-a845-6791f6899a5c",
		slug: "fbk-f36zov3j3v",
		author: "ren",
		title: "Case studies on my profile, not just images",
		impact:
			"A single render doesn't show the brief, the constraints or what changed. Clients ask me to walk them through it on a call every time.",
		category: "profiles",
		daysAgo: 14,
		moves: [{ to: "ready", daysAgo: 7 }],
		voters: ["maris", "juno", "saoirse"],
	},
	{
		key: "tip-after-approval",
		id: "f0642c6e-06b3-4b0f-aea4-9eb8faf75ae9",
		slug: "fbk-vgxyd2ex3m",
		author: "theo",
		title: "Add a tip when I approve a stage",
		impact:
			"When someone goes well beyond the brief I'd like to say thank you with more than a review, without opening a new stage for it.",
		category: "escrow_payments",
		daysAgo: 3,
		moves: [],
		voters: [],
	},
	{
		key: "hide-rate-in-search",
		id: "7b5216be-89f5-4a65-a70a-228c4b7d9a7b",
		slug: "fbk-t55goucrhs",
		author: "lena",
		title: "Hide my hourly rate from search results",
		impact:
			"I price per project, and a rate shown out of context puts off the clients I want before we have even talked.",
		category: "profiles",
		daysAgo: 2,
		moves: [],
		voters: [],
	},
	{
		key: "reply-to-review",
		id: "3ef315a5-84b8-409a-a97f-55db2e1c1110",
		slug: "fbk-f7kpn326dg",
		author: "samuel",
		title: "Let me reply to a review on my profile",
		impact:
			"A client misread a delay that was on their side. I'd like to add one calm, public reply beneath their review.",
		category: "profiles",
		daysAgo: 1,
		moves: [],
		voters: [],
	},
	{
		key: "pay-outside-escrow",
		id: "3a2898d0-b8c0-49b1-acd2-1da2997ee9a3",
		slug: "fbk-koc2ep2zhe",
		author: "miguel",
		title: "Let me pay a freelancer directly to skip the fee",
		impact: "For small fixes the fee feels like a lot, and we already know each other well.",
		category: "escrow_payments",
		daysAgo: 50,
		moves: [{ to: "archived", daysAgo: 44 }],
		voters: [],
		response: {
			text:
				"Closed. Payments stay inside escrow so both sides keep their protection and the work keeps its record. A small fix can be a single-ticket purchase instead.",
			daysAgo: 44,
		},
	},
];

// #endregion
