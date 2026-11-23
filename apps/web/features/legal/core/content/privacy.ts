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

/** Schema tables per the module header · `org.legal_acceptances` (Decision #446) · `community.newsletter_subscriptions` (Decision #480) · `ops.contact_requests` (Decision #276) · web push subscriptions (`packages/backend/services/comms/transport-webpush.ts`) · PRODUCT_SPEC.md §Settings · §Assets & Attachments · §Messaging 1. */
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
					"Appearance, language and region, display currency, notification and messaging settings, and the browsers you turned device alerts on in",
					"You, in Settings",
				],
				[
					"Agreements",
					"Which version of the Terms of Service and the Acceptable Use Policy you accepted, and which version of this policy you were shown, and when",
					"You, when you sign up or accept a new version",
				],
				[
					"Newsletter",
					"Your email address and the newsletter topics you confirmed, whether or not you have an account",
					"You, when you subscribe and confirm",
				],
				[
					"Contact requests",
					"What you send us through the contact form: your message, your email address if you give one, and any files you attach",
					"You, when you contact us",
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

/** PRODUCT_SPEC.md §Messaging 1 (Platform Integrity) · §Identity, Taxes & Compliance 1–3 · §Reputation & Discovery · §Notifications · Decisions #446 (acceptance records), #447 (bot check), #480 / #492 (newsletter double opt-in; Marketing opt-in at the root), #276 (contact requests). */
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
				"To send the newsletter and marketing email only with your yes: a newsletter address gets nothing until it confirms the link we send it, each new topic is confirmed on its own, and marketing messages stay off until you switch them on. Unsubscribing stops them.",
				"To answer what you send us through the contact form.",
				"To keep a record of which version of our terms you accepted, so we can show what applied to you.",
				"To stop automated sign-ups and sign-ins with a bot check on those forms.",
				"To keep the service reliable, using error logs and page performance measurements.",
			],
		},
	],
};

/** The AML monitoring use, as LG7 records it (Decision #529; `finance.aml_signals`, finance-model.md §17; the Safety Hold is off, so nothing is said of it). */
const MONITORING_USE =
	"To verify the identity of everyone who earns, and to detect fraud and money laundering. When money moves, we record two patterns that call for a closer look: one person paying and being paid for the same work, directly or through a business or team they belong to; and a large card payment withdrawn soon after it came in. We build them only from records we already hold — the payment, the people on each side and the time — never from your device, IP address or location. Only our staff can see them, nothing is decided about you automatically from them, and we keep them for five years after your account closes, or as long as the payment records if that is longer. Our basis is our legitimate interest in preventing fraud and money laundering.";

/** {@link HOW_WE_USE} with its fraud item naming the monitoring signals (Decision #529; PRODUCT_SPEC.md §Identity, Taxes & Compliance 3), for the newest draft; 1.0 keeps {@link HOW_WE_USE} (Decision #531 (A)). */
const HOW_WE_USE_V2: LegalClause = {
	...HOW_WE_USE,
	body: HOW_WE_USE.body.map((block) =>
		block.type === "list"
			? {
				...block,
				items: block.items.map((item) =>
					typeof item === "string" &&
						item.startsWith("To verify the identity of everyone who earns")
						? MONITORING_USE
						: item
				),
			}
			: block
	),
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

/** `.env.example` processors (Supabase; Resend, with the contacts sync behind `newsletter.provider_sync`, Decision #502; Stripe; Google Web Risk; Voyage AI; Cloudflare Turnstile, `TURNSTILE_*`, Decision #447; web push, `VAPID_*`, payloads encrypted per RFC 8291 in `packages/backend/services/comms/transport-webpush.ts`; calendar providers, `GOOGLE_/MICROSOFT_INTEGRATION_*`; Zoom) · sign-in: `supabase/config.toml` (Google on; Apple and SMS off) and SAML SSO (`routes/api/auth/sso.ts`) · storage: Google Drive, the one storage connector a person can reach (seed `00005050`) · `integrations.provider_kind` `calendar` / `freebusy` · PRODUCT_SPEC.md §Settings (Connected accounts). */
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
					"Resend",
					"Sending our email; and, once newsletter sync is switched on, holding the newsletter's list of confirmed subscribers and their topics",
					"When we email you, you are invited by email, or you subscribe to the newsletter",
				],
				[
					"Cloudflare Turnstile",
					"Checks that a sign-up, sign-in, account recovery or newsletter request comes from a person, using your IP address and browser signals",
					"When you use one of those forms",
				],
				[
					"Stripe",
					"Card payments, payouts (Connect) and identity checks (Identity)",
					"When you pay, earn or verify",
				],
				[
					"Google Web Risk",
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
					"Google, or the single sign-on service of an organisation that has set one up with us, confirms who you are",
					"Only if you sign in with one",
				],
				[
					"Storage you connect",
					"A Google Drive you link",
					"Only if you connect one",
				],
				[
					"Calendars you connect",
					"A Google or Microsoft (Outlook) calendar you link: read for your events, of which we keep each one's title, times, repeat pattern, location, notes and meeting link, never its guests. Only you can see those details, and disconnecting removes them. If you turn on publishing, your Projective events are also written to a separate Projective calendar there, with a title, a time and a Projective join address",
					"Only if you connect one",
				],
				[
					"The people you invite by email",
					"An address you add to an event goes to our email provider, and we write to that person on your behalf. They see your name and the event's title and time. We keep their address until 30 days after the event, and if they join a call on a Zoom host we also give that host their address",
					"Only if you invite someone by email",
				],
				[
					"Your browser's push service",
					"Delivers alerts to a browser where you turned them on. It is run by your browser's maker, such as Google, Apple, Mozilla or Microsoft, and the alert itself is encrypted so it cannot read it",
					"Only if you turn on device alerts",
				],
				[
					"Meeting providers",
					"Attendance records for a meeting. A host's Zoom account also gets your name and email the first time you join their room, so that your link is your own",
					"When the meeting runs through a connected provider such as Zoom, Google Meet or Microsoft Teams",
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

/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 5 (Retention Policies — typically 7 years) · §Settings (30-day erasure, 90-day freelancer removal) · §Content safety (report snapshots) · `supabase/migrations/00001061_functions_org_data_export.sql` (an export archive expires after 7 days, Decision #450). */
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
				[
					"Attendance records for a session or call",
					"13 months, or as long as a dispute about it needs them",
				],
				[
					"A copy of your data you asked for",
					"7 days from when it is ready, then deleted",
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

/** Version 1.1 of {@link YOUR_RIGHTS}: a copy of your data is self-serve from Settings (Decision #450). */
const YOUR_RIGHTS_SELF_SERVE_COPY: LegalClause = {
	id: "your-rights",
	heading: "Your rights",
	tldr:
		"You can see, correct, download or delete your data, and object to how we use it. Most of it you can do yourself in Settings.",
	body: [
		{
			type: "list",
			items: [
				"Correct your details and preferences yourself in Settings.",
				"Download a copy of your data from Settings → Account → Download your data. We prepare it as a ZIP of machine-readable files, with a list of your files, and you can download it for 7 days. You can ask once a day, and we ask you to sign in again first.",
				"Delete your account from Settings → Account (see the Terms of Service for what this needs).",
				"Object to or restrict how we use your data.",
			],
		},
		{
			type: "p",
			content: [
				"For anything you can't do in Settings, ",
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
		version: "1.1",
		updatedAt: "2026-11-23",
		effectiveDate: "2026-11-18",
		reviewedAt: null,
		changeSummary:
			"Your rights: download a copy of your data yourself from Settings → Account instead of asking us for it. How we use it: the patterns we record when money moves, to detect fraud and money laundering.",
		sections: [
			WHO_WE_ARE,
			WHAT_WE_COLLECT,
			HOW_WE_USE_V2,
			YOUNG_PEOPLE,
			SHARING,
			IDENTITY_DATA,
			RETENTION,
			YOUR_RIGHTS_SELF_SERVE_COPY,
			SECURITY,
			CHANGES,
		],
	},
	{
		id: "privacy-policy",
		slug: "privacy",
		title: "Privacy Policy",
		summary:
			"What personal data Projective stores, why, who processes it for us, how long we keep it and the rights you have over it.",
		version: "1.0",
		updatedAt: "2026-11-23",
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
