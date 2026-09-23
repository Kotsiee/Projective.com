/**
 * reviews.ts — the reviews buyers have left on seeded LISTINGS (services and digital products).
 *
 * Seed content, authored. Each row becomes a `reviews.entity_reviews` row targeting the listing's
 * subject — a `service_blueprint` or a `product` — and the rating trigger derives every average and
 * count the cards and listing pages print from these rows, so no rating anywhere is typed by hand.
 *
 * Reviewer keys are `world.ts` persona keys. The generator REFUSES a review written by the listing's
 * owner or by a member of the owning team: a self-review is not a review, and a seed that carries one
 * teaches every screen to render a lie as though it were data.
 *
 * `comment` must clear the table's 100-character floor (`entity_reviews_comment_check`).
 */

/** `[reviewer persona key, rating 1–5, title, comment, days ago]`. */
export type ListingReview = [string, number, string, string, number];

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

	// #region Products
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
