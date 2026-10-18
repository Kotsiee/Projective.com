/**
 * IP Transfer Deed — every version, newest first (Decision #270).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). It states the chain-of-title rules of
 * PRODUCT_SPEC.md §Digital Marketplace & IP Governance and §Identity, Taxes & Compliance 4 (Legal
 * Handover & IP Documents), with the project-level IP setting as it is stored today
 * (`projects.projects.ip_ownership_mode`: `exclusive_transfer` · `licensed_use` · `shared_ownership` ·
 * `projective_partner`; `portfolio_display_rights`: `allowed` · `forbidden` · `embargoed`, labelled
 * in `packages/types/projects/workspace.ts`). The signed Deed of Transfer document and the Audit Pack
 * are not built yet — the signed-in IP workspace at `/legal/workspace` is where they will live — so the
 * record clause says what exists today and what is coming, and claims nothing more.
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Clauses
/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 4 (the Chain of Title). */
const PURPOSE: LegalClause = {
	id: "purpose",
	heading: "What this deed does",
	tldr:
		"It decides who owns the work delivered through a Projective project, and keeps the record that proves it.",
	body: [
		{
			type: "p",
			content:
				"This deed governs the intellectual property in everything delivered through a project on Projective — files, designs, code, writing and any other work product — between the Client who pays for it and the Freelancer or Team who makes it. Projective keeps the record of who owns what, and when that changed: the chain of title.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 · `projects.projects.ip_ownership_mode` / `portfolio_display_rights`. */
const PROJECT_SETTING: LegalClause = {
	id: "the-projects-setting",
	heading: "The project's IP setting",
	tldr:
		"Each project says how ownership passes and whether the work may be shown in a portfolio. Unless it says otherwise, the Client gets it all.",
	body: [
		{
			type: "p",
			content:
				"Whoever sets up a project chooses how its intellectual property is handled. Everyone who joins the project sees the setting before they commit to it.",
		},
		{
			type: "table",
			caption: "Ownership settings",
			head: ["Setting", "What it means"],
			rowHeaders: true,
			rows: [
				[
					"Transferred exclusively to the Client",
					"The default. The Client becomes the sole owner of the delivered work.",
				],
				[
					"Licensed for the Client's use",
					"The maker keeps ownership and the Client receives a licence to use the work.",
				],
				[
					"Shared between Client and Freelancer",
					"Both own the work, and either may use it, including selling it on the Projective Marketplace.",
				],
				[
					"Projective partner terms",
					"The project follows Projective's partner terms, which are set out separately for each partner.",
				],
			],
		},
		{
			type: "p",
			content:
				"The project also says whether the work may be shown in a portfolio: it may be shown, it may not be shown publicly, or it may be shown after an embargo.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 (Default State: transferred upon final escrow release). */
const WHEN_IT_PASSES: LegalClause = {
	id: "when-ownership-passes",
	heading: "When ownership passes",
	tldr: "Ownership passes when the Client's escrow for the work is finally released — not before.",
	body: [
		{
			type: "p",
			content:
				"Under the default setting, intellectual property in the deliverables passes to the Client in full when the escrow for that work is finally released to the maker. Until then it stays with whoever made it.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 (the Freelancer retains the right to display the work, unless an NDA is in place). */
const PORTFOLIO: LegalClause = {
	id: "portfolio-right",
	heading: "The maker's portfolio right",
	tldr:
		"The maker may show the work in their Projective portfolio, unless the project says otherwise.",
	body: [
		{
			type: "p",
			content:
				"Even after ownership passes, the Freelancer or Team keeps the right to display the work in their Projective portfolio — unless the project's portfolio setting forbids it or sets an embargo, or a non-disclosure agreement covers the work.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 (The Shared IP Request) · 3 (The "Request to Sell" Workflow). */
const SHARED_IP: LegalClause = {
	id: "shared-ip",
	heading: "Asking to sell project work",
	tldr:
		"A maker who wants to sell something they made for a Client must ask, and the Client must agree.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"A Freelancer may ask the Client for the right to sell an asset made during the project on the Projective Marketplace.",
				"The Client must agree explicitly, and may agree for the whole asset or only for parts of it — for example, the layout but not the logo.",
				"Once agreed, ownership of what was agreed becomes shared, and the listing is linked back to the original project so its origin can be checked.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 1 (Independent Assets) · 2 (Marketplace Sourcing). */
const INDEPENDENT: LegalClause = {
	id: "independent-work",
	heading: "Work made outside a project",
	tldr: "Anything you make outside a Projective project is entirely yours.",
	body: [
		{
			type: "p",
			content:
				"An asset made entirely outside a Projective project — a template, a font, a UI kit — belongs wholly to its creator, who may sell it on the Marketplace without anyone's approval.",
		},
	],
};

/** PRODUCT_SPEC.md §Identity, Taxes & Compliance 4 (the IP Transfer Deed, the Audit Pack) · §Digital Marketplace & IP Governance 4 (Verified IP Documentation). */
const RECORD: LegalClause = {
	id: "the-record",
	heading: "The record of transfer",
	tldr:
		"Projective keeps the record of every handover. A signed deed and an audit pack for each project are on their way.",
	body: [
		{
			type: "p",
			content:
				"Projective is the system of record for ownership of project work. Its records — the timestamps, the project messages and the escrow releases — show when work was delivered, approved and paid for, and both sides can use them as evidence, including in legal proceedings elsewhere.",
		},
		{
			type: "p",
			content:
				"Projective is building a signed Deed of Transfer, issued on each escrow release and linking the exact files, the project and the people involved, and an Audit Pack that bundles a project's agreements, invoices and deeds. Both will be available in the IP workspace.",
		},
	],
};

/** PRODUCT_SPEC.md §Digital Marketplace & IP Governance 4 (On-Platform Disputes, Off-Platform Sales). */
const DISPUTES: LegalClause = {
	id: "ip-disputes",
	heading: "Disputes about ownership",
	tldr:
		"Selling project work without the Client's agreement can get a listing removed and a seller suspended. Projective cannot act off the platform.",
	body: [
		{
			type: "list",
			items: [
				"If a Freelancer lists an asset derived from a project without the Client's agreement, Projective may remove the listing and suspend the seller.",
				"Projective cannot act against a sale made on another website, but its records are available to both sides as evidence.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Age guardrails (18 and over — "signs IP transfer deeds"; a restricted account never transfers work). */
const WHO_CAN_SIGN: LegalClause = {
	id: "who-can-sign",
	heading: "Who can transfer ownership",
	tldr: "Only adults transfer ownership through Projective.",
	body: [
		{
			type: "p",
			content:
				"Only an account holder aged 18 or over can commission, deliver or transfer work under this deed. An under-18 account's personal projects have no Client, no payment and no transfer.",
		},
	],
};
// #endregion

/** The IP Transfer Deed, newest version first. */
export const IP_TRANSFER_DEED_VERSIONS = defineLegalVersions([
	{
		id: "ip-transfer-deed",
		slug: "ip-transfer-deed",
		title: "IP Transfer Deed",
		summary:
			"Who owns the work delivered through a Projective project, when ownership passes, and the record Projective keeps of it.",
		version: "1.0",
		updatedAt: "2026-10-17",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [
			PURPOSE,
			PROJECT_SETTING,
			WHEN_IT_PASSES,
			PORTFOLIO,
			SHARED_IP,
			INDEPENDENT,
			RECORD,
			DISPUTES,
			WHO_CAN_SIGN,
		],
	},
]);
