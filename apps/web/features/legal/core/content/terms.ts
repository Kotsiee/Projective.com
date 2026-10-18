/**
 * Terms of Service — every version, newest first (Decision #270).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)): every clause restates a rule the product
 * enforces today, and the JSDoc above it names the PRODUCT_SPEC section (and decision) it comes from,
 * so a reviewer checks facts rather than invents them. A clause that reads the same in two versions
 * is one constant both versions list.
 *
 * Version 1.0 is a reconstructed, never-published baseline — the rules as they stood on 1 August
 * 2026, so Compare has something to compare with (its `changeSummary` says so on the page); 2.0 folds
 * in the October 2026
 * rulings (the under-18 rule set, the payout-ready gate before earning, the invitation cooldown,
 * account deletion) and drops the business opening credit, which no longer exists.
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Shared clauses
/** PRODUCT_SPEC.md §Features (Stage-Based Projects) · §Sitemap — what the agreement covers. */
const ABOUT: LegalClause = {
	id: "about",
	heading: "About these terms",
	tldr:
		"These terms are the agreement between you and Projective whenever you use the platform, alongside the policies they link to.",
	body: [
		{
			type: "p",
			content:
				"Projective is a platform where Clients commission work from Freelancers, Teams and Businesses. Work is organised into projects, stages and tickets, and each piece of work is paid through escrow: the money is held before work starts and released when the work is approved.",
		},
		{
			type: "p",
			content: [
				"These terms apply to everyone who uses Projective, signed in or not. Together with the ",
				{ type: "link", href: "/legal/privacy", text: "Privacy Policy" },
				", the ",
				{ type: "link", href: "/legal/cookies", text: "Cookie Policy" },
				", the ",
				{ type: "link", href: "/legal/acceptable-use", text: "Acceptable Use Policy" },
				", the ",
				{ type: "link", href: "/legal/escrow-terms", text: "Escrow Terms" },
				" and the ",
				{ type: "link", href: "/legal/ip-transfer-deed", text: "IP Transfer Deed" },
				", they form the whole agreement between you and Projective.",
			],
		},
		{
			type: "p",
			content:
				"Each clause opens with a plain-English summary. The summary is there to help you read; where it and the clause text differ, the clause text applies.",
		},
	],
};

/** PRODUCT_SPEC.md §Settings (handle changes, email addresses) · §Authentication surfaces · §Identity, Taxes & Compliance 3 (Round-Tripping — hiring yourself through a second account). */
const ACCOUNTS: LegalClause = {
	id: "accounts",
	heading: "Your account",
	tldr:
		"Give true details, keep your sign-in safe, and never use a second account to hire yourself. You are responsible for what happens under your account.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"The details you give us — your name, date of birth and email address — must be true and kept up to date. You may not use a second account to hire yourself or to move money to yourself.",
				"You can sign in with an email address and password, or with a connected account (such as Google) where that provider is switched on. You may disconnect a sign-in method only while another remains.",
				"You may hold up to five email addresses. An added address counts only once you confirm it through the link we send to it, which works once, for your account, within 24 hours.",
				"You may change your @handle twice within three days; after the second change it is locked for 90 days. A handle you give up is held for you for 90 days, and nobody else can take it in that time.",
				"Keep your password and sessions secure, and tell us at once if you think someone else has used your account.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Freelancers & Teams · §Clients & Businesses · §Subscriptions ("Joining is never capped"). */
const ROLES: LegalClause = {
	id: "roles",
	heading: "Clients, Freelancers, Teams and Businesses",
	tldr:
		"A Client commissions work, a Freelancer does it, a Team is a group of freelancers paid as one, and a Business is a buyer with a shared wallet.",
	body: [
		{
			type: "dl",
			items: [
				{
					term: "Client",
					definition:
						"Anyone who commissions work on Projective, as an individual or on behalf of a Business.",
				},
				{
					term: "Freelancer",
					definition:
						"Anyone who offers and delivers work on Projective. Every Freelancer can also act as a Client.",
				},
				{
					term: "Team",
					definition:
						"A group of Freelancers that applies for and is paid for work as one. A Team's earnings are split between its members by the contribution agreement they set.",
				},
				{
					term: "Business",
					definition:
						"A buyer entity with a pooled wallet. Its members act within the permissions, spending limits and approval thresholds its owner sets.",
				},
			],
		},
		{
			type: "p",
			content:
				"Whoever acts for a Team or a Business must hold the permission the act needs. The owner of a Team or Business is responsible for the permissions they grant. Joining Teams and Businesses is never capped; owning them may be limited by your plan.",
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #2 · finance-model.md §1.1 · `security.platform_params.platform_fee_bp` (500). */
const PAYMENTS: LegalClause = {
	id: "payments",
	heading: "Payments and fees",
	tldr:
		"Work is paid through escrow under the Escrow Terms. Projective charges a 5% service fee when escrow is released.",
	body: [
		{
			type: "p",
			content: [
				"Every payment for work goes through escrow, as the ",
				{ type: "link", href: "/legal/escrow-terms", text: "Escrow Terms" },
				" describe. Projective is the ledger of record; card payments and payouts run through Stripe.",
			],
		},
		{
			type: "list",
			items: [
				"Projective's service fee is 5% of each escrow release, deducted from the payee when the release happens. Card processing costs are passed through at cost.",
				"No fee is charged on a refund.",
				"A price is set in the seller's currency, and that is the currency it is charged and paid in; the seller receives it less the service fee above. You may see prices converted into your own currency; the conversion is for display and never changes what is charged or paid.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Messaging, Collaboration & Connections 1 (Platform Integrity) · Decision #147. */
const CONDUCT: LegalClause = {
	id: "conduct",
	heading: "Using Projective properly",
	tldr:
		"Follow the Acceptable Use Policy. Keep payments for work on Projective until the work is finished.",
	body: [
		{
			type: "p",
			content: [
				"You must follow the ",
				{ type: "link", href: "/legal/acceptable-use", text: "Acceptable Use Policy" },
				". In particular, from the first proposal until the final escrow release you may not share bank details, personal email addresses, phone numbers or external handles in project messages to take payment off the platform.",
			],
		},
		{
			type: "p",
			content:
				"Breaking these terms may lead to a temporary suspension or a permanent ban, depending on how serious the breach is and whether it is repeated.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 · §Identity, Taxes & Compliance 4. */
const CONTENT_AND_IP: LegalClause = {
	id: "content-and-ip",
	heading: "Your content and intellectual property",
	tldr:
		"What you upload stays yours. Ownership of delivered work follows the project's IP setting and the IP Transfer Deed.",
	body: [
		{
			type: "p",
			content:
				"You keep ownership of what you upload. You give Projective a licence to store, process and display it only as far as running the platform needs — for example, to show your public profile to visitors, or a delivered file to the Client who paid for it.",
		},
		{
			type: "p",
			content: [
				"Who owns the work delivered on a project is set by that project's IP setting and by the ",
				{ type: "link", href: "/legal/ip-transfer-deed", text: "IP Transfer Deed" },
				". By default, ownership passes to the Client when the escrow for the work is finally released.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Dispute Resolution 5 · §Digital Marketplace & IP Governance 4 (System of Record). */
const LIABILITY: LegalClause = {
	id: "liability",
	heading: "Our role and its limits",
	tldr:
		"Projective runs the platform and keeps the record. The agreement to do the work is between the Client and whoever does it.",
	body: [
		{
			type: "p",
			content:
				"Projective provides the platform, holds escrow and keeps the record of the work, the payments and the transfer of intellectual property. The agreement to do a piece of work is between the Client and the Freelancer, Team or Business doing it; Projective is not a party to it.",
		},
		{
			type: "p",
			content:
				"Projective settles disputes about escrow on the platform as the Escrow Terms describe. It does not arbitrate what happens off the platform. Nothing in these terms limits a right you have by law that cannot be limited.",
		},
	],
};

/** Decision #270 — versions are append-only and every one stays readable and comparable. */
const CHANGES: LegalClause = {
	id: "changes",
	heading: "Changes to these terms",
	tldr:
		"When these terms change, the new version is published here with what changed. Older versions stay readable.",
	body: [
		{
			type: "p",
			content:
				"We publish each new version of these terms on this page with its version number, its effective date and a summary of what changed. Every earlier version stays available here, and you can compare any two versions clause by clause.",
		},
		{
			type: "p",
			content:
				"If you keep using Projective after a new version takes effect, that version applies to you from its effective date.",
		},
	],
};
// #endregion

// #region Version 2.0 clauses
/** PRODUCT_SPEC.md §Account Creation, Age Guardrails & Onboarding — Age guardrails (Decisions #190, #192, #208). */
const AGE: LegalClause = {
	id: "age",
	heading: "Age requirements",
	tldr:
		"You must be at least 13. Until you turn 18 your account is restricted: no buying, selling, money or workspaces.",
	body: [
		{
			type: "p",
			content:
				"Projective is not for anyone under 13. An under-13 date of birth is refused before anything is stored: no account is created, nothing about the attempt is kept, and that browser session cannot try again.",
		},
		{
			type: "p",
			content: "From 13 until your 18th birthday your account is restricted. It:",
		},
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"cannot buy services, fund stages, lock escrow, claim paid tickets, sell, publish listings, or book calls or session seats;",
				"cannot hold a wallet or a payout account, and cannot create or join a Team, Business or Enterprise;",
				"keeps a profile that is unlisted or private, never public, and never shows its location or local time to anyone else;",
				"can exchange direct messages only with people it follows and who follow it back;",
				"may create personal projects, which have no money, no members and no hiring, and stay personal for life.",
			],
		},
		{
			type: "p",
			content: [
				"Your age is worked out from your date of birth on today's date in your own time zone, so the restriction lifts by itself on your 18th birthday. From 18 you have full access, subject to ",
				{ type: "link", href: "#verification-and-payouts", text: "verification before you earn" },
				".",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 (payout-ready before earning, Decision #196) · §Identity, Taxes & Compliance 1. */
const VERIFICATION_V2: LegalClause = {
	id: "verification-and-payouts",
	heading: "Verification before you earn",
	tldr:
		"To earn, verify your identity and add a payout account first. Buying as an individual needs no ID.",
	body: [
		{
			type: "p",
			content:
				"Before you can apply for or accept paid work, be assigned or claim a ticket, or create or join a Team, you must complete an identity check with Stripe Identity and connect a payout account that Stripe has verified.",
		},
		{
			type: "list",
			items: [
				"A Team is given work only when everyone with a share of its earnings has done both.",
				"A Business must complete business verification (KYB) before it can operate its pooled wallet.",
				"An individual Client can pay by card with no identity check and no wallet to set up.",
				"Money leaves Projective only to a verified payout account in the name of its owner.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §The Hiring Process 1 (the Outbound Invitation) · §Subscriptions — Proposal allowances (Decision #228 (E)). */
const HIRING: LegalClause = {
	id: "hiring",
	heading: "Invitations and proposals",
	tldr:
		"Saying no once is enough: a declined invitation cannot be sent again to the same person for the same project for 48 days.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"If a Freelancer or Team declines your invitation to a project, you cannot invite them to that project again for 48 days from the decline. Dismissing the declined invitation does not shorten this.",
				"A Client may send at most 10 invitations in any 10 minutes, across all projects.",
				"Proposals are metered by a weekly allowance and a small rolling buffer, on every plan. Withdrawing a pending proposal returns its weekly unit, but not its buffer token.",
				"A Team may send proposals only once it is published, has at least two members, and is represented by a member who may commit it to work.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Settings (Deleting an account, Freelancer or client — Decision #156) · §Data Privacy (Retention Policies). */
const CLOSING_V2: LegalClause = {
	id: "closing",
	heading: "Closing your account",
	tldr:
		"You can delete your account from Settings. Your profile is hidden at once and your personal data is erased after 30 days.",
	body: [
		{
			type: "p",
			content:
				"You can delete your account from Settings → Account by typing a confirmation. Your profile is hidden at once and your personal data is erased after 30 days; until then you can cancel the deletion from Settings.",
		},
		{
			type: "p",
			content:
				"You cannot delete your account while money is held in escrow for you or by you, while you have live work, while your wallet holds money, while a project you own is running, or while you own a Team, Business or Enterprise.",
		},
		{
			type: "p",
			content:
				"Erasure anonymises your account. Records of money that moved are kept, anonymised, for as long as financial regulation requires — typically seven years.",
		},
		{
			type: "p",
			content:
				"We may suspend or close an account that breaks these terms, as the Acceptable Use Policy describes.",
		},
	],
};
// #endregion

// #region Version 1.0 clauses
/** PRODUCT_SPEC.md §Account Creation, Age Guardrails & Onboarding (as added 2026-07-13, Decisions #5–#7). */
const AGE_V1: LegalClause = {
	id: "age",
	heading: "Age requirements",
	tldr: "You must be at least 13. Until you turn 18 you cannot buy or sell on Projective.",
	body: [
		{
			type: "p",
			content:
				"Projective is not for anyone under 13, and an under-13 date of birth is refused at sign-up. From 13 until your 18th birthday you may explore Projective and build a private profile, but you cannot buy or sell work, hold a wallet or receive payouts.",
		},
	],
};

/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 1 (Level 2 for payouts, as written before Decision #196). */
const VERIFICATION_V1: LegalClause = {
	id: "verification-and-payouts",
	heading: "Verification before you earn",
	tldr: "To be paid out, verify your identity and add a payout account. Buying needs no ID.",
	body: [
		{
			type: "p",
			content:
				"Before you can withdraw earnings you must complete an identity check with Stripe Identity and connect a payout account that Stripe has verified. A Business must complete business verification (KYB) before it can operate its pooled wallet. An individual Client can pay by card with no identity check.",
		},
	],
};

/** PRODUCT_SPEC.md §Clients & Businesses — Business Wallets (the Opening Platform Credit, removed 2026-09-28 by Decision #122). */
const OPENING_CREDIT_V1: LegalClause = {
	id: "opening-credit",
	heading: "Opening platform credit",
	tldr: "A new Business wallet starts with a one-time platform credit.",
	body: [
		{
			type: "p",
			content:
				"When a Business opens its pooled wallet, Projective adds a one-time opening platform credit to it. The credit can be spent on work on Projective only; it cannot be withdrawn.",
		},
	],
};

/** PRODUCT_SPEC.md §Settings — account deletion (as it stood before Decision #156). */
const CLOSING_V1: LegalClause = {
	id: "closing",
	heading: "Closing your account",
	tldr: "You can ask us to delete your account. Financial records are kept as the law requires.",
	body: [
		{
			type: "p",
			content:
				"You can ask us to delete your account at any time. We erase your personal data, except records of money that moved, which we keep for as long as financial regulation requires — typically seven years.",
		},
		{
			type: "p",
			content:
				"We may suspend or close an account that breaks these terms, as the Acceptable Use Policy describes.",
		},
	],
};
// #endregion

/** The Terms of Service, newest version first. */
export const TERMS_VERSIONS = defineLegalVersions([
	{
		id: "terms-of-service",
		slug: "terms",
		title: "Terms of Service",
		summary:
			"The agreement between you and Projective: accounts, age, roles, verification, hiring, payments and how the agreement changes.",
		version: "2.0",
		updatedAt: "2026-10-17",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary:
			"Adds the full under-18 rule set and the invitation cooldown, requires verification before earning rather than before payout, sets out account deletion, and removes the business opening credit.",
		sections: [
			ABOUT,
			ACCOUNTS,
			AGE,
			ROLES,
			VERIFICATION_V2,
			HIRING,
			PAYMENTS,
			CONDUCT,
			CONTENT_AND_IP,
			CLOSING_V2,
			LIABILITY,
			CHANGES,
		],
	},
	{
		id: "terms-of-service",
		slug: "terms",
		title: "Terms of Service",
		summary:
			"The agreement between you and Projective: accounts, age, roles, verification, payments and how the agreement changes.",
		version: "1.0",
		updatedAt: "2026-07-28",
		effectiveDate: "2026-08-01",
		reviewedAt: null,
		changeSummary:
			"A reconstructed baseline, never published: the rules as they stood on 1 August 2026, kept so later versions can be compared with it.",
		sections: [
			ABOUT,
			ACCOUNTS,
			AGE_V1,
			ROLES,
			VERIFICATION_V1,
			PAYMENTS,
			OPENING_CREDIT_V1,
			CONDUCT,
			CONTENT_AND_IP,
			CLOSING_V1,
			LIABILITY,
			CHANGES,
		],
	},
]);
