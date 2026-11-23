/**
 * Copyright & Notice Policy — every version, newest first (Decision #270; added on the owner's
 * ruling of LEGAL_COMPLIANCE LG1 stop (a), Decision #540).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). Decision #496 rules the notice regime: a
 * notice needs no account and is filed through a rate-limited door into `ops.reports` as source
 * `notice` (the sink is built, T&S R1, #533; the public form is MARKETPLACE SC8, behind a switch
 * that stays off), and an operator's takedown hold pauses a listing until an operator lifts it (not
 * built). What a valid notice must contain, the counter-notice and its waiting period, the
 * repeat-infringer rule and the designated agent are counsel's (FOUNDER_QUESTIONNAIRE E2.10), so
 * each clause says what the platform does today and nothing more, and the repeat-infringer rule has
 * no clause yet.
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Clauses
/** Decision #496 (a notice needs no account) · PRODUCT_SPEC.md §Digital Marketplace & IP Governance 4 (System of Record). */
const SCOPE: LegalClause = {
	id: "scope",
	heading: "What this policy covers",
	tldr:
		"How to tell us that something on Projective copies work you own, and what happens when you do. You don't need an account.",
	body: [
		{
			type: "p",
			content:
				"This policy is for anyone who believes that something shown on Projective — a listing, a profile, a public project page or a product's files — copies work whose copyright they own or act for. You do not need a Projective account to use it.",
		},
		{
			type: "p",
			content: [
				"Who owns work made on a Projective project is set by the ",
				{ type: "link", href: "/legal/ip-transfer-deed", text: "IP Transfer Deed" },
				", not by this policy.",
			],
		},
	],
};

/** Decision #276 (the contact form takes a guest's request; `ops.contact_requests`, operator-read only) · Decision #496 (the public notice form, MARKETPLACE SC8, stays off). */
const TELLING_US: LegalClause = {
	id: "telling-us",
	heading: "Telling us about a copy",
	tldr: "Until the notice form opens, tell us through the contact form.",
	body: [
		{
			type: "p",
			content: [
				"Use the ",
				{ type: "link", href: "/contact?intent=support", text: "contact form" },
				" to tell us which of your works is copied and where on Projective the copy appears, and how we can reach you. Attach anything that shows the work is yours.",
			],
		},
		{
			type: "p",
			content:
				"A dedicated form for copyright notices is being built. Until it opens, a message through the contact form is how a notice reaches us.",
		},
	],
};

/** Decision #496 (an operator takes content down; the takedown hold itself is not built) · `ops.contact_requests` (read by operators only, Decision #276). */
const WHAT_HAPPENS: LegalClause = {
	id: "what-happens-next",
	heading: "What happens next",
	tldr: "A person at Projective reads every notice. Content that copies your work may be removed.",
	body: [
		{
			type: "list",
			items: [
				"Every notice is read by Projective's own staff. Nothing is taken down automatically.",
				"If the content copies your work, Projective may remove it, or pause the listing it appears in.",
			],
		},
	],
};

/** Decision #496 (the counter-notice regime is counsel's, FOUNDER_QUESTIONNAIRE E2.10) · Decision #276 (the contact form). */
const REVIEW: LegalClause = {
	id: "if-your-content-was-removed",
	heading: "If your content was taken down",
	tldr: "If you think a takedown was a mistake, tell us why.",
	body: [
		{
			type: "p",
			content: [
				"If something of yours was removed after a copyright notice and you believe that was wrong — because the work is yours, or you have the right to use it — ",
				{ type: "link", href: "/contact?intent=support", text: "tell us why" },
				". Projective's staff will look at it again.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 4 (On-Platform Disputes, Off-Platform Sales) · the IP Transfer Deed's `ip-disputes` clause. */
const PROJECT_WORK: LegalClause = {
	id: "project-work",
	heading: "Work made on a Projective project",
	tldr:
		"Selling a client's project work without their agreement can get a listing removed and a seller suspended.",
	body: [
		{
			type: "p",
			content: [
				"If a Freelancer lists something made on a project they worked on without the Client's agreement, Projective may remove the listing and suspend the seller, as the ",
				{ type: "link", href: "/legal/ip-transfer-deed", text: "IP Transfer Deed" },
				" sets out. Projective cannot act against copies sold on other websites, but its records of the project are available to both sides as evidence.",
			],
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

/** The Copyright & Notice Policy, newest version first. */
export const COPYRIGHT_VERSIONS = defineLegalVersions([
	{
		id: "copyright-policy",
		slug: "copyright",
		title: "Copyright & Notice Policy",
		summary:
			"How to tell Projective that something on the platform copies your work, what happens next, and how to ask for a takedown to be reviewed.",
		version: "1.0",
		updatedAt: "2026-11-23",
		effectiveDate: "2026-11-23",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [SCOPE, TELLING_US, WHAT_HAPPENS, REVIEW, PROJECT_WORK, CHANGES],
	},
]);
