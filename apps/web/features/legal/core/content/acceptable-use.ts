/**
 * Acceptable Use Policy — every version, newest first (Decision #270).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). It states the rules of PRODUCT_SPEC.md
 * §Messaging, Collaboration & Connections 1 — the leakage-prevention pipeline and the permanent ban
 * on contact and payment details in public copy (Decision #147), and the Two-Zone content model
 * (Decision #148). Where the product does not yet enforce a rule automatically (public-copy checks,
 * image screening, the in-product report button), the clause states the rule and how it is applied
 * without claiming a mechanism that does not exist yet.
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Clauses
/** PRODUCT_SPEC.md §Messaging 1.C (the Two-Zone model, Decision #148). */
const PURPOSE: LegalClause = {
	id: "purpose",
	heading: "Why this policy exists",
	tldr:
		"Public pages are held to a strict standard. Private project work is protected space for real creative work — within the law.",
	body: [
		{
			type: "p",
			content:
				"Projective moderates content by where it is seen, not by what it is. Anything a stranger can read — profiles, listings, services and public project briefs — is the public zone, and is held to the standards below. Project channels, deliverables, direct messages and their files are the private zone, shared only by the people working together.",
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1 (the Protected Phase, Restricted Data, the Projective Unlock) · 1.A (Tier 2 masking, Decision #147). */
const PAYMENTS_ON_PLATFORM: LegalClause = {
	id: "keep-payments-on-projective",
	heading: "Keep payments on Projective",
	tldr:
		"Until a project's work is finished and paid, do not share contact or bank details to take the work elsewhere.",
	body: [
		{
			type: "p",
			content:
				"From the first proposal until the final escrow release of a project, you must not share bank details, personal email addresses, phone numbers or external social or messaging handles in its messages. While the project is in this protected phase, Projective replaces them automatically with a placeholder such as “[email hidden]”.",
		},
		{
			type: "p",
			content:
				"Once the project is complete and its escrow released, this restriction lifts for that project's messages, and you are welcome to exchange contact details.",
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1.B (public surfaces are never unlocked, Decision #147). */
const PUBLIC_COPY: LegalClause = {
	id: "public-pages",
	heading: "What public pages may never contain",
	tldr:
		"No payment details, payment links or contact details on any public page — ever. This never lifts.",
	body: [
		{
			type: "p",
			content:
				"Your profile headline and bio, your services, products and listings, and your public project briefs must never contain:",
		},
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"personal banking or payment details — account and routing numbers, IBANs, card numbers;",
				"off-platform payment links or handles — PayPal, Venmo, Cash App, Zelle, Wise, Revolut, Ko-fi, $cashtags and the like;",
				"a way to contact you off the platform offered for doing business there — email addresses, phone numbers, messaging links or social handles.",
			],
		},
		{
			type: "p",
			content:
				"This applies however long you have used Projective and however many projects you have completed. Copy that breaks it may be refused or removed.",
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1.C (public zone — screen, then publish). */
const PUBLIC_STANDARDS: LegalClause = {
	id: "public-content",
	heading: "Public content standards",
	tldr: "No explicit, violent or hateful content on public pages.",
	body: [
		{
			type: "p",
			content:
				"Public pages and images must not contain nudity or sexual content, graphic violence, or hate symbols or hate speech. No brief, Standing level or plan buys an exception.",
		},
		{
			type: "p",
			content:
				"Projective may refuse to publish, or remove, content that breaks this standard. A refused image stays in your private library, and you are told why.",
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1.C (private zone — the creative safe harbor). */
const SAFE_HARBOR: LegalClause = {
	id: "private-work",
	heading: "Private work: the creative safe harbor",
	tldr:
		"Adult or explicit material that serves the work is allowed among the people working on it. Illegal content and harassment never are.",
	body: [
		{
			type: "p",
			content:
				"Creative and technical work sometimes needs adult or explicit material — anatomy and character modelling, life drawing, film dialogue, medical illustration. Inside a private collaboration this is allowed, as long as it serves the work and is shared only with the people engaged on it. Private work is not scanned for it.",
		},
		{
			type: "p",
			content: "The safe harbor never covers:",
		},
		{
			type: "list",
			items: [
				"anything illegal, including any sexual content involving minors, which is reported beyond the platform as the law requires;",
				"harassment or threats directed at anyone;",
				"explicit material sent to someone who has not engaged on that work.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 3 (AML, round-tripping, sanctions) · §Dispute Resolution 4 (bad-faith reporting) · §Standing (never purchasable) · §Age guardrails. */
const PROHIBITED: LegalClause = {
	id: "never-allowed",
	heading: "Never allowed anywhere",
	tldr: "Fraud, money laundering, gaming the reputation system and getting around the rules.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"Fraud, money laundering or sanctions evasion — including hiring yourself through a second account to move money (“round-tripping”).",
				"Pretending to be someone else, or giving false details when you sign up or verify.",
				"Raising disputes or no-show claims you know to be false.",
				"Manipulating reviews, Standing or rankings. Standing is earned only; it cannot be bought or traded.",
				"Getting around the age rules, or helping someone under 18 to buy, sell or hold money.",
				"Uploading malware, probing or overloading the service, or collecting other people's data from it.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1.C (Reporting — an immutable snapshot, reporter never revealed). The in-product report surface is planned (Decision #148 flag (a)). */
const REPORTING: LegalClause = {
	id: "reporting",
	heading: "Reporting",
	tldr:
		"Tell us about anything that breaks this policy. The person you report is never told who reported them.",
	body: [
		{
			type: "p",
			content: [
				"Anyone who can see a message, submission, file or public page can report it, choosing a reason. Until reporting is available on each item, ",
				{ type: "link", href: "/contact?intent=support", text: "contact us" },
				".",
			],
		},
		{
			type: "p",
			content:
				"When a report is filed, Projective keeps an unchangeable copy of what was reported, so editing or deleting it afterwards changes nothing. A reviewer either dismisses the report or confirms the breach. The reported person is never told who reported them.",
		},
	],
};

/** PRODUCT_SPEC.md §Messaging 1 (Consequences) · 1.C (penalties feed the Reliability Index and Standing; never deleted) · §Notifications rule 1. */
const CONSEQUENCES: LegalClause = {
	id: "consequences",
	heading: "Consequences",
	tldr:
		"A confirmed breach brings a penalty sized to it. It can lower your Standing, and serious or repeated breaches end in suspension or a ban.",
	body: [
		{
			type: "list",
			items: [
				"A confirmed breach issues a penalty sized to its severity. Active penalties lower your Reliability Index and can move your Standing down a rung, with the allowances that rung carries.",
				"Serious or repeated breaches lead to a temporary suspension or a permanent ban.",
				"You are always told about a moderation decision that affects you.",
				"A penalty can expire or be reversed on review. It is never deleted from the record.",
			],
		},
	],
};
// #endregion

/** The Acceptable Use Policy, newest version first. */
export const ACCEPTABLE_USE_VERSIONS = defineLegalVersions([
	{
		id: "acceptable-use-policy",
		slug: "acceptable-use",
		title: "Acceptable Use Policy",
		summary:
			"What you may and may not do on Projective: keeping payments on the platform, what public pages may contain, the creative safe harbor for private work, and what happens when the rules are broken.",
		version: "1.0",
		updatedAt: "2026-10-17",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [
			PURPOSE,
			PAYMENTS_ON_PLATFORM,
			PUBLIC_COPY,
			PUBLIC_STANDARDS,
			SAFE_HARBOR,
			PROHIBITED,
			REPORTING,
			CONSEQUENCES,
		],
	},
]);
