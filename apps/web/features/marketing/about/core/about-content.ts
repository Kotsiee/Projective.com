/**
 * about-content — the words and the static facts of `/about` (Decision #277). One module so a
 * reviewer checks every public claim the page makes in one place, and a test pins its shape.
 *
 * Every statement here describes shipped behaviour — PRODUCT_SPEC §Escrow, Wallets & Finance and
 * §Messaging (the Handover state), finance-model.md §7, Decisions #147 / #186 / #191 / #196 / #197 /
 * #212 — and nothing claims a certification the company does not hold. The product's words are
 * Client, Freelancer, Team and Business (owner ruling (c)); "escrow" stays in explanatory copy.
 *
 * PLACEHOLDERS, flagged for the owner: the founders' names, roles and bios, and the pull quote's
 * attribution, until the real ones are supplied.
 */

// #region Page meta
/** The `<title>` (without the brand) and the meta description. */
export const ABOUT_META = {
	title: "About",
	description:
		"Projective splits a project into stages, staffs each one with a Freelancer or a Team, and holds every stage's payment in escrow until the Client approves the work. Live figures, how delivery works, and how it's built.",
} as const;

/** The canonical path. */
export const ABOUT_PATH = "/about";
// #endregion

// #region Opening
export const ABOUT_HERO = {
	eyebrow: "About Projective",
	title: "From working alone to working as a team — with the money protected at every step.",
	standfirst:
		"Projective splits a project into stages, staffs each one with a Freelancer or a ready-made Team, and holds every stage's payment in escrow until the Client approves the work. Nobody starts unpaid, and nobody pays for work they haven't seen.",
} as const;
// #endregion

// #region The friction · the model
/** One side of the contrast: a section-caps label and four short statements. */
export interface ContrastSide {
	id: string;
	label: string;
	statements: readonly [string, string, string, string];
}

export const ABOUT_CONTRAST: readonly [ContrastSide, ContrastSide] = [
	{
		id: "friction",
		label: "The friction",
		statements: [
			"A project bigger than one person gets stitched together across separate contracts, inboxes and invoices.",
			"Freelancers start work on a promise and chase the payment once it's done.",
			"Clients pay up front and hope the last milestone arrives.",
			"When something goes wrong, it's one person's word against another's.",
		],
	},
	{
		id: "model",
		label: "The model",
		statements: [
			"One project, split into stages — each with its own price, milestone and people.",
			"Each stage is paid into escrow before work starts, so the money is already there.",
			"Freelancers and Teams claim the work, and a Team's payout splits by its own agreement.",
			"If a stage is disputed, its money stays in escrow until the dispute is settled.",
		],
	},
];
// #endregion

// #region Pull quote
export const ABOUT_QUOTE = {
	text:
		"Nobody should have to choose between starting the work and trusting they'll be paid for it. The money should already be there — and move only when the work is done.",
	attribution: "The Projective founding team",
} as const;
// #endregion

// #region Sections
export const ABOUT_METRICS_COPY = {
	label: "By the numbers",
	cadence: "Updated hourly",
	unavailable:
		"Live figures can't be read right now. They're computed from the platform itself, so we'd rather show nothing than a stale guess.",
} as const;

export const ABOUT_TOUR_COPY = {
	label: "How delivery works",
	lead:
		"Follow one stage's money from the Client's wallet to the Freelancer's bank. Pick a step, or let it play.",
} as const;
// #endregion

// #region Founders
/** A founder as the page lists them. `links` stays empty until real profiles exist. */
export interface Founder {
	id: string;
	name: string;
	role: string;
	bio: string;
	/** A web-served image (`/test_images/…`, copied in P0) with its intrinsic size. */
	avatar: { src: string; w: number; h: number };
	links: ReadonlyArray<{ href: string; label: string }>;
}

export const ABOUT_FOUNDERS_LABEL = "The people building it";

export const ABOUT_FOUNDERS: readonly Founder[] = [
	{
		id: "founder-1",
		name: "Founder name — XXXX",
		role: "Co-founder · Role — XXXX",
		bio: "One-line bio — XXXX",
		avatar: { src: "/test_images/profile_4.jpg", w: 495, h: 619 },
		links: [],
	},
	{
		id: "founder-2",
		name: "Founder name — XXXX",
		role: "Co-founder · Role — XXXX",
		bio: "One-line bio — XXXX",
		avatar: { src: "/test_images/profile_5.jpg", w: 712, h: 430 },
		links: [],
	},
	{
		id: "founder-3",
		name: "Founder name — XXXX",
		role: "Co-founder · Role — XXXX",
		bio: "One-line bio — XXXX",
		avatar: { src: "/test_images/profile_6.jpg", w: 387, h: 516 },
		links: [],
	},
];
// #endregion

// #region Security & architecture
/**
 * One factual statement about how the platform is built. `link` names the public document that
 * states it (the legal set, P1 — fixed slugs); a statement whose proof lives only in the
 * engineering record (the policies, probes and ledger triggers in the repository) carries none
 * rather than a link that proves nothing.
 */
export interface Credential {
	id: string;
	title: string;
	body: string;
	link?: { href: string; label: string };
}

export const ABOUT_CREDENTIALS_LABEL = "How it's built";

export const ABOUT_CREDENTIALS: readonly Credential[] = [
	{
		id: "escrow",
		title: "Payment protection is escrow",
		body:
			"Every stage is paid into escrow before work starts, and the money only moves on an approval, a completed session, a dispute ruling or an agreed exit.",
		link: { href: "/legal/escrow-terms", label: "Read the escrow terms" },
	},
	{
		id: "ledger",
		title: "An append-only ledger",
		body:
			"Every wallet movement is a ledger line that can't be edited or deleted — a correction is a new line — and every balance is checked against its ledger each night.",
	},
	{
		id: "rls",
		title: "Row-level security",
		body:
			"Postgres row-level security guards every table a visitor or a member can query, so the database itself decides who may read each row.",
	},
	{
		id: "concurrency",
		title: "Escrow tested under pressure",
		body:
			"Holds, releases and refunds are tested with two sessions settling the same escrow at once, so a stage can't be paid out twice.",
	},
	{
		id: "stripe",
		title: "Stripe Connect and Stripe Identity",
		body:
			"Freelancers verify their identity with Stripe Identity, and withdrawals are paid out to their bank through Stripe Connect.",
		link: { href: "/legal/privacy", label: "Read the privacy policy" },
	},
	{
		id: "contact-masking",
		title: "Contact details stay on the platform",
		body:
			"Until a project's final payment is released, email addresses, phone numbers and payment links in its messages are masked automatically, in the database itself.",
		link: { href: "/legal/acceptable-use", label: "Read the acceptable use policy" },
	},
];
// #endregion

// #region Closing band
export const ABOUT_CTA = {
	title: "Start with one stage.",
	body:
		"Describe the work, fund the first stage, and release the money only once you've approved what you asked for.",
	primary: { label: "Start a project", guestHref: "/join", memberHref: "/projects?create=1" },
	secondary: { label: "Talk to sales", href: "/contact?intent=sales" },
} as const;
// #endregion
