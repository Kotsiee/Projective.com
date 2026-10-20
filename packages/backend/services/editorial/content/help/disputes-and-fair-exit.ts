import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `disputes-and-fair-exit` category's articles, in reading order. */

/**
 * Fair Exit. Grounded in Decision #198 (End Stage (Fair Exit) in the Submissions explorer, the
 * server-computed 25 · 50 · 75 % preview, the fee on the earned share only, remaining tickets
 * cancelled, both sides told) and finance-model.md §3. Read from the code: the tier is CHOSEN by the
 * reviewer (`FairExitDialog`, opening on 50 %); finance-model §3's automatic duration thresholds are
 * not wired, so this article does not promise them.
 */
const endAStageWithFairExit = helpArticle({
	slug: "end-a-stage-with-fair-exit",
	category: "disputes-and-fair-exit",
	position: 0,
	title: "End a stage early with Fair Exit",
	summary:
		"Fair Exit ends a stage that can't be finished: you choose to pay the freelancer 25%, 50% or 75% of the money held, see the exact split before you confirm, and the rest comes back to you.",
	roles: ["client", "business", "freelancer"],
	startHere: ["client"],
	faq: { rank: 6, question: "What if I need to end a stage early?" },
	related: ["how-disputes-are-decided", "approve-a-stage", "fees"],
	sections: [
		{
			id: "when-to-use-it",
			heading: "When to use it",
			body: [
				{
					type: "p",
					content:
						"Sometimes a stage can't be finished — plans change, or the work and the brief have drifted too far apart. Fair Exit closes the stage and divides the money held for it so that the time already put in is paid and the rest is returned.",
				},
				{
					type: "p",
					content:
						"Whoever reviews the project's work (the owner, or someone on the client side with that permission) can end a stage. A freelancer who wants to stop should talk to the client first, or contact support.",
				},
			],
		},
		{
			id: "how-it-works",
			heading: "How it works",
			body: [
				{
					type: "list",
					ordered: true,
					items: [
						"In the stage's Submissions view, choose End Stage (Fair Exit).",
						"Pick how much of the held money the freelancer earned: 25%, 50% or 75%.",
						"Read the preview: what is paid to the freelancer, the platform fee on that share, and what is refunded to you.",
						"Confirm. It can't be undone.",
					],
				},
				{
					type: "image",
					src: "https://placehold.co/1200x675?text=Fair+Exit+preview",
					alt:
						"The Fair Exit dialog with 25, 50 and 75 percent options and the amounts paid to the freelancer, kept as a fee and refunded to the client.",
					w: 1200,
					h: 675,
					caption: "Every figure in the preview is exactly what will move.",
				},
			],
		},
		{
			id: "what-happens-next",
			heading: "What happens next",
			body: [
				{
					type: "list",
					items: [
						"The 5% fee is charged only on the freelancer's share; your refund comes back without a fee.",
						"Money you prepaid for tickets nobody claimed comes back to you whole.",
						"The stage's remaining tickets close as cancelled, and both sides are told what moved.",
						"For a team, the freelancer's share is split between members by their agreement.",
					],
				},
				{
					type: "p",
					content:
						"A stage that is already settled, or that has no money held, can't be ended this way; the dialog says so.",
				},
			],
		},
	],
});

/**
 * Session cancellations. Grounded in PRODUCT_SPEC §Session-Based C (the 24-hour rule; freelancer
 * cancels → full refund) and §D (the 72-hour scheduling handshake), refined per sitting by Decision
 * #211. finance-model.md §4's 50% late-cancel fee is retired; PRODUCT_SPEC's full forfeit is current.
 */
const sessionCancellations = helpArticle({
	slug: "session-cancellations",
	category: "disputes-and-fair-exit",
	position: 1,
	title: "Cancelling a session: the 24-hour rule",
	summary:
		"Cancel more than 24 hours before a session and you're refunded in full; cancel later and the payment goes to the freelancer for the time they kept free. If the freelancer cancels, you're always refunded.",
	roles: ["client", "freelancer"],
	related: ["report-a-session-no-show", "what-is-escrow", "the-7-day-pending-window"],
	sections: [
		{
			id: "the-rule",
			heading: "The rule",
			body: [
				{
					type: "table",
					head: ["What happens", "When", "The money"],
					rowHeaders: true,
					rows: [
						["You cancel", "More than 24 hours before", "Refunded to you in full."],
						["You cancel", "Less than 24 hours before", "Paid to the freelancer."],
						["The freelancer cancels", "Any time", "Refunded to you in full, at once."],
						[
							"The session happens",
							"—",
							"Paid to the freelancer 24 hours after it ends, unless a no-show is reported.",
						],
					],
				},
			],
		},
		{
			id: "blocks-of-sessions",
			heading: "Blocks of sessions",
			body: [
				{
					type: "p",
					content:
						"A block of one-to-one sessions holds a separate payment for each sitting, and the rule applies to each one on its own. Cancelling a block can therefore refund the sittings more than 24 hours away while paying for those inside the window. A sitting that has already started is never pulled back into a cancellation.",
				},
				{
					type: "p",
					content:
						"When you buy a block you pick the first time; the rest are pencilled in a week apart. The freelancer proposes times that suit you both, and each pencilled-in time should be agreed within 72 hours of paying. If it isn't, the pencilled-in time stands.",
				},
				{
					type: "p",
					content:
						"A seat in a group session is one payment for the whole course, timed from its first sitting and paid out after its last.",
				},
			],
		},
	],
});

/**
 * No-show claims. Grounded in PRODUCT_SPEC §Dispute Resolution → 3. Session-Specific Disputes and
 * Decision #212 (the attendance audit: provider never joined → refund; both present ≥ 80% → dismissed;
 * otherwise a 48-hour response, then an auditor). Labels read from `SessionDisputes` (No-show claims ·
 * Report no-show · View case) and `core/dispute-view.ts`.
 */
const reportASessionNoShow = helpArticle({
	slug: "report-a-session-no-show",
	category: "disputes-and-fair-exit",
	position: 2,
	title: "Report a session no-show",
	summary:
		"If the freelancer didn't turn up, report a no-show from the session's sidebar; the sitting's payment stays held while the claim is decided.",
	roles: ["client"],
	related: ["how-disputes-are-decided", "session-cancellations", "what-is-escrow"],
	sections: [
		{
			id: "report-it",
			heading: "Report it",
			body: [
				{
					type: "p",
					content: [
						"Open the session's project. Under ",
						{ type: "strong", text: "No-show claims" },
						" in its sidebar, choose Report no-show on the sitting, add a short reason if you like, and confirm. Only an attendee can report a no-show.",
					],
				},
				{
					type: "p",
					content:
						"The sitting's payment is held from that moment, so it can't be paid out automatically while the claim is open.",
				},
			],
		},
		{
			id: "how-it-is-decided",
			heading: "How it is decided",
			body: [
				{
					type: "p",
					content: "When the sitting ends, its room's attendance log is checked:",
				},
				{
					type: "list",
					items: [
						"The freelancer never joined — you are refunded at once.",
						"You and the freelancer were both in the room for at least 80% of the session — the claim is dismissed and the freelancer is paid.",
						"Anything else, including a meeting link that isn't tracked — the freelancer is asked to respond within 48 hours, and then a Projective auditor decides.",
					],
				},
				{
					type: "p",
					content: [
						"You can follow the claim with View case. ",
						{
							type: "link",
							href: "/help/disputes-and-fair-exit/how-disputes-are-decided",
							text: "Here's what each stage of a case means",
						},
						".",
					],
				},
			],
		},
	],
});

/**
 * The dispute lifecycle. Grounded in Decision #212 (open → awaiting_response → under_review →
 * resolved; the 48-hour respond-or-escalate deadline; statements and evidence append-only; an operator
 * rules) and PRODUCT_MANAGEMENT §3.8. Read from the code: disputes are wired for session sittings only
 * (`projects.claim_session_no_show`, `finance.*_dispute`); deliverable stages end through Fair Exit,
 * so the article says so rather than describing the spec's unbuilt refund-offer tool.
 */
const howDisputesAreDecided = helpArticle({
	slug: "how-disputes-are-decided",
	category: "disputes-and-fair-exit",
	position: 3,
	title: "How a dispute is decided",
	summary:
		"A dispute moves from Claim open to Awaiting response to Under review, and ends Released, Refunded or Split; both sides can file statements and evidence, nothing in a case can be edited or deleted, and an auditor's ruling is final on Projective.",
	roles: ["client", "freelancer", "team"],
	related: ["report-a-session-no-show", "end-a-stage-with-fair-exit", "session-cancellations"],
	sections: [
		{
			id: "the-stages-of-a-case",
			heading: "The stages of a case",
			body: [
				{
					type: "dl",
					items: [
						{
							term: "Claim open",
							definition:
								"The claim is filed and the payment is held. The room's attendance is checked when the session ends.",
						},
						{
							term: "Awaiting response",
							definition:
								"The logs didn't settle it. The freelancer has 48 hours to give their account and any evidence.",
						},
						{
							term: "Under review",
							definition:
								"A Projective auditor is reviewing everything. The payment stays held until they rule.",
						},
						{
							term: "Released · Refunded · Split",
							definition:
								"The ruling: the payment goes to the freelancer, back to the client, or is divided between you.",
						},
					],
				},
			],
		},
		{
			id: "evidence",
			heading: "Statements and evidence",
			body: [
				{
					type: "p",
					content:
						"While a case is live, both sides can write a statement and attach files from the case. Statements and files are kept exactly as filed: nobody can edit or delete them, and a file filed as evidence can't be removed from your library while the case is open. Either side can send a case waiting for a response to an auditor straight away rather than wait for the 48 hours.",
				},
			],
		},
		{
			id: "deliverable-work",
			heading: "Disagreements about deliverable work",
			body: [
				{
					type: "p",
					content: [
						"Formal cases cover session attendance today. For a stage of deliverable work, talk it through in the stage's discussion first; if it can't be finished, the client can end it with ",
						{
							type: "link",
							href: "/help/disputes-and-fair-exit/end-a-stage-with-fair-exit",
							text: "Fair Exit",
						},
						". If you can't agree, contact support and tell us the project and stage.",
					],
				},
			],
		},
	],
});

/** Every `disputes-and-fair-exit` article. */
export const DISPUTES_AND_FAIR_EXIT_ARTICLES: readonly HelpCentreArticle[] = [
	endAStageWithFairExit,
	sessionCancellations,
	reportASessionNoShow,
	howDisputesAreDecided,
];
