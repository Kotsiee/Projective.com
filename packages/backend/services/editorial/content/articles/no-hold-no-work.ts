import type { EditorialArticleRecord } from "@projective/types/editorial";
import { COVER_ORANGE_SUN, placeholderFigure } from "./covers.ts";

/** "No hold, no work: how escrow protects both sides" — escrow & trust. */
export const NO_HOLD_NO_WORK: EditorialArticleRecord = {
	slug: "no-hold-no-work",
	title: "No hold, no work: how escrow protects both sides",
	standfirst:
		"Escrow is what lets a stranger start work for you on Monday without an invoice, a deposit or a contract lawyer. Here is exactly when money is held, when it moves, and what each side can count on.",
	topics: ["escrow-and-trust", "value-pricing"],
	cover: COVER_ORANGE_SUN,
	authorSlug: "projective-editorial",
	status: "published",
	publishedAt: "2026-10-08T08:00:00Z",
	updatedAt: "2026-10-12T09:30:00Z",
	sections: [
		{
			id: "the-rule-in-one-line",
			heading: "The rule in one line",
			body: [
				{
					type: "p",
					content: [
						"On Projective, ",
						{ type: "strong", text: "no work starts on money that is not held" },
						". A freelancer can claim or start a ticket only once its escrow is in place. While money sits in escrow it belongs to neither side: it is held by the platform's ledger until the work is approved, refunded or split.",
					],
				},
				{
					type: "p",
					content:
						'When the hold cannot be made — the ticket has no price, the paying wallet is short, or the payer cannot cover it — the claim is refused rather than waved through, and the ticket moves to Needs funding. It leaves every freelancer\'s board until the client funds it. The client is told why and how much; the freelancer is told "Funded — you can start" the moment the money is held.',
				},
			],
		},
		{
			id: "when-money-is-held",
			heading: "When money is held",
			body: [
				{
					type: "table",
					head: ["Work", "Escrow is held", "Escrow is released"],
					rows: [
						[
							"Task or one-off",
							"Up front, when the project or its first stage begins",
							"When the client approves the deliverable",
						],
						[
							"Pipeline ticket",
							"When it is claimed at the latest, or earlier if the client prepays",
							"When the client approves the ticket's work on a stage",
						],
						[
							"Session",
							"When the slot is booked",
							"24 hours after the sitting ends, unless a no-show is claimed",
						],
					],
					caption: "When escrow is held and released for each kind of work.",
					rowHeaders: true,
				},
				{
					type: "p",
					content:
						"A client may prepay a ticket, or a whole stage, before anyone claims it, from their wallet or by card. That money is held at once with nobody yet to receive it; the claim names the payee without charging again. A prepaid ticket nobody ever claims is never paid out to anyone: if its stage is approved or cancelled, it is refunded in full.",
				},
			],
		},
		{
			id: "when-money-moves",
			heading: "When money moves",
			body: [
				{
					type: "p",
					content:
						"Approval is the release. Accepting a submission completes the ticket and pays its escrow to the freelancer, less the 5% service fee; approving a stage pays out whatever is still held on it and closes it. Because a release is final, the product asks for one confirmation before it happens.",
				},
				{
					type: "p",
					content:
						"On a pipeline, approval also moves the ticket to its next stage. With Fund on arrival on, the next stage's escrow is held straight away from the paying wallet's current balance; if it cannot be, the approved stage is still paid and the ticket waits as Needs funding.",
				},
				{
					type: "image",
					src: placeholderFigure("Escrow timeline"),
					alt:
						"Placeholder for a timeline showing escrow held at the start of a stage, released at approval and then pending for seven days",
					w: 1200,
					h: 675,
					caption: "From hold to release to available: one stage's money over time.",
				},
			],
		},
		{
			id: "the-seven-day-window",
			heading: "The seven-day window",
			body: [
				{
					type: "p",
					content:
						"Money a freelancer earns — a released escrow, a team's shares, a session payout — shows as Pending for seven days before it becomes Available to withdraw or spend. The window is a safety margin: it gives the platform time to deal with a payment that goes wrong, such as a card the payer's bank later disputes, before earnings leave the platform. A lost card dispute is recovered from the payer's wallet first.",
				},
				{
					type: "p",
					content:
						"Money you put in yourself is never held up. A top-up or card payment, a refund, a transfer and a returned payout are Available at once, so paying by card never delays work.",
				},
			],
		},
		{
			id: "payable-before-you-earn",
			heading: "Payable before you earn",
			body: [
				{
					type: "p",
					content:
						"The other half of the rule protects against a quieter failure: money that can never be paid out. A freelancer must have their identity checked and a payout account verified before they can apply for paid work, accept it, claim a ticket or join a team. A team is seated only when everyone with a share of its earnings is ready to be paid.",
				},
				{
					type: "quote",
					content:
						"Because every earner is payable before any work is accepted, money can never be stuck in an escrow nobody is able to receive.",
				},
				{
					type: "p",
					content:
						"Clients, by contrast, need no verification to buy: an individual pays by card, and the wallet that records the payment is opened for them automatically.",
				},
			],
		},
		{
			id: "what-each-side-can-count-on",
			heading: "What each side can count on",
			body: [
				{ type: "h3", text: "If you are the client" },
				{
					type: "list",
					items: [
						"No money leaves escrow until you approve, or a stage is ended under terms you can see.",
						"A claim that is parked and never started expires, and its escrow comes back to you in full.",
						"A card payment you make is credited at once, so funding a stage never waits on the seven-day window.",
					],
				},
				{ type: "h3", text: "If you are the freelancer" },
				{
					type: "list",
					items: [
						"You never start on unfunded work: the claim itself fails if the money is not there.",
						"Once you are working a ticket, the client cannot drag it to another stage under you.",
						"If you are removed from a stage mid-ticket, or a ticket you hold is deleted, its escrow is released to you in full.",
					],
				},
				{
					type: "p",
					content: [
						"Sometimes a stage should stop before it is finished. ",
						{
							type: "link",
							href: "/articles/ending-a-stage-early-fairly",
							text: "Ending a stage early, fairly",
						},
						" covers what happens to the money then.",
					],
				},
			],
		},
	],
};
