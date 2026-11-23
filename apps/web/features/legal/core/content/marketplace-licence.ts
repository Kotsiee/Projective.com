/**
 * Marketplace Licence Terms — every version, newest first (Decision #270; added on the owner's ruling
 * of LEGAL_COMPLIANCE LG1 stop (a), Decision #540).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). What a buyer of a digital product gets, as the
 * product runs today: the licence the listing shows (`catalogue.product_licence`: personal ·
 * commercial · extended, Decision #217 (i); the buyer-facing terms are
 * `packages/types/explore/stored.ts` `licenceTerms`), delivery (PRODUCT_SPEC §Digital Marketplace 7,
 * Decision #488), the download notice at checkout (§Digital Marketplace 6, ruling A8), price and tax
 * (Decisions #435, #490) and promo codes (#511). The licence wording itself, and what a Request to
 * Sell grant lets a seller license (Decision #493), are counsel's (FOUNDER_QUESTIONNAIRE E2.14), so
 * the licence clause points at the terms the listing shows rather than restating them; since the
 * owner's ruling on Decision #540 (A) the seller's licence hint follows the same terms.
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Clauses
/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance (intro, 2 — Marketplace Sourcing) · §7 (bytes reach a buyer only through the platform). */
const SCOPE: LegalClause = {
	id: "scope",
	heading: "What these terms cover",
	tldr: "What you get when you buy a digital product on Projective, and what its seller keeps.",
	body: [
		{
			type: "p",
			content:
				"These terms apply when you buy a digital product on the Projective Marketplace: a template, an asset, a font, code, or anything else delivered as files. The seller owns the product and chooses the licence it is sold under; Projective runs the store, takes the payment and delivers the files.",
		},
		{
			type: "p",
			content: [
				"They apply alongside the ",
				{ type: "link", href: "/legal/terms", text: "Terms of Service" },
				".",
			],
		},
	],
};

/**
 * `catalogue.product_licence` (Decision #217 (i)) · `packages/types/explore/stored.ts` `licenceTerms`
 * (the terms the listing shows: name, summary, allowed and denied uses, attribution per listing) ·
 * PRODUCT_SPEC.md §Digital Marketplace & IP Governance 7 ("Sales are non-exclusive").
 */
const LICENCE: LegalClause = {
	id: "the-licence",
	heading: "The licence you buy",
	tldr:
		"You buy a licence to use the product's files, not the product itself. The listing shows which licence and what it allows.",
	body: [
		{
			type: "p",
			content:
				"Buying a product gives you a licence to use its files. The seller keeps ownership, and may sell the same product to other buyers, on Projective or elsewhere.",
		},
		{
			type: "p",
			content:
				"Every product is sold under one of three licences: personal, commercial or extended. Before you buy, the listing shows the licence's name, a summary of it, and which uses it allows and which it does not, including whether you must credit the seller. Those are the terms of your licence, and the licence is shown again with your purchase.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 7 (delivery built, phase 0, Decision #488; ruling A6, the version frozen at publish). */
const DELIVERY: LegalClause = {
	id: "delivery",
	heading: "Getting your files",
	tldr: "Your files are ready as soon as you have paid, in Files → Purchases.",
	body: [
		{
			type: "list",
			items: [
				"Once your payment is confirmed, you can download every file of the product from Files → Purchases and from your order confirmation.",
				"You get the version of the product that was published when you bought it. A seller who changes or deletes files afterwards cannot change what you bought.",
				"A product bought for a Team, Business or Enterprise is available to its members while they act for it.",
				"Once a purchase is refunded or withdrawn, no more of its files are delivered.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 6 (the download notice, ruling A8, Decision #488; `features/checkout/components/DeliveryTermsNotice.tsx`; a buyer-started refund is not built, FBP DB21) · Decision #276 (the contact form's dispute intent). */
const REFUNDS: LegalClause = {
	id: "refunds",
	heading: "Refunds",
	tldr:
		"Before you pay, you confirm that a file can't be refunded once it has downloaded in full, unless it is faulty or never arrives.",
	body: [
		{
			type: "list",
			items: [
				"Before you pay for a product that delivers files, checkout tells you that a digital file is not refundable once it has downloaded in full, unless it is defective or never arrives, and asks you to tick a box to confirm. Your confirmation is recorded with your purchase.",
				"A file counts as downloaded only once it has reached you in full. Starting a download, part of a file, or a dropped connection does not count.",
			],
		},
		{
			type: "p",
			content: [
				"To ask for a refund, ",
				{ type: "link", href: "/contact?intent=dispute", text: "contact us" },
				" with your order reference.",
			],
		},
	],
};

/** Decision #435 (buyer-currency charging is built but switched off) · Decision #490 (no tax collected while `tax_collection_enabled` is off) · Decision #511 (a promo code once per account by default). */
const PRICE: LegalClause = {
	id: "price-and-tax",
	heading: "Price and tax",
	tldr: "You pay the price shown. Projective collects no tax at checkout today.",
	body: [
		{
			type: "list",
			items: [
				"The price is set by the seller in their currency, and you are charged in that currency. A price converted into your own currency is shown for information only.",
				"Projective does not add or collect tax at checkout today.",
				"A promo code reduces what you pay. Each account can use a code once, unless the code allows more, and a refund does not give the use back.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 and 3 (the Client's explicit agreement) · the IP Transfer Deed's `shared-ip` clause (Decision #493: what a grant lets the seller license is counsel's). */
const PROJECT_WORK: LegalClause = {
	id: "project-work",
	heading: "Products made on a client project",
	tldr: "A product made during a client's project is sold only with that client's agreement.",
	body: [
		{
			type: "p",
			content: [
				"A seller may list a product made during a Projective project only with the Client's agreement, as the ",
				{ type: "link", href: "/legal/ip-transfer-deed", text: "IP Transfer Deed" },
				" sets out.",
			],
		},
	],
};

/** Decision #270 — versions are append-only and every one stays readable and comparable. */
const CHANGES: LegalClause = {
	id: "changes",
	heading: "Changes to these terms",
	tldr: "A new version is published here with what changed. Older versions stay readable.",
	body: [
		{
			type: "p",
			content:
				"We publish each new version of these terms on this page with its effective date and a summary of what changed, and keep every earlier version available to read and compare.",
		},
	],
};
// #endregion

/** The Marketplace Licence Terms, newest version first. */
export const MARKETPLACE_LICENCE_VERSIONS = defineLegalVersions([
	{
		id: "marketplace-licence-terms",
		slug: "marketplace-licence",
		title: "Marketplace Licence Terms",
		summary:
			"What a buyer of a digital product gets on Projective: the licence, the files, refunds, price and tax.",
		version: "1.0",
		updatedAt: "2026-11-23",
		effectiveDate: "2026-11-23",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [SCOPE, LICENCE, DELIVERY, REFUNDS, PRICE, PROJECT_WORK, CHANGES],
	},
]);
