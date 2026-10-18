import type { EditorialArticleRecord } from "@projective/types/editorial";
import { COVER_EGG_ORBITS } from "./covers.ts";

/** "Price the outcome, not the hour" — value pricing. */
export const PRICE_THE_OUTCOME_NOT_THE_HOUR: EditorialArticleRecord = {
	slug: "price-the-outcome-not-the-hour",
	title: "Price the outcome, not the hour",
	standfirst:
		"Projective has no hourly-rate field, and that is deliberate. When every stage has a price agreed before it starts, the conversation moves from how long something takes to what it is worth.",
	topics: ["value-pricing", "agile-delivery"],
	cover: COVER_EGG_ORBITS,
	authorSlug: "projective-editorial",
	status: "published",
	publishedAt: "2026-10-01T08:00:00Z",
	updatedAt: "2026-10-01T08:00:00Z",
	sections: [
		{
			id: "why-there-is-no-hourly-rate",
			heading: "Why there is no hourly rate",
			body: [
				{
					type: "p",
					content:
						"An hourly rate prices the input. It rewards the slow, punishes the expert who solves in an afternoon what takes others a week, and turns every client relationship into a debate about timesheets. It also invites surveillance: if hours are what is bought, hours are what gets tracked.",
				},
				{
					type: "p",
					content:
						"So a Projective freelancer profile carries skills, not a rate, and the platform never charges for how much work someone can hold at once. Capacity is protected by workload caps measured on the tickets a person holds, not by a meter on their time.",
				},
			],
		},
		{
			id: "soft-budgets-and-hard-budgets",
			heading: "Soft budgets and hard budgets",
			body: [
				{
					type: "p",
					content: [
						"Pricing a stage happens in two steps. When a client creates a project they can set a ",
						{ type: "strong", text: "soft budget" },
						" for each stage: a public signal of what they expect to spend, which binds nobody. It anchors the conversation without ending it.",
					],
				},
				{
					type: "p",
					content: [
						"The ",
						{ type: "strong", text: "hard budget" },
						" is the price both sides agree. The client proposes; the freelancer accepts, rejects or counters; the exchange continues until both say yes, and the agreed figure is what the stage's escrow will hold. When a stage has several seats, each seat is negotiated separately and privately: a senior architect and a junior implementer on the same stage can agree very different prices without either seeing the other's.",
					],
				},
			],
		},
		{
			id: "match-the-price-to-the-shape",
			heading: "Match the price to the shape of the work",
			body: [
				{
					type: "table",
					head: ["Work", "What is priced", "How the price is set"],
					rows: [
						["One-off", "Each stage", "Negotiated, with counter-offers"],
						[
							"Pipeline",
							"A unit price per ticket in a stage",
							"Negotiated once for the stage's tickets",
						],
						["Session", "Each session", "Fixed by the provider; not negotiable"],
					],
					caption: "How each kind of work is priced.",
					rowHeaders: true,
				},
				{
					type: "p",
					content:
						"Sessions are fixed for a reason. When the time itself is the product — advice, tutoring, a regular check-in — haggling over each slot adds friction without adding information. The provider sets a rate they can hold consistently, and the buyer can compare it like any other price.",
				},
			],
		},
		{
			id: "productise-what-you-repeat",
			heading: "Productise what you repeat",
			body: [
				{
					type: "p",
					content:
						"If you sell the same kind of work again and again, stop negotiating it from scratch. A service lets the freelancer act as the architect: the stages, their checklists and their prices are set up front. When a client buys it, the project is created from that template, ready to run.",
				},
				{
					type: "p",
					content:
						"A productised service is also where a price becomes honest about its edges. The listing states how many revision rounds are included and what an extra round costs, and both are copied into the stage when the project is created and frozen there. A later change to the listing does not reach into work already bought.",
				},
			],
		},
		{
			id: "revisions-are-part-of-the-price",
			heading: "Revisions are part of the price",
			body: [
				{
					type: "p",
					content:
						'Unlimited revisions are not generous; they are an unpriced risk. When a stage\'s free rounds are used, "Request revision" becomes "Buy a revision" at the stage\'s stated price. The client pays for that round before anything is sent back, its escrow is held on the ticket, and only then is the freelancer told the paid revision is funded and they can start.',
				},
				{
					type: "callout",
					tone: "tip",
					title: "Set the extra-round price deliberately",
					body: [
						{
							type: "p",
							content:
								"A price of zero makes extra rounds free. If you set free rounds but leave the price blank, an extra round costs the stage's own price. State the one you mean.",
						},
					],
				},
			],
		},
		{
			id: "price-in-your-own-currency",
			heading: "Price in your own currency",
			body: [
				{
					type: "p",
					content:
						"Every project, service, ticket and stage is priced in its creator's currency, and the creator is paid that exact amount in that currency. A buyer browsing in another currency sees the price converted for reading, beside the exact amount they will be charged, and the rate is captured when the money is committed so the settlement never drifts with the market afterwards.",
				},
			],
		},
		{
			id: "what-the-fee-is",
			heading: "What the fee is, and is not",
			body: [
				{
					type: "p",
					content:
						"Projective charges a flat 5% service fee on each release of escrow, plus the card processor's own costs. The fee does not shrink as your standing grows and is not bundled into any plan, so a price you quote today means the same thing next year. It is worked out in whole minor units and rounded down, and every preview uses the same rule, so the fee you are shown is the fee that is charged.",
				},
				{
					type: "p",
					content: [
						"Pricing the outcome only works if the outcome is protected. ",
						{ type: "link", href: "/articles/no-hold-no-work", text: "No hold, no work" },
						" explains how the agreed price is held before the first hour is spent.",
					],
				},
			],
		},
	],
};
