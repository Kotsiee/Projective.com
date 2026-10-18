import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `revisions-and-approvals` category's articles, in reading order. */

/**
 * Submitting work. Grounded in PRODUCT_SPEC §Features → Deliverable-Based workflow (Submission,
 * Review, Resolution). Labels read from the code: `SubmissionActionBar` (Create New Submission ·
 * Upload Files · Submit for Review; In Review · Approved · Revision Requested) and `PreSubmitModal`
 * (Confirm & Submit to Client).
 */
const submitWorkForReview = helpArticle({
	slug: "submit-work-for-review",
	category: "revisions-and-approvals",
	position: 0,
	title: "Submitting work for review",
	summary:
		"Create a submission on the stage, add your files, and send it to the client with Submit for Review; it stays In Review until the client accepts it or asks for a revision.",
	roles: ["freelancer", "team"],
	startHere: ["freelancer"],
	related: ["accept-and-release-payment", "free-and-paid-revisions", "the-7-day-pending-window"],
	sections: [
		{
			id: "make-a-submission",
			heading: "Make a submission",
			body: [
				{
					type: "list",
					ordered: true,
					items: [
						"Open the stage's Submissions view and choose Create New Submission.",
						"Upload the files that prove the work, or add them from your files. Some stages only need a screenshot or a short note rather than finished files.",
						"Choose Submit for Review, check what you are sending, then Confirm & Submit to Client.",
					],
				},
				{
					type: "image",
					src: "https://placehold.co/1200x675?text=Submit+for+review",
					alt:
						"The submit-for-review confirmation listing the files about to be sent to the client.",
					w: 1200,
					h: 675,
				},
			],
		},
		{
			id: "after-you-submit",
			heading: "After you submit",
			body: [
				{
					type: "dl",
					items: [
						{
							term: "In Review",
							definition: "The client has it. Nothing more is needed from you yet.",
						},
						{
							term: "Revision Requested",
							definition:
								"The client asked for changes. The ticket comes back to you with their notes; submit again when it is ready.",
						},
						{
							term: "Approved",
							definition:
								"The client accepted it and the ticket's payment was released to you. It clears the 7-day pending window, then you can withdraw it.",
						},
					],
				},
			],
		},
	],
});

/**
 * Accepting work. Grounded in Decision #194 (accepting a submission releases that ticket's escrow at
 * once) and Decision #213 (E) (the confirmation before it fires); PRODUCT_SPEC §Features → Resolution.
 * Labels read from `SubmissionReviewModal` (Accept & release payment → Accept & release · Not yet).
 */
const acceptAndReleasePayment = helpArticle({
	slug: "accept-and-release-payment",
	category: "revisions-and-approvals",
	position: 1,
	title: "Accept & release payment",
	summary:
		"When you accept a submission, that ticket's escrow is released to the freelancer straight away, less the 5% service fee — so Projective asks you to confirm first, because it can't be undone.",
	roles: ["client", "business"],
	startHere: ["client"],
	faq: { rank: 4, question: "When does the freelancer get paid?" },
	related: ["approve-a-stage", "free-and-paid-revisions", "fees"],
	sections: [
		{
			id: "accepting",
			heading: "Accepting a submission",
			body: [
				{
					type: "p",
					content: [
						"Open the submission and review the work against the stage's checklist. If it is done, choose ",
						{ type: "strong", text: "Accept & release payment" },
						". A short confirmation explains that accepting releases this ticket's escrow to the freelancer now; choose Accept & release to go ahead, or Not yet to keep reviewing.",
					],
				},
				{
					type: "p",
					content:
						"The ticket completes and the money goes to the freelancer — or, for a team, is split between its members by their agreement.",
				},
			],
		},
		{
			id: "not-ready",
			heading: "If it isn't ready",
			body: [
				{
					type: "p",
					content: [
						"Choose Request revision instead and say what needs to change. The ticket goes back to the freelancer and no money moves. ",
						{
							type: "link",
							href: "/help/revisions-and-approvals/free-and-paid-revisions",
							text: "How many revisions you get",
						},
						" depends on the service you bought.",
					],
				},
			],
		},
		{
			id: "for-the-freelancer",
			heading: "What the freelancer sees",
			body: [
				{
					type: "p",
					content:
						"The freelancer is told the work was accepted. Their earnings show as Pending for 7 days and then become Available to withdraw.",
				},
			],
		},
	],
});

/**
 * Approving a stage. Grounded in Decision #194 (approve_stage pays out whatever is still held and
 * closes the stage), Decision #213 (a stage nobody was hired on is refused; an unclaimed prepaid
 * ticket is refunded and left open) and Decision #210 (the Chain Reaction on Pipelines). Dialog title
 * read from `ApproveStageDialog` ("Approve stage and release payment?").
 */
const approveAStage = helpArticle({
	slug: "approve-a-stage",
	category: "revisions-and-approvals",
	position: 2,
	title: "Approving a stage",
	summary:
		"Approve Stage pays out any money still held on the stage and closes it; prepaid tickets nobody claimed are refunded to you, and a stage nobody was hired on can't be approved.",
	roles: ["client", "business"],
	related: ["accept-and-release-payment", "needs-funding", "end-a-stage-with-fair-exit"],
	sections: [
		{
			id: "what-it-does",
			heading: "What Approve Stage does",
			body: [
				{
					type: "p",
					content:
						"Once a stage's work is accepted, Approve Stage settles it: any escrow still held for the people hired on it is released to them, and the stage closes. If every ticket was already paid when you accepted it, approving simply closes the stage.",
				},
				{
					type: "p",
					content:
						"It always asks first — “Approve stage and release payment?” — because the money it releases can't come back.",
				},
			],
		},
		{
			id: "edge-cases",
			heading: "Unclaimed tickets and empty stages",
			body: [
				{
					type: "list",
					items: [
						"A ticket you prepaid that nobody claimed is refunded to you in full and stays open, rather than being marked done.",
						"A stage nobody was ever hired on can't be approved — there is no one to pay. Its prepaid money waits for a freelancer to claim a ticket.",
					],
				},
			],
		},
		{
			id: "pipelines",
			heading: "On a Pipeline",
			body: [
				{
					type: "p",
					content: [
						"Approving a Pipeline ticket's work on one stage moves it to its next stage, and — with Fund on arrival on — holds that stage's money from your wallet straight away. If the wallet is short, the ticket waits as ",
						{
							type: "link",
							href: "/help/escrow-and-payments/needs-funding",
							text: "Needs funding",
						},
						"; the stage you approved is still paid.",
					],
				},
			],
		},
	],
});

/**
 * Revisions. Grounded in PRODUCT_SPEC §Purchase Methods → Paid revisions (Decision #167: the stage's
 * frozen allotment, owner-authored stages unlimited by default, a bought round does not consume the
 * allotment) and Decision #199 (paying from the review: Pay from wallet · Pay by card · Add to basket;
 * Available balance only).
 */
const freeAndPaidRevisions = helpArticle({
	slug: "free-and-paid-revisions",
	category: "revisions-and-approvals",
	position: 3,
	title: "Free and paid revisions",
	summary:
		"A stage bought from a service comes with the free revision rounds its listing promised; after those, you can buy one extra round at a time at the listing's price, and the work goes back only once that round is paid.",
	roles: ["client", "freelancer", "business"],
	faq: { rank: 5, question: "How many revisions do I get?" },
	related: ["accept-and-release-payment", "submit-work-for-review", "fees"],
	sections: [
		{
			id: "your-allowance",
			heading: "Your free rounds",
			body: [
				{
					type: "p",
					content:
						"When a project is created from a freelancer's service, each stage copies that service's revision terms: how many free rounds you get, and what an extra round costs. Those terms are then fixed — a later price change on the listing doesn't affect what you bought.",
				},
				{
					type: "p",
					content:
						"A stage you wrote yourself, rather than bought from a listing, has unlimited free revisions. On a bought stage each round you ask for is counted, so you can see how many of your free rounds you have used.",
				},
			],
		},
		{
			id: "buying-a-round",
			heading: "Buying an extra round",
			body: [
				{
					type: "p",
					content: [
						"Once the free rounds are used, Request revision becomes ",
						{ type: "strong", text: "Buy a revision" },
						" with its price. You can pay three ways:",
					],
				},
				{
					type: "list",
					items: [
						"Pay from wallet — from your available balance (not money still clearing).",
						"Pay by card.",
						"Add to basket, to pay alongside other things.",
					],
				},
				{
					type: "p",
					content:
						"The payment is held in escrow on the ticket like any other, and released when you approve the revised work. The work goes back to the freelancer only once the round is paid, and they are told “Paid revision, funded, you can start.” A bought round doesn't use up a free one.",
				},
				{
					type: "callout",
					tone: "note",
					body: [
						{
							type: "p",
							content:
								"If the listing set the extra-round price to zero, extra rounds stay free. If it never set a price, extra rounds can't be bought and the work can't be sent back again after the free rounds.",
						},
					],
				},
			],
		},
	],
});

/** Every `revisions-and-approvals` article. */
export const REVISIONS_AND_APPROVALS_ARTICLES: readonly HelpCentreArticle[] = [
	submitWorkForReview,
	acceptAndReleasePayment,
	approveAStage,
	freeAndPaidRevisions,
];
