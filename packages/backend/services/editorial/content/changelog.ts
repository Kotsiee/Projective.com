import {
	type ChangelogImage,
	type ChangelogRelease,
	type ChangelogReleaseRow,
	ChangelogReleaseRowSchema,
} from "@projective/types/editorial";
import {
	defineEditorialSurface,
	defineEditorialTable,
	editorialContent,
} from "../editorial-source.ts";

/**
 * The changelog's content source (P5, Decisions #274 / #278) — every release, authored as domain
 * records and emitted into `00005072_seed_editorial_changelog.sql` by
 * `deno task db:editorial:generate`. Edit a record here and re-run the task; never edit the SQL.
 *
 * ## Where the releases come from
 *
 * Every release is reconstructed from the real build history — the first-parent history of `main`
 * and the decision log (`documentation/reference/decisions/`) — and describes only what landed. The
 * comment above each record names the decisions it draws on. Work that shipped on sample data says
 * so; the release that moved it onto the database says that too.
 *
 * ## How the versions were derived
 *
 * Projective has not launched, so every release is `0.x`. Each MINOR version is one milestone of the
 * build: a run of related work that landed on `main` within days, closed by its last decision. The
 * release date is the day that last piece landed (the decision's date, which matches its commit). No
 * patch release was ever cut, so every patch number is `0`. Two milestones that closed on the same
 * day keep their order by version.
 *
 * ## Pictures
 *
 * Product captures are placeholders (`placehold.co`) at 1600 × 1000, the 16:10 ratio of the gallery
 * tiles, until real screenshots replace them; each `alt` and caption already describes the capture
 * the placeholder stands for.
 *
 * ## Retracting
 *
 * Nothing is deleted: the generated seed upserts and never prunes. A release is retracted by setting
 * `withdrawn: true`, which the table's `visible` predicate and its SELECT policy both read.
 */

// #region Table
/** The UTC calendar day of `now`, `YYYY-MM-DD` — the day the SELECT policy compares against. */
export function changelogDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/**
 * `editorial.changelog_releases`, keyed by version. A release is shown once its day has come (UTC)
 * and while it is not withdrawn — the same rule as the table's SELECT policy
 * (`00002021`, `[editorial.changelog]`).
 */
export const CHANGELOG_RELEASES = defineEditorialTable<ChangelogReleaseRow, ChangelogRelease>({
	table: "editorial.changelog_releases",
	key: ["version"],
	row: ChangelogReleaseRowSchema,
	casts: { released_on: "date", categories: "text[]" },
	toRow: (release) => ({
		version: release.version,
		released_on: release.releasedOn,
		title: release.title,
		summary: release.summary,
		categories: [...release.categories],
		body: release.body,
		images: release.images,
		withdrawn: release.withdrawn,
	}),
	fromRow: (row) => ({
		version: row.version,
		releasedOn: row.released_on.slice(0, 10),
		title: row.title,
		summary: row.summary,
		categories: [...row.categories],
		body: row.body,
		images: row.images,
		withdrawn: row.withdrawn,
	}),
	visible: (release, now) => !release.withdrawn && release.releasedOn <= changelogDay(now),
});
// #endregion

// #region Authoring helpers
/** A release as authored here: `images` and `withdrawn` may be left out. */
type AuthoredRelease =
	& Omit<ChangelogRelease, "images" | "withdrawn">
	& Partial<Pick<ChangelogRelease, "images" | "withdrawn">>;

/** A release record with the optional fields filled in. */
function release(authored: AuthoredRelease): ChangelogRelease {
	return { images: [], withdrawn: false, ...authored };
}

/**
 * A product capture's placeholder: a 1600 × 1000 `placehold.co` image labelled with the capture it
 * stands for. `alt` and `caption` describe the real screenshot, so they stay right when it lands.
 */
function capture(label: string, alt: string, caption: string): ChangelogImage {
	const text = encodeURIComponent(label).replace(/%20/g, "+");
	return {
		src: `https://placehold.co/1600x1000?text=${text}`,
		alt,
		w: 1600,
		h: 1000,
		caption,
	};
}
// #endregion

// #region Releases (oldest first)
const RELEASES: readonly ChangelogRelease[] = [
	// Decisions #1–#18 (2026-07-12 → 07-15); commits a1e92da1 "init" … 64194de9 "Explore".
	release({
		version: "0.1.0",
		releasedOn: "2026-07-15",
		title: "Foundations: the shell, sign-up and Explore",
		summary:
			"The first milestone: one design system, sign-up and onboarding, a navigation shell for guests and signed-in accounts, and Explore for finding people, services and projects.",
		categories: ["ux", "discovery", "infrastructure"],
		body: [
			{
				type: "p",
				content: "The first milestone put in place the frame every later screen is built in.",
			},
			{
				type: "list",
				items: [
					"A shared component library on one set of design tokens for colour, type, spacing and motion, in light and dark themes.",
					{
						content: [
							"Sign-up at ",
							{ type: "code", text: "/join" },
							" and sign-in, with onboarding paths for clients and freelancers.",
						],
					},
					"A navigation shell that adapts to who is looking: a floating header for guests, a sidebar and top bar once you are signed in.",
					"Explore, the search and browse surface for freelancers, services and projects.",
					"A public footer with plain-language links and a newsletter sign-up.",
				],
			},
			{ type: "h3", text: "Under the hood" },
			{
				type: "p",
				content:
					"Every feature follows one pattern from the first day: a thin route checks the request and a service on the server holds the logic, so a page never talks to the database directly.",
			},
		],
		images: [
			capture(
				"Explore",
				"Explore: a search bar above rows of freelancer, service and project results",
				"Explore, the first surface built on the shell.",
			),
		],
	}),

	// Decisions #19–#31 (2026-07-16 → 07-17): the project sidebar, channel chrome, the middle-nav
	// header band and the native-scroll model.
	release({
		version: "0.2.0",
		releasedOn: "2026-07-17",
		title: "The project workspace",
		summary:
			"Projects get a place to work: a sidebar of channels with quick filters, channel chat with a pinned composer, and a layout that keeps the lane and the conversation in view.",
		categories: ["projects", "messaging", "ux"],
		body: [
			{
				type: "p",
				content: "A project now opens into its own workspace instead of a single page.",
			},
			{
				type: "list",
				items: [
					"The project sidebar lists the engagement's channels, with quick filters and an icon rail when it is collapsed.",
					"Each channel has a chat view whose header joins the sidebar, with the composer pinned to the bottom.",
					"The middle navigation lane gained a header band, so a page's title and tools sit level with the lane.",
					"Pages scroll the whole window again, so scrolling, find-in-page and the browser's own controls behave as you expect.",
				],
			},
		],
		images: [
			capture(
				"Project channels",
				"A project's channel sidebar beside an open channel conversation",
				"A channel's chat beside the project sidebar.",
			),
		],
	}),

	// Decisions #32–#38 (2026-07-20 → 07-21); commits 310b607f "Files & Submissions", 5405d3d4
	// "Kanban", a2fbb0a7 "Calendar".
	release({
		version: "0.3.0",
		releasedOn: "2026-07-21",
		title: "Files, submissions, the board and the calendar",
		summary:
			"The everyday project tools arrive together: a file explorer, a submissions explorer, a Kanban board with drag and drop and a project calendar, along with the first public profile page.",
		categories: ["projects", "discovery", "ux"],
		body: [
			{ type: "p", content: "The tools a team works in every day landed in one week." },
			{
				type: "list",
				items: [
					"Files: a file explorer for each channel and for the whole project.",
					"Submissions: every deliverable handed in, organised by stage, in its own explorer.",
					"Board: a Kanban board with drag-and-drop columns, built on reusable drag-and-drop pieces.",
					"Calendar: a schedule of project dates on a calendar engine the whole product shares.",
					{
						content: [
							"Profiles: a public page for every member at ",
							{ type: "code", text: "/@handle" },
							".",
						],
					},
					"Guests browse inside one floating shell with a glass header.",
				],
			},
		],
		images: [
			capture(
				"Kanban board",
				"The project board: ticket cards in columns from Backlog to Complete",
				"The board, with tickets dragged between columns.",
			),
			capture(
				"Submissions",
				"The submissions explorer: deliverables grouped under each stage",
				"Deliverables, organised by stage.",
			),
		],
	}),

	// Decisions #39–#53 (2026-07-22 → 07-23): entity view pages, service delivery models, search
	// filters, session refresh, the messaging module and the catalogue.
	release({
		version: "0.4.0",
		releasedOn: "2026-07-23",
		title: "View pages, messaging and the catalogue",
		summary:
			"Every listing gets a page of its own, messaging arrives as a floating chat and an inbox, and sellers get a catalogue to manage their services and products.",
		categories: ["discovery", "messaging", "projects"],
		body: [
			{ type: "p", content: "Explore results now lead somewhere." },
			{
				type: "list",
				items: [
					"View pages show a service, a product or a project in full, with everything you need to decide.",
					"A service describes one of five delivery models, with its stages laid out the way a project shows its own.",
					"Search filters moved into the side lane, and results got a denser layout with clear prices.",
					"Messaging: a floating chat window that stays open as you move between pages, an inbox, and a quick message from any profile.",
					"The catalogue: a seller's console for their services and products.",
					"Sessions renew quietly in the background, and a session that has expired remembers where you were going.",
				],
			},
		],
		images: [
			capture(
				"View page",
				"A service's view page: its description and stages beside the lane that holds the price and the purchase",
				"A view page, with the purchase in its lane.",
			),
		],
	}),

	// Decisions #54–#63 (2026-07-23 → 07-31): the wallet & finance foundation, availability,
	// notifications, subscriptions and Standing, integrations, Teams & Businesses, icons, fields.
	release({
		version: "0.5.0",
		releasedOn: "2026-07-31",
		title: "Groundwork for money, schedules and teams",
		summary:
			"The data model for wallets and escrow, availability and discovery calls, notifications, subscriptions and integrations, plus the first wallet screens and the Teams & Businesses console.",
		categories: ["escrow", "workspaces", "infrastructure", "ux"],
		body: [
			{
				type: "p",
				content:
					"This release laid down the data model the platform's money and scheduling rules run on. Its screens ran on sample data; later releases connected them to the database and to real payments.",
			},
			{
				type: "list",
				items: [
					"Wallets, escrow and the transaction ledger are modelled in the database, and the wallet screens show balances, money held in escrow and history.",
					"Availability and discovery calls: working hours, time zones and a short call before hiring.",
					"The notification engine's data model, ready to deliver in the app and by email.",
					"Subscriptions, entitlements and Standing, the ladder that rewards a strong delivery record.",
					"A schema for connecting outside tools to a workspace.",
					"Teams & Businesses: one console for entities with several members.",
				],
			},
			{ type: "h3", text: "Design system" },
			{
				type: "list",
				items: [
					"One icon set, with one stroke weight and one size ramp across the product.",
					"Every form field shares one set of states — rest, focus, invalid, disabled — and one geometry.",
				],
			},
		],
		images: [
			capture(
				"Wallet",
				"The first wallet screen: balances, money in escrow and recent history",
				"The first wallet screen, on sample data.",
			),
		],
	}),

	// Decisions #64–#70 (2026-08-01 → 08-10): tickets, the modal stack, audio capture, the asset hub
	// and picker, the universal basket and checkout, multi-currency.
	release({
		version: "0.6.0",
		releasedOn: "2026-08-10",
		title: "Tickets, files, the basket and checkout",
		summary:
			"Tickets are rebuilt around one modal, files get a library and a picker that works everywhere, and buying gains a basket, a four-step checkout and prices in your own currency.",
		categories: ["projects", "escrow", "ux"],
		body: [
			{
				type: "list",
				items: [
					"Tickets: a new composer and one modal to create, view and edit a ticket, its price worked out from its parts.",
					"A modal that opens another now hands over to it, and going back restores where you were.",
					"Voice notes: record audio in the browser, with pause and resume.",
					"Files: a personal and team library, one picker wherever you attach something, privacy settings and storage quotas.",
					"A basket for everything you buy, and a four-step checkout — basket, details, payment, confirmation — with nothing else on screen while you pay.",
					"Every price shows in the currency you choose from the header. Conversion is for display only: what you are charged never changes.",
				],
			},
		],
		images: [
			capture(
				"Checkout",
				"The checkout's payment step: the order summary beside the card form, with the rest of the app hidden",
				"Checkout, step three of four.",
			),
			capture(
				"Asset picker",
				"The asset picker: a library of files with a selection tray",
				"One picker wherever you attach a file.",
			),
		],
	}),

	// Decisions #71–#81 (→ 2026-08-27): the calendar system and its physics, the Explore home,
	// the design laws, the entity view refactor, service booking and the unified scrollbar.
	release({
		version: "0.7.0",
		releasedOn: "2026-08-27",
		title: "Calendar, Explore and view pages, rebuilt",
		summary:
			"A second pass on three busy surfaces: a calendar with real zoom and fairer rescheduling, an Explore home built from rails, and view pages that put the content first and the purchase in one lane.",
		categories: ["discovery", "projects", "ux"],
		body: [
			{
				type: "list",
				items: [
					"Calendar: zoom that stays under your cursor, overlapping events laid out side by side, an event dialog, and rescheduling decided by a majority of the people invited.",
					"Explore home: a first screen that shows what matters, then rails of listings in one style, each card carrying its price and its verification at a glance.",
					"View pages: the content leads, the media follows, and the purchase lives in one lane, with a header that stays with you as you scroll.",
					"Booking: each service offers the action that fits how it is delivered, a contact menu and a slot picker.",
					"One scrollbar across the site, always visible and easy to grab.",
				],
			},
			{ type: "h3", text: "Design principles" },
			{
				type: "p",
				content:
					"We wrote down the rules the interface follows: information that cannot be clicked is never boxed or turned into a pill, and a listing's purchase sits in one place only.",
			},
		],
		images: [
			capture(
				"Calendar",
				"The calendar's week view, zoomed in on one day with events side by side",
				"Overlapping events, side by side.",
			),
		],
	}),

	// Decisions #82–#95 (2026-08-30 → 09-08): the read API goes live, the projects write layer,
	// project creation on Postgres, prefixed slugs, Timeline / Gantt, button feedback, ticket links.
	release({
		version: "0.8.0",
		releasedOn: "2026-09-08",
		title: "Projects run on the database",
		summary:
			"Projects and messages now read from and write to the database, creating a project becomes a guided flow, and every project, stage and ticket gets a permanent address.",
		categories: ["projects", "infrastructure", "ux"],
		body: [
			{
				type: "p",
				content:
					"Until this release the project screens ran on sample data. Now they read and write the database, behind row-level security, so each person sees only what they are part of.",
			},
			{
				type: "list",
				items: [
					"Projects and messages are read through cached server routes that check for changes before sending a page again.",
					"Creating a project is a quick start followed by a workspace setup, saved as you go.",
					"An account that signed up but never finished onboarding is sent to finish it before it can reach the app.",
					"Timeline: a Gantt view of a project's stages and dated tickets, also on the calendar and in the ticket view.",
					"Buttons respond when pressed, and the brand colour's text contrast was fixed at its source.",
					"On the board the whole card is the handle, and who can see or move a ticket follows how it is funded.",
				],
			},
			{ type: "h3", text: "Addresses that last" },
			{
				type: "p",
				content:
					"Projects, stages and tickets have short, permanent addresses that never expose an internal id, and any ticket can be linked to directly:",
			},
			{
				type: "code",
				lang: "text",
				text:
					"/projects/prj-…            a project\n/projects/prj-…/stg-…      one of its stages\n?tkv=tkt-…                 open a ticket from any page",
			},
			{
				type: "p",
				content: "Pressing Back after opening a ticket no longer reloads the page.",
			},
		],
		images: [
			capture(
				"Timeline",
				"The project timeline: one lane per stage with its dated tickets and the links between them",
				"A project's stages and dated tickets on the timeline.",
			),
		],
	}),

	// Decisions #96–#121 (2026-09-09 → 09-23): the editorial profile, hiring and invitations,
	// messaging groups, sign-in, media, offline handling, the dev world, three project types.
	release({
		version: "0.9.0",
		releasedOn: "2026-09-23",
		title: "Profiles, hiring and invitations",
		summary:
			"Public profiles are rebuilt as one editorial column and go live, hiring starts from a profile with a proper invitation, and messaging gains groups and sharing.",
		categories: ["discovery", "projects", "messaging"],
		body: [
			{
				type: "list",
				items: [
					"Profiles: a split hero and four sections — Work, Experience, Reviews and Posts — with a showcase carousel and a headline the owner writes, now served from the database.",
					"Hire from a profile: invite a freelancer to a new or an existing project. A freelancer who declines cannot be invited to the same project again for 48 days.",
					"Invitations are tracked in the database from the moment they are sent until they are answered.",
					"Three kinds of project — Task, One-off and Pipeline — are created from one dialog.",
					"Messaging: group conversations, a people picker ranked by who you work with, and one dialog for sharing.",
					"Sign in with your email or your username; Enter moves to the next field before it submits.",
					"Products show in one masonry layout, and videos play in one shared player.",
					"Explore filters gained range controls and a field to refine a search.",
					"If you lose your connection, navigation and saving pause with a clear notice instead of failing silently.",
				],
			},
			{ type: "h3", text: "Under the hood" },
			{
				type: "p",
				content:
					"A connected development world of sample people, teams, projects and pictures makes every screen testable from end to end.",
			},
		],
		images: [
			capture(
				"Public profile",
				"A public profile: the split hero with the Hire action, above the Work section",
				"A profile's hero and its Work section.",
			),
			capture(
				"Hire invitation",
				"The hire dialog: choosing a project and writing an introduction for the freelancer",
				"Inviting a freelancer from their profile.",
			),
		],
	}),

	// Decisions #122–#130 (2026-09-29 → 10-01): the wallet command centre, Stripe phases 1 and 2,
	// the avatar rule, the hiring handshake and inbox folders, link previews, group photos.
	release({
		version: "0.10.0",
		releasedOn: "2026-10-01",
		title: "The wallet, card payments and payouts",
		summary:
			"The wallet becomes one command-centre page, and Stripe connects real money: card payments into the ledger, payout accounts, identity checks, withdrawals, saved cards and recurring deposits.",
		categories: ["escrow", "security", "messaging"],
		body: [
			{
				type: "p",
				content:
					"The wallet is one page now: a balance hero with every money action, over a sheet of accounts, cash flow, upcoming obligations and recent transactions.",
			},
			{ type: "h3", text: "Payments" },
			{
				type: "list",
				items: [
					"Pay by card; each payment reaches the ledger through a signed webhook.",
					"Freelancers connect a payout account and verify their identity with Stripe.",
					"Withdraw to your payout account, save cards and set up recurring deposits.",
					"A bank chargeback is recorded, and the escrow it funded is frozen until the chargeback closes.",
				],
			},
			{ type: "h3", text: "Hiring and messages" },
			{
				type: "list",
				items: [
					"Project requests and a hiring handshake, with inbox folders for Primary, Requests and Archived.",
					"Links in messages show safe previews, and an unchecked link leaves the site through a page that names where it goes.",
					"Group conversations can have a photo.",
					"One rule for every avatar: the photo you uploaded, then your sign-in picture, then a default.",
				],
			},
		],
		images: [
			capture(
				"Wallet",
				"The wallet command centre: the balance hero with its money actions above the dashboard sheet",
				"The wallet's balance hero.",
			),
		],
	}),

	// Decisions #131–#156 (2026-10-03 → 10-08): rich-text messaging and attachments, the project lane
	// and Overview, members and stage seats, the account menu, Become a Partner, the Settings engine
	// and hub, wallet analytics, the proposal allowance, setup progress.
	release({
		version: "0.11.0",
		releasedOn: "2026-10-08",
		title: "Messaging, the project Overview and Settings",
		summary:
			"Messages gain formatting, replies and attachments; every project opens on an Overview of what needs you; and Settings becomes one place you can search.",
		categories: ["messaging", "projects", "ux"],
		body: [
			{ type: "h3", text: "Messaging" },
			{
				type: "list",
				items: [
					"Bold, italic, strikethrough and underline; replies; reactions; and swipe to reply on a touch screen.",
					"Attachments reach everyone in the conversation, a message can run to 8,000 characters, and long ones fold to four lines.",
				],
			},
			{ type: "h3", text: "Projects" },
			{
				type: "list",
				items: [
					"A project opens on its Overview: what needs you, the brief, inclusions and terms, the project files and where each stage stands.",
					"The project lane leads with its main views, Discussion first, and marks what changed since you last looked.",
					"Members becomes an explorer of members, requests and invitations; stage seats are offered one at a time; stages can be staffed through invite links.",
					"Before you apply, a proposal shows how much of your weekly allowance it uses.",
				],
			},
			{ type: "h3", text: "Your account" },
			{
				type: "list",
				items: [
					"Settings: one search over every setting, a dialog that opens from anywhere, and a hub that shows what needs your attention.",
					"The account menu shows your profile progress and switches between you, your teams and your businesses.",
					"Become a Partner: a client can unlock the freelancer side of the same account.",
					"Profile setup shows one next step at a time, with verification marks you earn instead of points.",
					"The wallet adds a balance meter and analytics of where money went.",
				],
			},
		],
		images: [
			capture(
				"Project Overview",
				"A project's Overview: what needs you, the brief and the stage run, with people and messages beside them",
				"A project's Overview.",
			),
			capture(
				"Settings",
				"The Settings hub: a search field above what needs your attention and every section",
				"One search over every setting.",
			),
		],
	}),

	// Decisions #157–#173 (2026-10-09 → 10-11): the accent amber and button matrix, the picture
	// picker, the file inspector, the work-start gate, single-ticket purchase, paid revisions,
	// business invoices and auto-funding, the overlay family, the notification inbox.
	release({
		version: "0.12.0",
		releasedOn: "2026-10-11",
		title: "Funding before work, the file inspector and pictures",
		summary:
			"No work starts until it is funded, single tickets and paid revisions can be bought directly, any file opens in a full-window inspector, and pictures are chosen and cropped in one picker.",
		categories: ["escrow", "projects", "ux"],
		body: [
			{ type: "h3", text: "Funding before work" },
			{
				type: "p",
				content:
					"A ticket moves into work only once its payment is held in escrow. Until then it waits in Needs funding and tells the client exactly what to fund and how.",
			},
			{
				type: "list",
				items: [
					"Buy a single ticket directly.",
					"Revisions beyond the free rounds are priced from the listing and held like any other ticket payment.",
					"A business can fund work automatically from its wallet, is warned once when its balance runs low, and is invoiced monthly on the day it chooses.",
				],
			},
			{ type: "h3", text: "Files and pictures" },
			{
				type: "list",
				items: [
					"The file inspector opens any stored file in a full window: images, video, audio, PDFs, code, tables, 3D models, Word documents and fonts.",
					"File previews in a project use the same viewers.",
					"One picker for every picture: upload one, choose from your library or use your sign-in picture, then crop, zoom and rotate it.",
				],
			},
			{ type: "h3", text: "Interface" },
			{
				type: "list",
				items: [
					"One amber colour marks the moment you pay, and every button's weight follows what it commits you to.",
					"Dialogs and drawers behave as one family, with a footer that stays in view.",
					"Notifications: a drawer in the header and a full inbox.",
				],
			},
		],
		images: [
			capture(
				"File inspector",
				"The file inspector showing a PDF full-window, with the details panel beside it",
				"A PDF open in the file inspector.",
			),
			capture(
				"Needs funding",
				"A ticket waiting in Needs funding, with the amount and the fund action",
				"A ticket waits until its payment is held.",
			),
		],
	}),

	// Decisions #174–#181 and #227 (2026-10-12): hover intent, promo slots, ranking, embeddings
	// (off by default), saved & collections, the shared verification crest.
	release({
		version: "0.13.0",
		releasedOn: "2026-10-12",
		title: "Discovery: ranking, saving and verification",
		summary:
			"Explore learns to rank — one quality score behind every recommended order, with a boost for newcomers — and you can save anything into collections.",
		categories: ["discovery", "ux"],
		body: [
			{
				type: "list",
				items: [
					"Recommended results follow one quality score that weighs a seller's record, workload and Standing, with a boost so new freelancers are seen.",
					"Save listings, people, projects, messages and files, and keep them in collections.",
					"An Explore card reveals one more line of detail when you rest on it, and saving gives instant feedback.",
					"Promotions on the Explore home share one slot, clearly marked when sponsored.",
					"A seller's verification mark looks the same on their profile and on every Explore card.",
					"View pages suggest related listings in a rail.",
				],
			},
			{
				type: "callout",
				tone: "note",
				title: "Semantic search",
				body: [
					{
						type: "p",
						content:
							"Search by meaning, using AI embeddings, is built but switched off by default while we evaluate it.",
					},
				],
			},
		],
		images: [
			capture(
				"Saved",
				"The Saved page: saved listings and people in rows, filtered by a collection",
				"Saved listings and people, kept in collections.",
			),
		],
	}),

	// Decisions #183–#189, #191, #194–#200, #202, #209–#211, #213, #215 (2026-10-13): the money
	// integrity hardening — ledger, settlement, fees, pending window, prepaid stage funding.
	release({
		version: "0.14.0",
		releasedOn: "2026-10-13",
		title: "Money integrity",
		summary:
			"A hardening pass on every path money takes: an append-only ledger reconciled nightly, settlement that cannot run twice, a seven-day pending window on earnings, and stages funded up front.",
		categories: ["escrow", "security", "infrastructure"],
		body: [
			{
				type: "p",
				content:
					"This release went through every path money takes and made each one safe to retry, safe when two things happen at once, and checkable afterwards.",
			},
			{
				type: "list",
				items: [
					"The ledger is append-only: no entry can be edited or deleted, and it is reconciled every night.",
					"Releasing escrow is safe to run twice — a second attempt changes nothing — and a ticket holds at most one base escrow.",
					"Every platform fee reads the payer's own rate and rounds down.",
					"Earnings wait seven days in a pending balance before they can be withdrawn.",
					"Approving work settles the board and the money together, and an approval never releases money nobody can receive.",
					"A card payment always lands in the ledger. If what it paid for falls through, the money waits in your wallet and you are told why.",
					"A reversed transfer returns its money to your wallet, and you are told when a bank payout is paid or fails.",
				],
			},
			{ type: "h3", text: "Funding work" },
			{
				type: "list",
				items: [
					"Fund a whole stage up front, by card or from your wallet.",
					"Pipelines chain: approving one stage funds the next at once from your balance.",
					"Fair Exit: end a stage early, with a preview of who is paid what.",
					"Pay for a revision straight from the review.",
					"A freelancer verifies their identity and payout account before taking on paid work.",
					"A one-to-one session holds one escrow for each sitting.",
				],
			},
		],
		images: [
			capture(
				"Fund a stage",
				"The Fund a stage dialog: the stage's tickets and total, paid from the wallet or by card",
				"Funding a whole stage up front.",
			),
		],
	}),

	// Decisions #185, #190, #192, #193, #201, #203–#208, #212, #214, #216 (2026-10-13): age rules,
	// sessions, disputes and the operator desk, the scheduler, preferences, claiming tickets.
	release({
		version: "0.15.0",
		releasedOn: "2026-10-13",
		title: "Safety: age rules, sessions, disputes and the scheduler",
		summary:
			"Age rules enforced by the database, safer sign-in sessions, a dispute process with an operator desk, and scheduled jobs that run in every environment.",
		categories: ["security", "escrow", "infrastructure"],
		body: [
			{ type: "h3", text: "Age" },
			{
				type: "p",
				content:
					"No one under 13 can create an account. Accounts for 13 to 17 year-olds can explore and build a profile but cannot buy or sell, and the app hides what they cannot use.",
			},
			{ type: "h3", text: "Sessions and sign-in" },
			{
				type: "list",
				items: [
					"Sign-in cookies are always Secure over HTTPS, and Keep me signed in decides whether you stay signed in for 30 days.",
					"Every request checks your session token's signature and expiry instead of trusting that it is there.",
					"Switching between yourself, a team and a business re-issues your session on the server.",
					"The email verification check no longer reveals whether an address has an account.",
				],
			},
			{ type: "h3", text: "Disputes" },
			{
				type: "p",
				content:
					"A dispute moves from open, to awaiting a response, to under review, and ends in a release, a refund or a split decided by an operator from the dispute desk. It is never deleted.",
			},
			{ type: "h3", text: "Under the hood" },
			{
				type: "list",
				items: [
					"Scheduled jobs, such as recurring deposits and account erasures, run from one registry in every environment.",
					"Email and push preferences have one source.",
					"Sign-up sets your language and display currency from your browser.",
					"Freelancers claim open tickets straight from the board.",
				],
			},
		],
		images: [
			capture(
				"Dispute desk",
				"The operator dispute desk: the queue by status, oldest due first, with an open case",
				"Where an operator decides a dispute.",
			),
		],
	}),

	// Decisions #217–#224 (2026-10-14 → 10-15): the catalogue rebuild, listing analytics, the buyer
	// simulation, catalogue chrome and filtering, one menu per entity, zoom, DataTable.
	release({
		version: "0.16.0",
		releasedOn: "2026-10-15",
		title: "The catalogue, rebuilt",
		summary:
			"Sellers get a rebuilt catalogue: a console with filters and analytics, a workspace for each listing with a live preview, scheduling presets, and a simulation of exactly what a buyer sees.",
		categories: ["discovery", "projects", "ux"],
		body: [
			{
				type: "list",
				items: [
					"A console of your listings, filtered by status, delivery model and category, with Analytics and Clients views.",
					"Each listing has a workspace — Edit, Preview, Analytics and Clients — with a six-slot showcase and a publish checklist.",
					"Scheduling presets with availability that repeats.",
					"Listing analytics: views, the keywords people searched and a heatmap in your own time zone.",
					"Buyer simulation: see your listing exactly as a buyer does, where nothing is booked or charged.",
				],
			},
			{ type: "h3", text: "Everywhere" },
			{
				type: "list",
				items: [
					{
						content: [
							"Right-click, the menu key or ",
							{ type: "kbd", text: "Shift+F10" },
							" on a card opens the same menu as its More button.",
						],
					},
					{
						content: [
							"Zoom a grid of cards with ",
							{ type: "kbd", text: "Ctrl" },
							" or ",
							{ type: "kbd", text: "Cmd" },
							" and the scroll wheel.",
						],
					},
					"One data table for every list of rows, with sorting, filters, resizable columns and selection.",
				],
			},
		],
		images: [
			capture(
				"Catalogue console",
				"The catalogue console: listings as cards with the status and category filters in the lane",
				"The rebuilt catalogue console.",
			),
			capture(
				"Buyer simulation",
				"A listing in buyer simulation, framed by the workspace's Preview tab",
				"A listing as a buyer sees it; nothing is booked or charged.",
			),
		],
	}),

	// Decisions #225 and #228–#240 (2026-10-16 → 10-17): verification & payouts, Teams rulings and
	// the console read, writable splits, Enterprise, the business console, the spend gate, approvals,
	// capabilities, active-only businesses, the co-owner grant.
	release({
		version: "0.17.0",
		releasedOn: "2026-10-17",
		title: "Teams and Businesses",
		summary:
			"Teams and Businesses become real working entities: freelancer teams with editable payout splits, business spending with approvals that are used exactly once, and Enterprise as the new name for organisations.",
		categories: ["workspaces", "escrow", "security"],
		body: [
			{ type: "h3", text: "Teams" },
			{
				type: "list",
				items: [
					"Teams are for freelancers, with a console of Overview, Members, Projects, Payouts, Roles and Settings.",
					"Payout splits can be edited: the Co-op template is free, and the other templates come with Pro Team.",
					"A team applies for work only once it is active and has at least two members.",
					"A team's workload is counted live, so search ranks teams by how busy they really are.",
				],
			},
			{ type: "h3", text: "Businesses" },
			{
				type: "list",
				items: [
					"Any adult account can create a business, with a console of Overview, Members, Projects, Spend, Billing and Settings.",
					"Every payment from a business wallet passes one check: the business's verification, the member's own limit and the approval threshold.",
					"An approval is tied to what it approves and is used exactly once.",
					"Each act on a business project needs its own permission: hiring, purchasing, managing projects and funding.",
					"Only an active business can buy, hire or pay, and archiving one lists everything still in the way.",
					"The owner can name a co-owner to withdraw, manage billing and archive.",
				],
			},
			{ type: "h3", text: "Also" },
			{
				type: "list",
				items: [
					"Organisations are called Enterprises everywhere.",
					"Verification & payouts in Settings shows one next step at a time.",
				],
			},
		],
		images: [
			capture(
				"Team console",
				"A team console's Overview, with the Payouts split beside the members",
				"A team's console, with its payout split.",
			),
			capture(
				"Business spend",
				"A business's Spend view: member limits, the approval threshold and the queue of requests",
				"Spend controls on a business.",
			),
		],
	}),
];
// #endregion

/** The changelog's records, oldest first (the service sorts; the generator keeps this order). */
export const CHANGELOG_RECORDS: readonly ChangelogRelease[] = RELEASES;

/** The release table paired with its records — what the changelog service reads. */
export const CHANGELOG_RELEASE_CONTENT = editorialContent(CHANGELOG_RELEASES, CHANGELOG_RECORDS);

/** The changelog surface: its one table and every release. */
export const CHANGELOG_CONTENT = defineEditorialSurface("changelog", [CHANGELOG_RELEASE_CONTENT]);
