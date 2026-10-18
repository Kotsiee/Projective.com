import type { EditorialArticleRecord } from "@projective/types/editorial";
import { COVER_IN_MOTION } from "./covers.ts";

/** "Ending a stage early, fairly" — escrow & trust. */
export const ENDING_A_STAGE_EARLY_FAIRLY: EditorialArticleRecord = {
	slug: "ending-a-stage-early-fairly",
	title: "Ending a stage early, fairly",
	standfirst:
		"Not every stage should be finished. Priorities change, briefs turn out to be wrong, people get ill. A Fair Exit lets a client end a stage in the open, with a split both sides can see before anyone commits to it.",
	topics: ["escrow-and-trust", "agile-delivery"],
	cover: COVER_IN_MOTION,
	authorSlug: "projective-editorial",
	status: "published",
	publishedAt: "2026-10-14T08:00:00Z",
	updatedAt: "2026-10-14T08:00:00Z",
	sections: [
		{
			id: "stopping-is-normal",
			heading: "Stopping is normal",
			body: [
				{
					type: "p",
					content:
						"Projects change shape. A client discovers halfway through a design stage that the product is being renamed; a pilot is cancelled; a freelancer's circumstances change. None of this is anyone's fault, and treating every early ending as a dispute poisons a working relationship that might otherwise continue on the next stage.",
				},
				{
					type: "p",
					content:
						"What makes an early ending fair is not the exact split. It is that the split is chosen in the open, from options both sides can see, and that the money moves the moment it is chosen — no invoices to chase, no refund requests to argue over.",
				},
			],
		},
		{
			id: "the-three-tiers",
			heading: "The three tiers",
			body: [
				{
					type: "p",
					content: [
						"The person reviewing a stage can end it from the stage's Submissions with ",
						{ type: "strong", text: "End Stage (Fair Exit)" },
						". Before confirming, they see a preview of all three settlement tiers, computed by the same server rule that will carry it out, so the figures shown are the figures paid.",
					],
				},
				{
					type: "table",
					head: ["Tier", "Paid to the freelancer", "Returned to the client"],
					rows: [
						[
							"25%",
							"A quarter of each held escrow, less the 5% fee on that share",
							"The other three quarters, fee-free",
						],
						[
							"50%",
							"Half of each held escrow, less the 5% fee on that share",
							"The other half, fee-free",
						],
						[
							"75%",
							"Three quarters of each held escrow, less the 5% fee on that share",
							"The remaining quarter, fee-free",
						],
					],
					caption: "What each Fair Exit tier does to the money held on the stage.",
					rowHeaders: true,
				},
				{
					type: "callout",
					tone: "note",
					title: "A worked example",
					body: [
						{
							type: "p",
							content:
								"A stage holds £1,000 and is ended at the 50% tier. The freelancer's earned share is £500; the 5% fee on it is £25, so £475 reaches them. The client is refunded £500 in full — the fee is only ever charged on the share that was earned.",
						},
					],
				},
				{
					type: "p",
					content:
						"A team's share is split by its own stored rule, exactly as a normal release would be. A ticket that was prepaid but never claimed comes back to the client whole, because nobody earned any of it. The stage's remaining tickets close as cancelled, and both sides are told.",
				},
			],
		},
		{
			id: "choosing-a-tier-honestly",
			heading: "Choosing a tier honestly",
			body: [
				{
					type: "p",
					content:
						"The tier is the reviewer's choice, which makes it a judgement, not a formula. A few questions make it a fair one:",
				},
				{
					type: "list",
					items: [
						"How far did the work get? Count delivered drafts and checked-off checklist items, not hours.",
						"What can you keep using? Drafts and files you will build on are value received.",
						"Whose change of plan was it? An ending caused by the client's change of direction deserves a more generous tier.",
						"What did the stage cost the freelancer in time they could have sold elsewhere?",
					],
				},
				{
					type: "p",
					content:
						"Say which tier you intend in the stage's room before you confirm it. The preview makes the numbers transparent; a sentence of reasoning makes the decision feel like a conversation rather than a verdict.",
				},
			],
		},
		{
			id: "other-ways-work-ends",
			heading: "Other ways work ends",
			body: [
				{
					type: "p",
					content:
						"A Fair Exit is the deliberate ending. The platform has fixed rules for the others:",
				},
				{
					type: "dl",
					items: [
						{
							term: "A parked claim",
							definition:
								"A ticket claimed but never started expires after its time limit (24 hours by default). It returns to the backlog, any escrow held is refunded to the client in full, and the freelancer is paid nothing.",
						},
						{
							term: "Removal mid-ticket",
							definition:
								"If a freelancer is removed from a stage while holding a claimed ticket, that ticket's escrow is released to them in full and the ticket returns to the backlog for someone else.",
						},
						{
							term: "A deleted ticket",
							definition:
								"Deleting a ticket before it is claimed pays nobody; if the client prepaid it, the escrow comes back to them in full. Deleting one after it is claimed releases its escrow to the freelancer in full.",
						},
						{
							term: "A cancelled session",
							definition:
								"Cancelled by the client more than 24 hours ahead: refunded. Inside 24 hours: paid to the freelancer for the time they reserved. Cancelled by the freelancer: refunded in full, at any time.",
						},
					],
				},
			],
		},
		{
			id: "when-you-disagree",
			heading: "When you disagree",
			body: [
				{
					type: "p",
					content:
						"For a session, disagreement has a defined path. An attendee who reports a no-show opens a dispute, and the sitting's payment stays held while it runs. The conferencing logs are checked first: if the provider never joined, the attendee is refunded; if both were present for most of the session, the claim is dismissed. When the logs cannot settle it, the provider has 48 hours to respond before the case goes to a Projective reviewer, who can release the payment, refund it or split it.",
				},
				{
					type: "quote",
					content:
						"A dispute is never deleted, and a ruling is final: the record of what happened stays with the work.",
				},
				{
					type: "p",
					content:
						"For a deliverable stage, the honest first step is the stage's own room. Most disagreements about a stage are disagreements about its checklist, and most of those end in a revision or a Fair Exit both sides can live with.",
				},
			],
		},
		{
			id: "ending-well",
			heading: "Ending well",
			body: [
				{
					type: "list",
					ordered: true,
					items: [
						"Decide early. A stage ended at a quarter of the way through costs everyone less than one ended at the deadline.",
						"Explain the tier in the stage's room before you confirm it.",
						"Agree in writing what happens to the drafts already delivered.",
						"If the relationship is sound, say so — the next stage can start the same day.",
					],
				},
				{
					type: "p",
					content: [
						"Ending a stage fairly depends on the money having been held properly from the start. ",
						{ type: "link", href: "/articles/no-hold-no-work", text: "No hold, no work" },
						" explains how.",
					],
				},
			],
		},
	],
};
