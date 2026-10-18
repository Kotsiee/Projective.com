/**
 * Privacy Policy — every version, newest first (Decision #270).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). The data categories are the ones the schema
 * actually stores (`org.users_public`, `org.user_emails`, `org.user_preferences`, `comms.*` messages,
 * `finance.*` wallets and escrows, `files.items`, `projects.*`, `reviews.*`, `ops.log_entries`); the
 * processors are the services the server talks to (`.env.example`, SYSTEM_ARCHITECTURE.md
 * "Environment Variable Contract"); retention follows PRODUCT_SPEC.md §Data Privacy and §Settings.
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Clauses
/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 5 (Data Privacy) — scope of the policy. */
const WHO_WE_ARE: LegalClause = {
	id: "who-we-are",
	heading: "Who we are and what this covers",
	tldr:
		"This policy explains what Projective stores about you, why, who else handles it, how long we keep it and what you can ask us to do.",
	body: [
		{
			type: "p",
			content:
				"Projective is responsible for the personal data it processes to run the platform. This policy covers the website and the app, signed in or not.",
		},
		{
			type: "p",
			content: [
				"For the small files and storage entries the site keeps in your browser, see the ",
				{ type: "link", href: "/legal/cookies", text: "Cookie Policy" },
				".",
			],
		},
	],
};

/** Schema tables per the module header · PRODUCT_SPEC.md §Settings · §Assets & Attachments · §Messaging 1. */
const WHAT_WE_COLLECT: LegalClause = {
	id: "what-we-collect",
	heading: "What we collect",
	tldr:
		"Your account details, what you publish and deliver, your messages, your payments and your settings — plus the technical records that keep the service running.",
	body: [
		{
			type: "table",
			caption: "The personal data Projective stores",
			head: ["Category", "Examples", "Where it comes from"],
			rowHeaders: true,
			rows: [
				[
					"Account",
					"Name, @handle, date of birth, email addresses, time zone, city and country, languages, sign-in methods",
					"You, at sign-up and in Settings",
				],
				[
					"Profile and listings",
					"Headline, bio, photo and banner, portfolio, services, products, project briefs",
					"You, when you publish them",
				],
				[
					"Work",
					"Projects, stages, tickets, submissions, files, reviews and Standing",
					"You and the people you work with",
				],
				[
					"Messages",
					"Project channel messages and direct messages, with any contact details masked during a protected project",
					"You and the people you message",
				],
				[
					"Money",
					"Wallet ledger, escrows, invoices, statements, saved-card references and payout account status",
					"Your payments, through Stripe",
				],
				[
					"Verification",
					"Whether your identity check and payout account are verified, and a Business's verification status",
					"Stripe Identity and Stripe Connect",
				],
				[
					"Preferences",
					"Appearance, language and region, display currency, notification and messaging settings",
					"You, in Settings",
				],
				[
					"Technical",
					"Session tokens, error logs, page performance measurements, and search and discovery events",
					"Your browser, as you use the site",
				],
			],
		},
		{
			type: "p",
			content:
				"Projective never stores full card numbers or bank account numbers: Stripe holds them, and we keep only a reference and the last digits so you can recognise a card.",
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1 (Platform Integrity) · §Identity, Taxes & Compliance 1–3 · §Reputation & Discovery · §Notifications. */
const HOW_WE_USE: LegalClause = {
	id: "how-we-use",
	heading: "How we use it",
	tldr:
		"To run the platform, move and protect money, verify who is earning, keep the marketplace safe and show you relevant work.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"To provide the service: your account, your projects, your messages and your files.",
				"To hold, release and refund escrow, and to keep the financial records the law requires.",
				"To verify the identity of everyone who earns, and to detect fraud and money laundering — for example, an account hiring itself through a second account.",
				"To protect the marketplace: during a protected project, contact details in messages are masked automatically.",
				"To rank search results and recommendations. Signed-in adults' searches and views personalise what they see; nothing is personalised for an under-18 account.",
				"To tell you what happened — notifications follow your settings, except the alerts about money, account security and system notices, which cannot be switched off.",
				"To keep the service reliable, using error logs and page performance measurements.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Age guardrails — 13–17 Restricted (high-privacy defaults, the Children's Code) · Under 13 (no retention). */
const YOUNG_PEOPLE: LegalClause = {
	id: "young-people",
	heading: "Young people",
	tldr:
		"Under-18 accounts get the most private settings by default, and nothing is kept about a refused under-13 sign-up.",
	body: [
		{
			type: "list",
			items: [
				"An under-18 account is never profiled: no viewing history, no interest events and no personalised discovery. Its searches are logged anonymously.",
				"Its location and local time are never shown to anyone else, and its profile is never public.",
				"When a date of birth under 13 is refused at sign-up, the date of birth, the IP address and the contact details are neither stored nor logged.",
			],
		},
	],
};

/** `.env.example` processors (Supabase, Stripe, Google Safe Browsing, Voyage AI, connected sign-in and storage providers, Zoom) · PRODUCT_SPEC.md §Settings (Connected accounts). */
const SHARING: LegalClause = {
	id: "sharing",
	heading: "Who we share it with",
	tldr:
		"The services that run Projective for us, the people you work with, and the public where you publish. We do not sell personal data.",
	body: [
		{
			type: "p",
			content: "These services process personal data on Projective's behalf:",
		},
		{
			type: "table",
			caption: "Service providers",
			head: ["Provider", "What it does", "When"],
			rowHeaders: true,
			rows: [
				["Supabase", "Database, sign-in and file storage", "Always"],
				[
					"Stripe",
					"Card payments, payouts (Connect) and identity checks (Identity)",
					"When you pay, earn or verify",
				],
				[
					"Google Safe Browsing",
					"Checks links shared in messages; the full link is sent",
					"When link checks are switched on",
				],
				[
					"Voyage AI",
					"Turns public listing and profile text, and search queries, into search vectors",
					"When smarter search is switched on",
				],
				[
					"Sign-in providers",
					"Google, Apple, Facebook, LinkedIn, Microsoft or Amazon confirm who you are",
					"Only if you sign in with one",
				],
				[
					"Storage you connect",
					"Google Drive, Dropbox, Frame.io or Microsoft storage you link",
					"Only if you connect one",
				],
				[
					"Meeting providers",
					"Attendance records for a booked session",
					"When the session runs through a connected provider such as Zoom",
				],
			],
		},
		{
			type: "p",
			content:
				"Other people see what you choose to publish, and the people on a project see that project's work and messages. We share data with authorities only when the law requires it. We do not sell personal data.",
		},
	],
};

/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 1 (Stripe Identity) · 5 (PII encryption, Supabase Vault). */
const IDENTITY_DATA: LegalClause = {
	id: "identity-data",
	heading: "Identity documents",
	tldr: "Stripe runs the identity check. Projective keeps the result, not your documents.",
	body: [
		{
			type: "p",
			content:
				"The identity check — a government ID and a liveness check — is carried out by Stripe Identity. Projective stores whether you passed, not the document images. Any sensitive identifier Projective must hold is encrypted, never stored in plain text.",
		},
	],
};

/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 5 (Retention Policies — typically 7 years) · §Settings (30-day erasure, 90-day freelancer removal) · §Content safety (report snapshots). */
const RETENTION: LegalClause = {
	id: "retention",
	heading: "How long we keep it",
	tldr:
		"Until you delete your account, then 30 days. Financial records are kept, anonymised, for as long as the law requires — typically seven years.",
	body: [
		{
			type: "table",
			caption: "Retention",
			head: ["Data", "Kept for"],
			rowHeaders: true,
			rows: [
				["Your account and profile", "Until you delete your account, then erased after 30 days"],
				["A freelancer profile you give up", "Erased 90 days after you switch to client only"],
				[
					"Records of money that moved",
					"Anonymised and kept as financial regulation requires, typically seven years",
				],
				[
					"Dispute evidence and report snapshots",
					"Kept unchanged for as long as the case and its record are needed",
				],
				["A refused under-13 sign-up", "Nothing is kept"],
			],
		},
	],
};

/** PRODUCT_SPEC.md §Data Privacy (GDPR/CCPA "Right to be Forgotten") · §Settings (Account) · §Age guardrails (UK DPA 2018, ICO Children's Code). */
const YOUR_RIGHTS: LegalClause = {
	id: "your-rights",
	heading: "Your rights",
	tldr:
		"You can see, correct, export or delete your data, and object to how we use it. Most of it you can change yourself in Settings.",
	body: [
		{
			type: "list",
			items: [
				"Correct your details and preferences yourself in Settings.",
				"Delete your account from Settings → Account (see the Terms of Service for what this needs).",
				"Ask for a copy of your data, or object to or restrict how we use it.",
			],
		},
		{
			type: "p",
			content: [
				"To make a request, ",
				{ type: "link", href: "/contact?intent=support", text: "contact us" },
				". You can also complain to your data protection authority — in the UK, the Information Commissioner's Office.",
			],
		},
	],
};

/** SYSTEM_ARCHITECTURE.md §Security (RLS everywhere, HttpOnly session cookies, verified access tokens — Decision #205). */
const SECURITY: LegalClause = {
	id: "security",
	heading: "Keeping it safe",
	tldr:
		"Every record is protected by access rules in the database, and your session cannot be read by scripts.",
	body: [
		{
			type: "p",
			content:
				"Every table in Projective's database is protected by row-level access rules, so a request can only read what its signed-in person may see. Session tokens are kept in cookies that page scripts cannot read, and every token is verified before it is trusted.",
		},
	],
};

/** Decision #270 — versions are append-only and every one stays readable and comparable. */
const CHANGES: LegalClause = {
	id: "changes",
	heading: "Changes to this policy",
	tldr: "A new version is published here with what changed. Older versions stay readable.",
	body: [
		{
			type: "p",
			content:
				"We publish each new version of this policy on this page with its effective date and a summary of what changed, and keep every earlier version available to read and compare.",
		},
	],
};
// #endregion

/** The Privacy Policy, newest version first. */
export const PRIVACY_VERSIONS = defineLegalVersions([
	{
		id: "privacy-policy",
		slug: "privacy",
		title: "Privacy Policy",
		summary:
			"What personal data Projective stores, why, who processes it for us, how long we keep it and the rights you have over it.",
		version: "1.0",
		updatedAt: "2026-10-17",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [
			WHO_WE_ARE,
			WHAT_WE_COLLECT,
			HOW_WE_USE,
			YOUNG_PEOPLE,
			SHARING,
			IDENTITY_DATA,
			RETENTION,
			YOUR_RIGHTS,
			SECURITY,
			CHANGES,
		],
	},
]);
