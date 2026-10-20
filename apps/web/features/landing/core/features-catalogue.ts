/**
 * features-catalogue — the typed catalogue `/features` prints (`flows/LANDING.md` §2.5, §2.6, §4.12,
 * §5, §6; work order L5 as amended by Decision #288): its five chapters, every feature with its
 * §4.12 one-line description word for word, the demo its "Try it" opens (only where L3 built one),
 * the help article its "Learn more" opens (only where the help centre has one), and its status.
 *
 * The page is an editorial chapter index, never a bento of boxed tiles (#288 NARROWS #280): each
 * chapter a section with a section-header label and a display h2, each feature a row of plain text
 * — its title (h3), its description, and its controls. Two rows are HELD, catalogued and never
 * rendered: V10 "Your currency" (#281 flag (c): the rates are seed-only and "locked at funding" is
 * false) and V11 "Team builder" (Decision #302 (B): its claim W1 is shipped only as a demo, and no
 * team-builder demo exists yet). The three Coming soon rows are static text with no control at all.
 *
 * Pure data and pure functions: the server page, the "Try it" dialog island and the tests share it,
 * so it imports nothing that renders.
 */
import type { DemoId } from "./demos/demo-contract.ts";
import { demoHref } from "./demo-stage.ts";

// #region Types
/** A chapter's slug: its section's id and the `?section=` value that opens it. */
export type FeatureChapterId = "find-and-hire" | "run-the-work" | "money" | "trust" | "coming-soon";

/**
 * Which voice a chapter speaks in (§2.6): the precision voice on the canvas, the warm editorial
 * voice on its solid band (the serif display, the warm inks), or the muted Coming soon chapter.
 */
export type FeatureChapterVoice = "precision" | "editorial" | "muted";

/** One chapter of the index. */
export interface FeatureChapter {
	id: FeatureChapterId;
	/** The chapter's h2 (§2.5, §2.6), in the display register. */
	title: string;
	voice: FeatureChapterVoice;
}

/**
 * Where a feature stands (`flows/LANDING.md` §6): `live` is shipped and printed with its controls,
 * `coming_soon` is printed as static text labelled "Coming soon", `held` is never printed.
 */
export type FeatureStatus = "live" | "coming_soon" | "held";

/** One feature of the catalogue. */
export interface FeatureEntry {
	/** The row's anchor (`/features#work-board`): unique on the page, never a chapter's slug. */
	id: string;
	/** The §2.3 / §6 visualizer it is (`V1`…`V16`), or `null` for the tax pot, which has none. */
	visualizer: string | null;
	chapter: FeatureChapterId;
	/** The row's h3 (§4.12 "Tile"). */
	title: string;
	/**
	 * The §4.12 one-line description, word for word (claim tags dropped). A live row's is under 15
	 * words; a Coming soon row's opens "Coming soon:" itself; a held row keeps the line it returns
	 * with (V11), or none when it has no approved line (V10).
	 */
	description: string;
	/** The row's small print (§4.12: V13's "Coming soon: …"), or `null`. */
	smallPrint: string | null;
	/** The §5 claim rows its sentences rest on (`[K1]`, `[B3]`…), description then small print. */
	claims: readonly string[];
	/**
	 * The L3 demo its "Try it" opens (`core/demos/demo-contract.ts`), or `null` when none was built —
	 * then no "Try it" renders (gate 11). V12 has none: the payments demo cannot open with Fair Exit
	 * already on.
	 */
	demo: DemoId | null;
	/**
	 * Its help article as `<category>/<slug>` under `/help` (P2, the seeded `editorial.help_articles`),
	 * or `null` when the help centre has no article on it — then no "Learn more" renders. Never a
	 * guessed slug: `features-catalogue.test.ts` checks each against the help content and its seed.
	 */
	helpSlug: string | null;
	status: FeatureStatus;
}
// #endregion

// #region Copy
/** The page's own words (`flows/LANDING.md` §4.12). */
export const FEATURES_COPY = {
	/** The section-header label above the h1 (§2.5, §2.6). */
	eyebrow: "Features",
	/** The page's one h1. */
	title: "Everything Projective does",
	/** `[P9]` */
	lead: "Try each feature with example data. No real money moves.",
	/** The chapter navigation's landmark name. */
	nav: "Chapters",
	/**
	 * A demo row's control (tier 4 outlined): its visible words, the start of its name
	 * ({@link tryLabel}), the feature's title following them for a screen reader.
	 */
	tryIt: "Try it",
	/** A help row's text link; the feature's title follows it for a screen reader. */
	learnMore: "Learn more",
	/** The dialog's stage note, always visible beside the demo `[P9]`. */
	stageNote: "Example only. No real money moves.",
	/** The dialog's reset (its words are its whole name, Decision #298 (D)). */
	reset: "Start again",
} as const;

/** The head facts (§4.12): the meta title and description. "Escrow" is not in them (#283 (C)). */
export const FEATURES_META = {
	/** `[A1]` `[K1]` `[B1]` */
	title: "Projective features — teams, boards and payment protection",
	/** `[A1]` `[K1]` `[J8]` `[N1]` `[B1]` */
	description:
		"See everything Projective does: ready-made teams, work boards, booking, team pay and payment protection for every stage.",
} as const;

/** The page's path. */
export const FEATURES_PATH = "/features";

/** The query parameter that names the chapter a link opens (`/features?section=money`). */
export const SECTION_PARAM = "section";

/**
 * A demo row's "Try it" name: `Try it: Work board` — its visible words, then the feature's title
 * (visually hidden), so the name holds the label a speech-input user says (WCAG 2.5.3 Label in Name;
 * Decision #302 (A), amending §4.12's `aria-label` "Try {title}" as #298 (D) amended §4.4).
 */
export function tryLabel(title: string): string {
	return `${FEATURES_COPY.tryIt}: ${title}`;
}
// #endregion

// #region Chapters
/** The five chapters, in page order (§2.5, §2.6). */
export const FEATURE_CHAPTERS: readonly FeatureChapter[] = [
	{ id: "find-and-hire", title: "Find & hire", voice: "precision" },
	{ id: "run-the-work", title: "Run the work", voice: "precision" },
	{ id: "money", title: "Money", voice: "editorial" },
	{ id: "trust", title: "Trust", voice: "editorial" },
	{ id: "coming-soon", title: "Coming soon", voice: "muted" },
];

/** Whether `value` is a chapter's slug. */
export function isFeatureChapterId(value: unknown): value is FeatureChapterId {
	return typeof value === "string" && FEATURE_CHAPTERS.some((chapter) => chapter.id === value);
}

/**
 * The chapter a `?section=` value opens: an exact slug (case and surrounding space forgiven), else
 * `null` — an unknown value opens nothing and is never an error.
 */
export function parseSection(value: string | null | undefined): FeatureChapterId | null {
	const slug = value?.trim().toLowerCase();
	return isFeatureChapterId(slug) ? slug : null;
}

/** A chapter's position label, two digits (`01`…`05`), in the section-header register. */
export function chapterNumber(chapterId: FeatureChapterId): string {
	const index = FEATURE_CHAPTERS.findIndex((chapter) => chapter.id === chapterId);
	return String(index + 1).padStart(2, "0");
}

/** The id of a chapter's h2: its section is labelled by it. */
export function chapterTitleId(chapterId: FeatureChapterId): string {
	return `${chapterId}-title`;
}
// #endregion

// #region Catalogue
/**
 * Every feature, in page order (§4.12's table). Each description is §4.12's sentence with its claim
 * tags dropped; each tag resolves to a §5 row. The help slugs are the seeded articles that explain
 * the feature itself, and nothing nearer than that: the search, the timeline, booking and files have
 * no article yet, so they have no "Learn more" (nor would the held Team builder: no article covers
 * it).
 */
export const FEATURE_CATALOGUE: readonly FeatureEntry[] = [
	{
		id: "search",
		visualizer: "V8",
		chapter: "find-and-hire",
		title: "Search as you type",
		description: "Search people, teams, services and projects, with suggestions as you type.",
		smallPrint: null,
		claims: ["U1"],
		demo: null,
		helpSlug: null,
		status: "live",
	},
	{
		id: "team-builder",
		visualizer: "V11",
		chapter: "find-and-hire",
		title: "Team builder",
		description: "Sketch the team you need, then find teams like it.",
		smallPrint: null,
		claims: ["W1"],
		demo: null,
		helpSlug: null,
		status: "held",
	},
	{
		id: "services-and-sessions",
		visualizer: "V13",
		chapter: "find-and-hire",
		title: "Services & sessions",
		description: "Book a live session. Your payment is held until 24 hours after it ends.",
		smallPrint: "Coming soon: digital products with instant download.",
		claims: ["J2", "W2"],
		demo: null,
		helpSlug: "disputes-and-fair-exit/session-cancellations",
		status: "live",
	},
	{
		id: "work-board",
		visualizer: "V1",
		chapter: "run-the-work",
		title: "Work board",
		description: "Every job you post runs on a board. Work starts once it's paid for.",
		smallPrint: null,
		claims: ["K1", "B3"],
		demo: "board",
		helpSlug: "projects-and-stages/claim-and-start-a-ticket",
		status: "live",
	},
	{
		id: "timeline",
		visualizer: "V3",
		chapter: "run-the-work",
		title: "Timeline",
		description: "See every stage on a timeline. Zoom out to months or in to days.",
		smallPrint: null,
		claims: ["T1"],
		demo: null,
		helpSlug: null,
		status: "live",
	},
	{
		id: "booking",
		visualizer: "V4",
		chapter: "run-the-work",
		title: "Booking",
		description: "Pick a time in your time zone. Moving a group session? Attendees vote.",
		smallPrint: null,
		claims: ["J8", "J10"],
		demo: "booking",
		helpSlug: null,
		status: "live",
	},
	{
		id: "ways-to-work",
		visualizer: "V9",
		chapter: "run-the-work",
		title: "Ways to work",
		description: "See how a task, a job, ongoing work and a session each run.",
		smallPrint: null,
		claims: ["L4"],
		demo: null,
		helpSlug: "getting-started/choose-a-project-type",
		status: "live",
	},
	{
		id: "team-room",
		visualizer: "V6",
		chapter: "run-the-work",
		title: "Team room",
		description: "Chat and share files in one room. New messages mask contact details mid-project.",
		smallPrint: null,
		claims: ["R1", "R2"],
		demo: null,
		helpSlug: "account-and-security/contact-details-in-messages",
		status: "live",
	},
	{
		id: "payment-protection",
		visualizer: "V2",
		chapter: "money",
		title: "Payment protection",
		description: "Pay for each stage before it starts. The team is paid when you approve.",
		smallPrint: null,
		claims: ["B3", "B2"],
		demo: "payments",
		helpSlug: "escrow-and-payments/what-is-escrow",
		status: "live",
	},
	{
		id: "team-pay",
		visualizer: "V5",
		chapter: "money",
		title: "Team pay",
		description: "Watch a stage payment split into each member's agreed share, to the penny.",
		smallPrint: null,
		claims: ["N1", "N4"],
		demo: "splits",
		helpSlug: "teams-and-businesses/create-a-team",
		status: "live",
	},
	{
		id: "your-currency",
		visualizer: "V10",
		chapter: "money",
		title: "Your currency",
		description: "",
		smallPrint: null,
		claims: [],
		demo: null,
		helpSlug: null,
		status: "held",
	},
	{
		id: "fair-exit",
		visualizer: "V12",
		chapter: "money",
		title: "Fair Exit & no-shows",
		description: "If work stops, end the stage fairly. Missed a session? Report a no-show.",
		smallPrint: null,
		claims: ["F1", "J3"],
		demo: null,
		helpSlug: "disputes-and-fair-exit/end-a-stage-with-fair-exit",
		status: "live",
	},
	{
		id: "verification",
		visualizer: "V16",
		chapter: "trust",
		title: "Verification",
		description: "Stripe checks ID and bank details before anyone takes paid project work.",
		smallPrint: null,
		claims: ["H1"],
		demo: null,
		helpSlug: "payouts-and-verification/get-payout-ready",
		status: "live",
	},
	{
		id: "files-and-sharing",
		visualizer: "V7",
		chapter: "trust",
		title: "Files & sharing",
		description: "Preview files and share links that expire. Program files like .exe are refused.",
		smallPrint: null,
		claims: ["S1", "S2", "S3"],
		demo: null,
		helpSlug: null,
		status: "live",
	},
	{
		id: "sell-your-best-work",
		visualizer: "V14",
		chapter: "coming-soon",
		title: "Sell your best work",
		description:
			"Coming soon: turn great work into a template you can sell, with a share for the client who commissioned it.",
		smallPrint: null,
		claims: ["X1"],
		demo: null,
		helpSlug: null,
		status: "coming_soon",
	},
	{
		id: "connected-tools",
		visualizer: "V15",
		chapter: "coming-soon",
		title: "Connected tools",
		description: "Coming soon: link the tools your team already uses.",
		smallPrint: null,
		claims: ["X2"],
		demo: null,
		helpSlug: null,
		status: "coming_soon",
	},
	{
		id: "tax-pot",
		visualizer: null,
		chapter: "coming-soon",
		title: "Tax pot",
		description: "Coming soon: set money aside for tax automatically.",
		smallPrint: null,
		claims: ["X3"],
		demo: null,
		helpSlug: null,
		status: "coming_soon",
	},
];

/** The rows the page prints, in page order: every feature that is not held. */
export function printedFeatures(
	catalogue: readonly FeatureEntry[] = FEATURE_CATALOGUE,
): FeatureEntry[] {
	return catalogue.filter((entry) => entry.status !== "held");
}

/** A chapter's printed rows, in page order. */
export function chapterFeatures(
	chapterId: FeatureChapterId,
	catalogue: readonly FeatureEntry[] = FEATURE_CATALOGUE,
): FeatureEntry[] {
	return printedFeatures(catalogue).filter((entry) => entry.chapter === chapterId);
}

/**
 * A row's "Try it" demo, or `null`: only a live row with a built demo has one; a Coming soon row
 * never does, whatever its record says.
 */
export function featureDemo(entry: FeatureEntry): DemoId | null {
	return entry.status === "live" ? entry.demo : null;
}

/** A row's "Learn more" address (`/help/<category>/<slug>`), or `null` when it has none. */
export function featureHelpHref(entry: FeatureEntry): string | null {
	return entry.status === "live" && entry.helpSlug !== null ? `/help/${entry.helpSlug}` : null;
}

/**
 * Where a row's "Try it" goes with no JavaScript: the landing's demo stage with that demo's tab open
 * (`/?demo=board#demo`), which the `/` route renders with no script. Hydrated, the dialog island
 * opens the same demo in place instead.
 */
export function featureTryHref(demo: DemoId): string {
	return demoHref(demo);
}

/** The words of a sentence as a reader counts them (a number and "it's" are one word each). */
export function wordCount(sentence: string): number {
	return sentence.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** The "Coming soon" lead of a Coming soon row's description, which the row prints as its label. */
export const COMING_SOON_LEAD = "Coming soon:";

/**
 * A Coming soon row's description split at its lead — `["Coming soon:", " link the tools…"]` — so the
 * row can set the lead as its label in the stronger ink while every word stays verbatim. Any other
 * description comes back whole, with an empty lead.
 */
export function comingSoonParts(description: string): readonly [string, string] {
	return description.startsWith(COMING_SOON_LEAD)
		? [COMING_SOON_LEAD, description.slice(COMING_SOON_LEAD.length)]
		: ["", description];
}
// #endregion
