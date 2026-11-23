/**
 * reviews.ts — the reviews buyers have left on seeded LISTINGS, each on the purchase that proves it.
 *
 * Seed content, authored. Under Decision #487 a review is written only on an ANCHOR the buyer
 * completed, so every service review here is emitted by `emit-reviews.ts` together with its anchor:
 * a completed engagement bought from the listing (a Pipeline, One-Off or Deliverable), or a completed
 * cohort membership with one completed sitting (a Session or Group session). The review targets the
 * listing's PROVIDER (the freelancer or the team) and carries the listing it came from, so the rating
 * trigger derives the provider's average and the listing's average from the same rows.
 *
 * Reviewer keys are `world.ts` persona keys. The generator REFUSES a review written by the listing's
 * owner or by a member of the owning team: a self-review is not a review, and a seed that carries one
 * teaches every screen to render a lie as though it were data.
 *
 * `comment` must clear the table's 100-character floor; a reply is 1–1,000 characters.
 */

/** The provider's one public reply, `daysAgo` before the reset. */
export interface ListingReply {
	body: string;
	daysAgo: number;
}

/** `[reviewer persona key, rating 1–5, title, comment, days ago, the provider's reply?]`. */
export type ListingReview = [string, number, string, string, number, ListingReply?];

/** Every service listing's reviews, keyed by corpus key. */
export const LISTING_REVIEWS: Record<string, ListingReview[]> = {
	// #region Services
	"sv-brand-identity-sprint": [
		[
			"theo",
			5,
			"The identity our whole launch now hangs off",
			"Atelier Nova ran discovery properly — they interviewed our roasters before drawing a single mark. The final kit covered every packaging size we sell and the Webflow handoff took our developer an afternoon.",
			21,
		],
		[
			"noor",
			4.8,
			"Structured, calm and genuinely strategic",
			"Every stage ended with something I could put in front of my board. The concept routes were distinct rather than three variations of one idea, which made choosing easy. One extra revision round was needed on the wordmark.",
			48,
		],
		[
			"priya",
			5,
			"A brand system, not just a logo",
			"We came for a refresh and left with a system our product team can actually extend: tokens for colour and type, clear rules for illustration, and a guidelines document people genuinely read.",
			73,
		],
	],
	"sv-design-system-foundation": [
		[
			"priya",
			5,
			"Our engineers adopted it the same week",
			"Maris set up a token architecture that maps cleanly onto our codebase, and the theming contract made dark mode a configuration change. The accessibility checklist caught issues we had shipped for a year.",
			14,
		],
		[
			"daniel",
			4.9,
			"The foundation we should have started with",
			"Clear stage reviews, a component library that matches production, and an adoption guide our engineers actually followed. Pricing per ticket let us scale the second stage up without renegotiating anything.",
			39,
		],
		[
			"hannah",
			4.7,
			"Excellent on tokens, thorough on docs",
			"The token work is excellent and the documentation is the best we have received from a contractor. The component review stage ran a few days long, but the delay was communicated early and handled well.",
			66,
			{
				body:
					"Thank you for the patience on the component review stage. Two components needed a second accessibility pass, and I would rather ship a few days late than ship them wrong.",
				daysAgo: 64,
			},
		],
	],
	"sv-landing-page-in-a-week": [
		[
			"theo",
			5,
			"Live in five days, exactly as promised",
			"Juno shipped a fast, accessible landing page in the week we were promised, with the forms and analytics wired correctly first time. The Figma file is tidy enough that I can edit sections myself now.",
			9,
		],
		[
			"miguel",
			4.6,
			"Fast turnaround and a clean build",
			"The build scored well on performance from day one and the copy pass tightened our messaging considerably. We needed one small layout fix after launch, which was turned around within a day of asking.",
			44,
			{
				body:
					"Thank you, Miguel. The layout fix was on us: a breakpoint we missed on the pricing table. It is now in the checklist every landing page goes through before it ships.",
				daysAgo: 43,
			},
		],
	],
	"sv-realtime-mvp-build": [
		[
			"daniel",
			4.8,
			"Reliable, communicative, and the load test held",
			"North Loop delivered the ingestion stage a week early and the replay design has already saved us once in production. The row-level security policies were reviewed with us line by line before shipping.",
			18,
		],
		[
			"miguel",
			4.9,
			"A realtime backend we trust in production",
			"Every stage came with a written handoff and a working demo. The typed client removed a whole class of bugs from our frontend, and the deployment runbook meant our on-call rotation was ready on day one.",
			52,
		],
	],
	"sv-product-launch-film": [
		[
			"noor",
			5,
			"The launch film carried our whole campaign",
			"Ren turned a rough brief into a film that felt expensive without being loud. The social cut-downs were ready alongside the master, and the sound design made the product feel physical on screen.",
			27,
		],
		[
			"priya",
			4.7,
			"Beautiful work, very clear process",
			"Storyboards and style frames were signed off before any rendering began, so there were no surprises at the end. We asked for one extra cut-down, which was quoted clearly and delivered within two days.",
			81,
		],
	],
	"sv-portfolio-review-session": [
		[
			"chloe",
			5,
			"An hour that changed how I present my work",
			"Saoirse walked through every case study, cut three I was attached to, and explained exactly why. The written action plan arrived the next morning and I have been working through it ever since.",
			12,
		],
		[
			"juno",
			4.8,
			"Direct, kind and genuinely useful",
			"I have had portfolio reviews before that were vague encouragement. This was specific: which projects to lead with, what to cut, and how to write the case studies so the decisions come across.",
			35,
		],
	],
	"sv-design-mentorship-block": [
		[
			"samuel",
			4.9,
			"Six sessions worth more than a course",
			"The growth plan from the first session shaped the whole block, and the async feedback between calls kept me moving. I left with a clear sense of the design decisions I am now trusted to make.",
			23,
		],
		[
			"chloe",
			4.8,
			"Thoughtful mentorship with real structure",
			"Each session built on the last and the notes afterwards meant nothing was lost. The feedback on my UX writing portfolio was specific enough to act on the same day, which is rare in mentoring.",
			58,
		],
	],
	"sv-packaging-art-direction": [
		[
			"theo",
			5,
			"Packaging that finally matches the coffee",
			"Ren's three routes were genuinely different directions, and the final artwork came with print-ready dielines our supplier accepted without a single query. The whole SKU family now feels like one brand.",
			30,
		],
		[
			"noor",
			4.7,
			"Strong art direction and a tidy handoff",
			"The concept presentation was clear about trade-offs between cost and finish, which helped us decide quickly. The supplier handoff pack saved our production manager days of back and forth.",
			67,
		],
	],
	"sv-design-systems-workshop": [
		[
			"lena",
			4.9,
			"The clearest two hours on tokens I have seen",
			"Maris moved from principles to a working token set in two hours without losing anyone. The exercise files were practical and the recording meant our absent teammates could catch up the next day.",
			16,
		],
		[
			"tomasz",
			4.6,
			"Useful for engineers, not just designers",
			"As a backend engineer I expected to sit this out, but the session on theming contracts changed how I think about our API for preferences. The follow-up thread answered everything we raised afterwards.",
			41,
		],
		[
			"hannah",
			4.8,
			"Well run and immediately applicable",
			"Our product team used the workshop as a kickoff for our own system and the shared vocabulary helped immediately. Sixteen seats felt about right — there was still time for everyone's questions.",
			75,
		],
	],
	// #endregion
};

/**
 * The product reviews, held out of the seed until CK1 records a delivery (Decision #487 ruling 5:
 * a product review needs an entitlement delivered at least once). CK1's seed anchors each on the
 * order line that bought it and emits it; until then nothing reads this table.
 */
export const PRODUCT_REVIEWS_AWAITING_DELIVERY: Record<string, ListingReview[]> = {
	// #region Products (held until CK1)
	"pr-aurora-ui-kit": [
		[
			"juno",
			4.9,
			"The Figma kit I reach for first",
			"Aurora is organised the way a real product is built — tokens first, then components, then patterns. Variants are consistent and the auto-layout never fights you when content changes length.",
			19,
		],
		[
			"kwame",
			4.7,
			"Saves days on every new dashboard",
			"We used Aurora to prototype an internal tool and the handoff to code was smooth because the naming matches what engineers expect. A few more data-table variants would make it perfect.",
			46,
		],
	],
	"pr-grain-lightroom-pack": [
		[
			"aiko",
			4.8,
			"Film looks that do not fall apart",
			"The grain in this pack is subtle enough to survive compression on social and the looks hold up across skin tones. I use three of the presets as a starting point on almost every shoot now.",
			25,
		],
		[
			"saoirse",
			4.6,
			"Tasteful presets for editorial work",
			"Most preset packs push colour too far; these stay restrained and editorial. The included notes on adjusting exposure before applying them made a real difference to my results.",
			63,
		],
	],
	"pr-motion-primitives": [
		[
			"ines",
			4.9,
			"Motion that respects reduced-motion settings",
			"The primitives are small, typed and honour reduced-motion preferences out of the box, which is rare. We replaced a heavier animation library with these and our bundle shrank noticeably.",
			22,
		],
		[
			"samuel",
			4.7,
			"Clean API and good defaults",
			"The easing defaults feel right without tuning and the API is predictable. The integration guide covered our framework directly, so the whole team was using it within an afternoon.",
			55,
		],
	],
	"pr-editorial-type-system": [
		[
			"chloe",
			5,
			"Typography that makes long reads pleasant",
			"The type scale is carefully tuned for long-form reading and the pairing guidance saved me from my usual mistakes. It made our newsletter feel like a publication instead of an email.",
			28,
		],
		[
			"maris",
			4.8,
			"A thoughtful editorial foundation",
			"Measure, rhythm and heading hierarchy are all considered together rather than as separate tokens. I adapted it for a documentation site and it needed almost no adjustment.",
			70,
		],
	],
	"pr-dashboard-blocks": [
		[
			"daniel",
			4.8,
			"Dashboard layouts that ship quickly",
			"The blocks cover the layouts we actually need — KPI rows, dense tables and filter bars — and they are built on sensible tokens. Our analytics screens came together in a fraction of the usual time.",
			17,
		],
		[
			"lena",
			4.5,
			"Solid blocks, well documented",
			"Good coverage of common dashboard patterns and clear documentation. I would like a few more empty-state variants, but the ones included are accessible and easy to extend.",
			60,
		],
	],
	"pr-iconography-set": [
		[
			"aiko",
			4.9,
			"Consistent icons at every size",
			"The stroke weights stay consistent from 16 to 48 pixels, which is where most icon sets fall apart. The naming is predictable enough that the team finds the right icon without asking.",
			31,
		],
		[
			"juno",
			4.7,
			"A large set that still feels designed",
			"Six hundred icons and they still read as one family. The SVGs are clean, with no stray groups or transforms, so they drop straight into our component library.",
			54,
		],
	],
	"pr-3d-product-scenes": [
		[
			"noor",
			4.8,
			"Studio-quality renders without a studio",
			"The scenes are lit beautifully and swapping in our own product meshes took minutes. We used them for a launch campaign and nobody could tell they were built from a kit.",
			26,
		],
		[
			"ines",
			4.6,
			"Well organised scenes with good lighting",
			"Materials and cameras are named clearly and the lighting rigs are easy to adjust. Render times were reasonable on a mid-range machine with the settings included in the guide.",
			68,
		],
	],
	"pr-notion-ops-suite": [
		[
			"hannah",
			4.8,
			"Our team's operating system in an afternoon",
			"The suite gave us project, meeting and decision logs that link together properly. Setup took an afternoon and the templates are opinionated in ways that genuinely improved how we run the team.",
			20,
		],
		[
			"miguel",
			4.6,
			"Practical templates for real ops work",
			"The decision log alone was worth it. The databases are structured well and the guide explains how to adapt each template instead of assuming one way of working suits everyone.",
			57,
		],
	],
	// #endregion
};

/**
 * Completed engagements bought from a listing that nobody has reviewed yet: the live path's starting
 * point (sign in as the client, review it from its Overview, then as the seller reply on `/view`).
 */
export const UNREVIEWED_ENGAGEMENTS: Array<
	{ listing: string; client: string; completedDaysAgo: number }
> = [
	{ listing: "sv-landing-page-in-a-week", client: "noor", completedDaysAgo: 2 },
];

// #region Providers review their clients (Decision #486)
/**
 * What a provider says of a client it worked for, `[rating, title, comment]`. Every seeded engagement
 * review is answered by its provider with one of these, a client never seeing the same one twice, so
 * the double-blind pair is revealed (the later of the two submits) and the client track has a corpus.
 */
export type ClientReview = [number, string, string];

export const PROVIDER_REVIEWS_OF_CLIENTS: ClientReview[] = [
	[
		5,
		"A brief we could build from on day one",
		"The scope arrived with references, constraints and a named decision-maker, and every stage was signed off inside two working days. Payment released the moment the work was accepted.",
	],
	[
		4.8,
		"Decisive, generous with context",
		"Feedback came as one consolidated round per stage rather than a drip of messages, and when something was out of scope they said so early and funded the extra stage without fuss.",
	],
	[
		5,
		"The kind of client you hope for",
		"They knew what they wanted and why, trusted us with the how, and turned around approvals quickly. Calls started on time and ended with a written summary of what had been agreed.",
	],
	[
		4.6,
		"Clear goals, a few late changes",
		"The goals never moved, though two requests landed after a stage was locked. They accepted that those belonged in a revision round and paid for it. Otherwise a smooth, respectful engagement.",
	],
	[
		4.9,
		"Organised and quick to approve",
		"Assets, logins and brand files were ready before kickoff, which saved us a week. Approvals were fast and specific, and every submission got a real answer rather than a thumbs-up.",
	],
	[
		4.7,
		"Fair, responsive, good to work for",
		"They answered questions within the day and kept the review circle small. One stage needed an extra round of internal sign-off on their side, which they flagged before it slipped.",
	],
];
// #endregion

// #region A warned client (Decision #486 (C))
/**
 * Atlas Labs' past engagements, each completed long enough ago that its window has closed and its
 * provider's review is public. Five low ratings put its Client Trust Score under 3.00, so its open
 * brief (`loop-mobile`) is demoted in Explore and a freelancer applying to it meets the warning first.
 * `[provider persona, brief title, completed days ago, rating, title, comment]`.
 */
export const WARNED_CLIENT = {
	business: "atlas",
	owner: "daniel",
	engagements: [
		[
			"maris",
			"Atlas analytics — dashboard redesign",
			46,
			1.5,
			"Scope grew every week",
			"Three new screens appeared after the stage was locked, each described as a small tweak. When we raised a revision round the reply was that it should already have been included. Payment came late.",
		],
		[
			"juno",
			"Atlas marketing site — frontend build",
			58,
			2,
			"Hard to get a decision",
			"Approvals sat for days with no reply, then arrived as a list of changes from people who had not been on the kickoff call. The build shipped, but nearly a month later than planned through no fault of the plan.",
		],
		[
			"ren",
			"Atlas product teaser — motion pass",
			73,
			1,
			"Signed-off work reopened at the end",
			"The storyboard and the animatic were both signed off in writing, then the final cut was called off-brief and the earlier approvals were set aside. Acceptance took three more weeks of back and forth.",
		],
		[
			"lena",
			"Atlas onboarding — illustration set",
			96,
			1.5,
			"Feedback without a brief",
			"There was no written brief, only a call, and each round of feedback contradicted the one before it. We delivered a full set twice. Communication was polite, but nothing was decided until the last week.",
		],
		[
			"tomasz",
			"Atlas data pipeline — ingestion service",
			121,
			2,
			"Unclear ownership on their side",
			"Three different people asked for different priorities and nobody could settle them. The work was accepted in the end, but only after we escalated twice and wrote the acceptance criteria ourselves.",
		],
	] as Array<[string, string, number, number, string, string]>,
};
// #endregion
