import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `escrow-and-payments` category's articles, in reading order. */

/**
 * What escrow is. Grounded in PRODUCT_SPEC §Escrow, Wallets & Finance #2 (Escrow Lifetimes by Project
 * Type; No hold, no work — Decision #165) and §Session-Based C (the 24-hour negative-consent release,
 * Decision #211).
 */
const whatIsEscrow = helpArticle({
	slug: "what-is-escrow",
	category: "escrow-and-payments",
	position: 0,
	title: "What escrow means on Projective",
	summary:
		"Escrow is money Projective holds for a piece of work: the client pays it in before the work starts, and it is released to the freelancer only when the work is approved — or refunded if it never happens.",
	roles: ["client", "freelancer", "team", "business"],
	faq: { rank: 1, question: "Is my money safe before the work is done?" },
	related: ["how-stage-funding-works", "accept-and-release-payment", "fees"],
	sections: [
		{
			id: "held-by-projective",
			heading: "Held by Projective, owned by neither side",
			body: [
				{
					type: "p",
					content:
						"While money is in escrow it belongs to neither the client nor the freelancer: Projective's ledger holds it against one specific ticket or session. That protects both people — the freelancer knows the money exists before they start, and the client knows it only moves when they approve the work.",
				},
			],
		},
		{
			id: "when-it-is-held",
			heading: "When money goes in, and when it comes out",
			body: [
				{
					type: "table",
					head: ["Project type", "Held", "Released"],
					rowHeaders: true,
					rows: [
						[
							"Task and One-off",
							"Up front, when the stage begins (or earlier, if the client prepays).",
							"When the client approves the work.",
						],
						[
							"Pipeline",
							"When a freelancer claims a ticket at the latest — or earlier, if the client prepays.",
							"When the client approves the ticket's work on that stage.",
						],
						[
							"Session",
							"When the booking is paid.",
							"Automatically 24 hours after the session ends, unless a no-show is reported.",
						],
					],
				},
			],
		},
		{
			id: "no-hold-no-work",
			heading: "No hold, no work",
			body: [
				{
					type: "p",
					content: [
						"A freelancer can only start a ticket whose money is already held. If it can't be held, the ticket waits as ",
						{
							type: "link",
							href: "/help/escrow-and-payments/needs-funding",
							text: "Needs funding",
						},
						" until the client pays. Nobody is ever asked to work on a promise.",
					],
				},
			],
		},
	],
});

/**
 * Funding a stage. Grounded in PRODUCT_SPEC §Escrow Lifecycle for Tickets → Prepaid escrow
 * (Decision #197), §Purchase Methods (Buy Now funds one ticket — Decision #166) and the unclaimed
 * prepaid refund on approval (Decision #213). UI read from `FundStageDialog` (`From wallet · By card`).
 */
const howStageFundingWorks = helpArticle({
	slug: "how-stage-funding-works",
	category: "escrow-and-payments",
	position: 1,
	title: "How stage funding works",
	summary:
		"You pay for a stage — or a single ticket — before the work starts, from your wallet or by card; the money is held in escrow and goes to whoever is hired to do it, or comes back to you in full if nobody does.",
	roles: ["client", "business"],
	startHere: ["client", "business"],
	faq: { rank: 2, question: "When do I pay, and for what?" },
	related: ["what-is-escrow", "needs-funding", "paying-by-card-and-currencies"],
	sections: [
		{
			id: "fund-a-stage",
			heading: "Fund a whole stage",
			body: [
				{
					type: "p",
					content: [
						"On a stage's board, a line tells you how many tickets need money to start and how much. Choose ",
						{ type: "strong", text: "Fund stage" },
						" to pay for every ticket in it that nobody has paid for yet. You can fund a stage while it is open, assigned or already in progress.",
					],
				},
				{
					type: "image",
					src: "https://placehold.co/1200x675?text=Fund+stage+dialog",
					alt:
						"The Fund stage dialog: the stage name, the total to hold, the number of tickets, and a choice between paying from the wallet or by card.",
					w: 1200,
					h: 675,
					caption: "Fund stage shows the exact amount to hold before you pay.",
				},
				{
					type: "list",
					items: [
						"From wallet — offered when your wallet's available balance covers the stage.",
						"By card — always offered. The card payment arrives in your wallet and is held from there.",
					],
				},
				{
					type: "p",
					content:
						"Every ticket in the stage needs a price first. If one doesn't have one, the dialog says so and nothing is charged.",
				},
			],
		},
		{
			id: "fund-one-ticket",
			heading: "Fund one ticket",
			body: [
				{
					type: "p",
					content:
						"Buy Now on a ticket pays for that ticket alone, by card or from your wallet. To pay for several at once, add them to your basket — the board's Checkout button adds every unfunded ticket — and pay in one go.",
				},
			],
		},
		{
			id: "who-gets-it",
			heading: "Who the money goes to",
			body: [
				{
					type: "p",
					content:
						"Money you pay before anyone is hired is held with no payee yet. The freelancer who claims the ticket becomes its payee, without you being charged again, and they're told they can start.",
				},
				{
					type: "callout",
					tone: "note",
					title: "Prepaid money nobody claimed comes back",
					body: [
						{
							type: "p",
							content:
								"If a prepaid ticket is completed, removed or cancelled without anyone claiming it — or you approve the stage while it is still unclaimed — its money is refunded to you in full. Prepaid escrow is never paid to nobody.",
						},
					],
				},
			],
		},
	],
});

/**
 * Fees. Grounded in finance-model.md §1.1 (5%, processing passed through), §16.4 (the payer's
 * effective rate; negotiated enterprise rates; truncated rounding — Decision #187) and the release
 * code (`finance.fn_release_ticket_escrow`: the fee is on the escrowed amount, a deadline bonus is
 * paid on top). The card-processing contribution is read from `ProcessingContribution.tsx`.
 */
const fees = helpArticle({
	slug: "fees",
	category: "escrow-and-payments",
	position: 2,
	title: "Fees: the 5% service fee and card processing",
	summary:
		"Projective keeps a 5% service fee from each payment when its escrow is released to the freelancer; clients pay the listed price, and card processing is a separate cost you can choose to help cover.",
	roles: ["client", "freelancer", "team", "business"],
	faq: { rank: 3, question: "What does Projective charge?" },
	related: ["what-is-escrow", "the-7-day-pending-window", "paying-by-card-and-currencies"],
	sections: [
		{
			id: "the-service-fee",
			heading: "The 5% service fee",
			body: [
				{
					type: "p",
					content:
						"When escrow is released, 5% of the released amount is kept as Projective's service fee and the rest goes to the freelancer or team. It pays for holding the money, running payments and handling disputes.",
				},
				{
					type: "table",
					caption: "A £1,000 stage, approved",
					head: ["Step", "Amount"],
					rowHeaders: true,
					rows: [
						["The client pays into escrow", "£1,000.00"],
						["Service fee (5%)", "£50.00"],
						["The freelancer receives", "£950.00"],
					],
				},
				{
					type: "list",
					items: [
						"The fee is worked out in whole pennies and rounded down, so it is never more than 5%.",
						"A deadline bonus is paid on top of the escrow, with no fee taken from it.",
						"In a Fair Exit, the fee is charged only on the share the freelancer earned; the refunded part comes back to the client without a fee.",
						"Your plan never changes the fee. Only an approved volume contract with an enterprise or business can.",
					],
				},
			],
		},
		{
			id: "card-processing",
			heading: "Card processing",
			body: [
				{
					type: "p",
					content: [
						"Card networks charge to process a card payment, and that cost isn't part of the 5%. At card checkout you can tick ",
						{ type: "strong", text: "Help cover the card processing fee" },
						" to add it to your total. It is never ticked for you, and it isn't offered when you pay from your wallet, because then no card is involved.",
					],
				},
			],
		},
	],
});

/**
 * Needs funding. Grounded in PRODUCT_SPEC §Escrow, Wallets & Finance #2 (No hold, no work — Decision
 * #165; the Chain Reaction and Fund on arrival — Decision #210) and PRODUCT_MANAGEMENT §3.6, plus
 * business auto-funding (§Escrow, Wallets & Finance #4).
 */
const needsFunding = helpArticle({
	slug: "needs-funding",
	category: "escrow-and-payments",
	position: 3,
	title: "Why a ticket says Needs funding",
	summary:
		"Needs funding means a ticket was ready to start but its money couldn't be held — usually because the paying wallet was short or the ticket has no price — so it waits, off freelancers' boards, until the client pays.",
	roles: ["client", "freelancer", "business"],
	related: ["how-stage-funding-works", "claim-and-start-a-ticket", "approve-a-stage"],
	sections: [
		{
			id: "what-it-means",
			heading: "What it means",
			body: [
				{
					type: "p",
					content:
						"A ticket's escrow is held at a fixed moment — when it is claimed, or for a Pipeline's next stage when the previous one is approved. If the money can't be held then, the ticket moves to Needs funding instead of starting. Common reasons:",
				},
				{
					type: "list",
					items: [
						"The paying wallet doesn't have enough available money.",
						"The ticket or its stage has no price.",
						"For a business, the payment needs a spending approval first.",
					],
				},
			],
		},
		{
			id: "what-to-do",
			heading: "What to do",
			body: [
				{
					type: "p",
					content:
						"If you're the client, you'll have been told the reason and the amount. Fund the ticket from your wallet or pay by card with Buy Now, and the freelancer is told they can start. If you're the freelancer, there's nothing to do: the ticket comes back to your board once it is funded.",
				},
			],
		},
		{
			id: "pipelines",
			heading: "Pipelines: funding on arrival",
			body: [
				{
					type: "p",
					content:
						"When you approve a Pipeline ticket's work on one stage, that stage is paid and the ticket moves to its next stage. With Fund on arrival on (the default), the next stage's money is held straight away from your wallet's current balance. If it can't be, the approval still stands — the finished stage is still paid — and the ticket waits as Needs funding. You can turn Fund on arrival off for a stage in its advanced settings; the ticket then waits there unfunded until you pay by hand.",
				},
				{
					type: "callout",
					tone: "tip",
					title: "Businesses can fund automatically",
					body: [
						{
							type: "p",
							content:
								"A business can choose what happens when one of its tickets needs funding: tell the project owner, add the ticket to their basket, or pay it from the business wallet as soon as the wallet can cover it.",
						},
					],
				},
			],
		},
	],
});

/**
 * Paying. Grounded in PRODUCT_SPEC §Escrow, Wallets & Finance #5 (tap-and-pay with no ID, Decision
 * #126; the seller's currency shown beside the buyer's and express wallets for individuals, Decision
 * #153; a payment that can no longer complete stays in the wallet, Decision #200; a business pays only
 * from its wallet or its own card and a short pool is refused with Contribute, Decision #230 (c)) and
 * §6 Global Multi-Currency.
 */
const payingByCardAndCurrencies = helpArticle({
	slug: "paying-by-card-and-currencies",
	category: "escrow-and-payments",
	position: 4,
	title: "Paying by card, wallet and in other currencies",
	summary:
		"Individuals can pay by card with no ID checks or setup; you're charged in the currency the seller priced in, with your own currency shown beside it, and a payment that can't complete is kept in your wallet.",
	roles: ["client", "business"],
	related: ["how-stage-funding-works", "fees", "business-wallet-and-spending-limits"],
	sections: [
		{
			id: "pay-by-card",
			heading: "Pay by card with nothing to set up",
			body: [
				{
					type: "p",
					content:
						"Buying never needs an identity check or a wallet set-up. Pay by card through Stripe, and save the card for next time if you like. Apple Pay, Google Pay and PayPal appear as quick buttons where your device supports them.",
				},
				{
					type: "p",
					content:
						"Behind the scenes a card payment is paid into a wallet Projective opens for you, and the purchase is paid from there — so card and wallet payments are one record. If what you paid for can no longer go ahead (the price changed, or the stage moved on), the money stays in your wallet and you're told why. A payment that arrives is never lost.",
				},
			],
		},
		{
			id: "currencies",
			heading: "Currencies",
			body: [
				{
					type: "p",
					content:
						"Everything is priced and paid in the currency its creator chose. You can browse in your own currency (Settings → Language & region), and checkout shows both figures — for example, your currency's total beside the exact amount charged in the seller's — with the rate used. Your bank converts the charge on your statement.",
				},
				{
					type: "p",
					content:
						"The rate is captured at the moment money is committed, so a settled amount never drifts with the market afterwards.",
				},
			],
		},
		{
			id: "paying-as-a-business",
			heading: "Paying as a business",
			body: [
				{
					type: "p",
					content: [
						"A business pays from its own wallet or with a card saved to the business — never with a member's personal card. If the business wallet is short, the payment is refused and members who can add money are offered ",
						{ type: "strong", text: "Contribute" },
						".",
					],
				},
			],
		},
	],
});

/** Every `escrow-and-payments` article. */
export const ESCROW_AND_PAYMENTS_ARTICLES: readonly HelpCentreArticle[] = [
	whatIsEscrow,
	howStageFundingWorks,
	fees,
	needsFunding,
	payingByCardAndCurrencies,
];
