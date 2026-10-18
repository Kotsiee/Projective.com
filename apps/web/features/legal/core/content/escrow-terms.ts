/**
 * Escrow Terms — every version, newest first (Decision #270).
 *
 * DRAFT TEXT pending legal review (owner ruling (e)). Each clause restates what the escrow engine
 * does today; the JSDoc above it names the PRODUCT_SPEC section, the `finance-model.md` section and
 * the decision it comes from. Figures are the seeded platform parameters
 * (`supabase/migrations/00005001_seed_platform_params.sql`): `platform_fee_bp` 500,
 * `pending_release_days` 7, `session_payout_hours` 24, `session_cancel_notice_hours` 24,
 * `dispute_response_hours` 48.
 *
 * Version 1.0 is the baseline the engine stood at on 1 August 2026; 2.0 folds in the October 2026
 * rulings: the 7-day pending window (#191), the pipeline Chain Reaction (#210), per-sitting session
 * settlement (#211), the dispute timetable (#212) and the Fair Exit tier choice (#198).
 *
 * @module
 */
import { defineLegalVersions, type LegalClause } from "./define.ts";

// #region Shared clauses
/** PRODUCT_SPEC.md §Escrow, Wallets & Finance (intro, #2 "Escrow is a Locked state") · Decision #125 (ledger of record). */
const WHAT_ESCROW_IS: LegalClause = {
	id: "what-escrow-is",
	heading: "What escrow means on Projective",
	tldr:
		"Money in escrow belongs to neither side. Projective holds it on its ledger until the work it pays for is approved or the agreement ends.",
	body: [
		{
			type: "p",
			content:
				"Escrow is money set aside for a specific piece of work. While it is held, it belongs to neither the Client nor the Freelancer: Projective holds it on its own ledger, and releases it only under these terms.",
		},
		{
			type: "p",
			content:
				"Projective is the ledger of record for every wallet, escrow and release. Stripe processes card payments and payouts; it does not decide when escrow is released.",
		},
		{
			type: "dl",
			items: [
				{
					term: "Payer",
					definition:
						"Whoever funds the escrow: the Client, or the Business the work is billed to.",
				},
				{
					term: "Payee",
					definition: "Whoever the escrow is released to: the Freelancer or Team doing the work.",
				},
				{
					term: "Release",
					definition: "Paying held escrow to the payee, less the platform fee.",
				},
				{
					term: "Refund",
					definition: "Returning held escrow to the payer's wallet, with no fee.",
				},
			],
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #2 ("No hold, no work", Decision #165) · PRODUCT_MANAGEMENT.md §3.6. */
const NO_HOLD_NO_WORK: LegalClause = {
	id: "no-hold-no-work",
	heading: "No hold, no work",
	tldr:
		"Nobody starts work on money that is not held. If the money cannot be held, the work waits.",
	body: [
		{
			type: "p",
			content:
				"A Freelancer may claim or start a ticket only once its escrow is held. If the escrow cannot be held when it falls due — there is no price, no wallet in the project's currency, or the payer cannot cover it — the claim is refused and the ticket waits as Needs funding until the payer funds it.",
		},
		{
			type: "p",
			content:
				"The payer is told when a hold is refused, with the reason and the amount. The payee is told as soon as the escrow is held.",
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #2 (lock triggers) · §Escrow Lifecycle for Tickets · Decision #197 (prepaying). */
const WHEN_ESCROW_LOCKS: LegalClause = {
	id: "when-escrow-locks",
	heading: "When money is locked",
	tldr:
		"When escrow is locked depends on the kind of work: up front for a one-off, at the claim for a pipeline, at booking for a session.",
	body: [
		{
			type: "table",
			caption: "When escrow is locked",
			head: ["Kind of work", "Escrow is locked"],
			rowHeaders: true,
			rows: [
				["One-off project or Task", "Up front, when the project or its first stage begins."],
				[
					"Pipeline",
					"When a Freelancer claims the ticket at the latest — or earlier, when the Client prepays the ticket or its whole stage.",
				],
				["Session", "When the booking is confirmed at checkout."],
			],
		},
	],
};

/** PRODUCT_SPEC.md §Ticket Lifecycle — Deletion Protocol · Freelancer Removal Mid-Ticket. */
const REMOVAL: LegalClause = {
	id: "removal-and-deletion",
	heading: "Removing a Freelancer or deleting a ticket",
	tldr:
		"If a Freelancer is removed, or a ticket they claimed is deleted, the escrow already held for that work is paid to them in full.",
	body: [
		{
			type: "list",
			items: [
				"Deleting a ticket nobody has claimed moves no money: no escrow is held for it yet.",
				"Deleting a ticket after it was claimed releases its held escrow to the Freelancer in full, and the payer is charged nothing more.",
				"Removing a Freelancer from a stage or project while they hold a claimed ticket releases that ticket's escrow to them in full, and the ticket goes back to New for someone else to claim.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 (card payments kept, Decision #200; chargebacks, Decision #126). */
const REFUNDS: LegalClause = {
	id: "refunds-and-chargebacks",
	heading: "Refunds and card disputes",
	tldr:
		"Refunds go back to the payer's wallet. A card payment that arrives is always kept, even if what it was for can no longer happen.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"A refund returns held escrow to the payer's wallet. No platform fee is charged on a refund.",
				"A card payment that arrives is always kept. If what it was for can no longer be completed — a price changed, or the stage moved on — the money stays in the payer's wallet and the payer is told so.",
				"If a payer's bank wins a card dispute, the escrow that card payment funded (if still held) is refunded to the payer's wallet, and the disputed amount is then taken back from that wallet.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 (Business wallets; a short pool is refused — Decision #230 (c); one spend gate — Decision #240). */
const BUSINESS: LegalClause = {
	id: "business-wallets",
	heading: "Paying as a Business",
	tldr:
		"A Business pays only from its own wallet or its own card, within the limits its owner sets. A shortfall is never made up from a person.",
	body: [
		{
			type: "list",
			items: [
				"A Business pays only from its wallet, or with a card saved to the Business by a member with billing rights. A personal card cannot pay for a Business purchase.",
				"When the Business wallet holds less than a payment needs, the payment is refused. Members who may add money are offered a way to contribute; no personal card is charged.",
				"Every payment from a Business wallet checks its business verification, the acting member's spending limit and the approval threshold, and counts against that member once.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 (money leaves only to a verified payout account — Decision #202) · finance-model.md §13. */
const WITHDRAWALS: LegalClause = {
	id: "withdrawals",
	heading: "Withdrawing your money",
	tldr: "Money leaves Projective only to your own verified payout account.",
	body: [
		{
			type: "p",
			content:
				"You can withdraw available money to a Stripe payout account on file in your name. Each currency has a minimum withdrawal of about £10. Your wallet is debited when the withdrawal starts and credited back if Stripe refuses it.",
		},
	],
};
// #endregion

// #region Version 2.0 clauses
/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #2 (release triggers; the Chain Reaction — Decision #210; per-sitting sessions — Decision #211). */
const RELEASE_V2: LegalClause = {
	id: "release",
	heading: "When money is released",
	tldr:
		"Escrow is released when the Client approves the work, or 24 hours after a session sitting ends unless a no-show is claimed.",
	body: [
		{
			type: "table",
			caption: "When escrow is released",
			head: ["Kind of work", "Escrow is released"],
			rowHeaders: true,
			rows: [
				["One-off project or Task", "When the Client approves the final deliverable."],
				[
					"Pipeline",
					"When the Client approves the ticket's work on a stage. The ticket then moves to its next required stage.",
				],
				[
					"Session",
					"24 hours after each sitting ends, unless a no-show is claimed for that sitting.",
				],
			],
		},
		{ type: "h3", text: "The Chain Reaction" },
		{
			type: "p",
			content:
				"When a pipeline ticket arrives at its next stage and that stage has Fund on arrival switched on (the default), its escrow is held at once from the paying wallet's current balance. If it cannot be held, the approval still stands and the earned stage is still paid; the ticket waits in the next stage as Needs funding.",
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 · finance-model.md §1.1 / §16.4 · Decision #198 (fee on the earned share only). */
const FEES_V2: LegalClause = {
	id: "fees",
	heading: "The platform fee",
	tldr: "Projective keeps 5% of every release, taken from the payee when the money is released.",
	body: [
		{
			type: "list",
			items: [
				"The platform fee is 5% of each release, deducted from the payee at the moment of release. A rate agreed in writing with Projective may replace it for a particular payer.",
				"Card processing costs are passed through at cost.",
				"No fee is charged on a refund, and on a Fair Exit the fee is charged only on the share the payee earns.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #5 (the 7-day safety window) · Decision #191 · `pending_release_days` (7). */
const PENDING_WINDOW: LegalClause = {
	id: "pending-window",
	heading: "The 7-day pending window",
	tldr:
		"Money you earn is Pending for 7 days before you can spend or withdraw it. Money you put in yourself is available at once.",
	body: [
		{
			type: "p",
			content:
				"Earned money shows as Pending for 7 days and then becomes Available. Until then it can be neither withdrawn nor spent on Projective. This applies to:",
		},
		{
			type: "list",
			items: [
				"a released escrow, including a Team's member shares and its vault cut;",
				"a Fair Exit payout and a session payout;",
				"a product sale.",
			],
		},
		{
			type: "p",
			content:
				"A top-up or card payment you make yourself, a refund, a transfer and a returned payout are Available at once.",
		},
	],
};

/** PRODUCT_SPEC.md §Session-Based — Financial Integrity & The 24-Hour Rule (every sitting is its own transaction, Decision #211). */
const SESSIONS_V2: LegalClause = {
	id: "sessions",
	heading: "Session bookings and cancellations",
	tldr:
		"Each sitting is its own payment. Cancel more than 24 hours before a sitting for a refund; inside 24 hours it is paid to the Freelancer.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"A one-to-one booking holds one escrow for each sitting, and each sitting is settled on its own times.",
				"If the Client cancels a sitting more than 24 hours before it starts, its escrow is refunded. Inside 24 hours, it is released to the Freelancer for the time they kept free.",
				"If the Freelancer cancels, every sitting not yet started is refunded to the Client at once.",
				"A cancellation never reaches back into a sitting that has already started. Cancelling a block can therefore leave the Client partly refunded.",
				"A sitting's escrow is released 24 hours after it ends unless a no-show is claimed for it. A group seat is one payment for the whole cohort, timed from its first sitting and released after its last.",
			],
		},
	],
};

/** finance-model.md §3 (Fair Exit — 25/50/75 splits) · Decision #198 (the reviewer picks the tier from a server-computed preview). */
const FAIR_EXIT_V2: LegalClause = {
	id: "fair-exit",
	heading: "Ending a stage early (Fair Exit)",
	tldr:
		"A stage can be ended early with a Fair Exit: the Freelancer is paid 25%, 50% or 75% of what is held, and the rest goes back to the payer.",
	body: [
		{
			type: "p",
			content:
				"Whoever reviews a file-based stage may end it early from its submissions. Before confirming, they see what each of three settlement tiers would pay, and choose one:",
		},
		{
			type: "table",
			caption: "Fair Exit tiers",
			head: ["Tier", "Paid to the Freelancer", "Refunded to the payer"],
			rowHeaders: true,
			rows: [
				["25%", "25% of each held escrow, less the fee", "The remaining 75%, with no fee"],
				["50%", "50% of each held escrow, less the fee", "The remaining 50%, with no fee"],
				["75%", "75% of each held escrow, less the fee", "The remaining 25%, with no fee"],
			],
		},
		{
			type: "p",
			content:
				"A ticket that was prepaid but never claimed is refunded in full. The stage's remaining tickets close as cancelled, and both sides are told.",
		},
	],
};

/** PRODUCT_SPEC.md §Dispute Resolution (the Evidence Vault, the resolution lifecycle, no-show claims) · Decision #212 · `dispute_response_hours` (48). */
const DISPUTES_V2: LegalClause = {
	id: "disputes",
	heading: "Disputes and no-show claims",
	tldr:
		"A dispute freezes the evidence. The two sides get the first chance to settle it; if they cannot, a Projective auditor decides.",
	body: [
		{
			type: "p",
			content:
				"When a dispute is raised, Projective takes an unchangeable snapshot of the work — the board, the messages, the submitted files and the session attendance records — so nothing can be changed afterwards.",
		},
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"The two sides first try to settle it between them, for example by agreeing a partial refund. If they agree, the split is carried out at once.",
				"The other side has 48 hours to respond. If they do not, or the two cannot agree, the case goes to a Projective auditor.",
				"The auditor reviews the snapshot against the stage's requirements and may release the escrow, refund it, or split it.",
				"For a session, a no-show claim is checked against the attendance records first: if the Freelancer never joined, the sitting is refunded; if both joined for more than 80% of the time, the claim is dismissed; anything else goes to an auditor.",
			],
		},
		{
			type: "p",
			content:
				"An auditor's ruling is final on Projective. Both sides receive a summary of the dispute they can use as a record elsewhere.",
		},
	],
};
// #endregion

// #region Version 1.0 clauses
/** PRODUCT_SPEC.md §Escrow, Wallets & Finance #2 (release triggers as first written). */
const RELEASE_V1: LegalClause = {
	id: "release",
	heading: "When money is released",
	tldr: "Escrow is released when the Client approves the work, or 24 hours after a session ends.",
	body: [
		{
			type: "table",
			caption: "When escrow is released",
			head: ["Kind of work", "Escrow is released"],
			rowHeaders: true,
			rows: [
				["One-off project or Task", "When the Client approves the final deliverable."],
				["Pipeline", "When the Client approves the ticket's work on a stage."],
				["Session", "24 hours after the session ends, unless a no-show is claimed."],
			],
		},
	],
};

/** finance-model.md §1.1 (the 5% service fee as first written). */
const FEES_V1: LegalClause = {
	id: "fees",
	heading: "The platform fee",
	tldr: "Projective keeps 5% of every release, taken from the payee when the money is released.",
	body: [
		{
			type: "list",
			items: [
				"The platform fee is 5% of each release, deducted from the payee at the moment of release.",
				"Card processing costs are passed through at cost.",
				"No fee is charged on a refund.",
			],
		},
	],
};

/** PRODUCT_SPEC.md §Session-Based — The 24-Hour Rule (before per-sitting settlement). */
const SESSIONS_V1: LegalClause = {
	id: "sessions",
	heading: "Session bookings and cancellations",
	tldr:
		"Cancel more than 24 hours before a session for a refund; inside 24 hours it is paid to the Freelancer.",
	body: [
		{
			type: "list",
			ordered: true,
			marker: "lower-alpha",
			items: [
				"If the Client cancels more than 24 hours before the session, the escrow is refunded. Inside 24 hours, it is released to the Freelancer for the time they kept free.",
				"If the Freelancer cancels, the escrow is refunded to the Client at once.",
				"The escrow is released 24 hours after the session ends unless a no-show is claimed.",
			],
		},
	],
};

/** finance-model.md §3 (the duration-based split as first written). */
const FAIR_EXIT_V1: LegalClause = {
	id: "fair-exit",
	heading: "Ending a stage early (Fair Exit)",
	tldr: "A stage ended early is split by how much of its time had passed.",
	body: [
		{
			type: "table",
			caption: "Fair Exit splits",
			head: ["Time passed", "Outcome"],
			rowHeaders: true,
			rows: [
				["Less than 25% of the stage", "The payer is refunded in full."],
				["25% to 75% of the stage", "The held escrow is split 50/50."],
				["More than 75% of the stage", "The held escrow is released to the Freelancer."],
			],
		},
	],
};

/** PRODUCT_SPEC.md §Dispute Resolution (as first written). */
const DISPUTES_V1: LegalClause = {
	id: "disputes",
	heading: "Disputes and no-show claims",
	tldr: "A dispute freezes the evidence. If the two sides cannot settle it, Projective decides.",
	body: [
		{
			type: "p",
			content:
				"When a dispute is raised, Projective takes an unchangeable snapshot of the work. The two sides first try to settle it between them; if they cannot, Projective reviews the snapshot and may release the escrow, refund it, or split it.",
		},
	],
};
// #endregion

/** The Escrow Terms, newest version first. */
export const ESCROW_TERMS_VERSIONS = defineLegalVersions([
	{
		id: "escrow-terms",
		slug: "escrow-terms",
		title: "Escrow Terms",
		summary:
			"How money for work is held, released, refunded and split on Projective: lock points, the platform fee, the pending window, sessions, Fair Exit and disputes.",
		version: "2.0",
		updatedAt: "2026-10-17",
		effectiveDate: "2026-10-17",
		reviewedAt: null,
		changeSummary:
			"Adds the 7-day pending window and the Chain Reaction, settles sessions per sitting, lets the reviewer choose a Fair Exit tier, and sets the dispute timetable.",
		sections: [
			WHAT_ESCROW_IS,
			NO_HOLD_NO_WORK,
			WHEN_ESCROW_LOCKS,
			RELEASE_V2,
			FEES_V2,
			PENDING_WINDOW,
			SESSIONS_V2,
			FAIR_EXIT_V2,
			REMOVAL,
			DISPUTES_V2,
			REFUNDS,
			BUSINESS,
			WITHDRAWALS,
		],
	},
	{
		id: "escrow-terms",
		slug: "escrow-terms",
		title: "Escrow Terms",
		summary:
			"How money for work is held, released, refunded and split on Projective: lock points, the platform fee, sessions, Fair Exit and disputes.",
		version: "1.0",
		updatedAt: "2026-07-28",
		effectiveDate: "2026-08-01",
		reviewedAt: null,
		changeSummary: "First published.",
		sections: [
			WHAT_ESCROW_IS,
			NO_HOLD_NO_WORK,
			WHEN_ESCROW_LOCKS,
			RELEASE_V1,
			FEES_V1,
			SESSIONS_V1,
			FAIR_EXIT_V1,
			REMOVAL,
			DISPUTES_V1,
			REFUNDS,
			BUSINESS,
			WITHDRAWALS,
		],
	},
]);
