import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `payouts-and-verification` category's articles, in reading order. */

/**
 * The payout-ready gate. Grounded in Decision #196 (KYC verified + a verified payout account before
 * applying, accepting, being seated or assigned, claiming, creating or joining a team; a team needs
 * every shareholder; a buyer's refund balance never needs ID), PRODUCT_SPEC §Escrow, Wallets &
 * Finance #5 (the No Forever-Escrow Guarantee) and §Identity Verification (Level 2, Stripe Identity).
 */
const getPayoutReady = helpArticle({
	slug: "get-payout-ready",
	category: "payouts-and-verification",
	position: 0,
	title: "Get payout-ready: identity and payout account",
	summary:
		"To take paid work you need two things in Settings → Verification & payouts: an identity check with Stripe and a verified payout account. Clients who only buy never need either.",
	roles: ["freelancer", "team"],
	startHere: ["freelancer", "team"],
	faq: { rank: 7, question: "Why do I need to verify my identity to work?" },
	related: ["the-7-day-pending-window", "withdraw-your-earnings", "start-working-as-a-freelancer"],
	sections: [
		{
			id: "the-two-steps",
			heading: "The two steps",
			body: [
				{
					type: "list",
					ordered: true,
					items: [
						{
							content: [
								{ type: "strong", text: "Verify your identity." },
								" Stripe checks a government ID and takes a quick selfie to confirm it's you. Projective never stores your documents — only Stripe's reference to the check.",
							],
						},
						{
							content: [
								{ type: "strong", text: "Set up payouts." },
								" Add the bank account your earnings will be paid into, through Stripe. It is verified before it can receive money.",
							],
						},
					],
				},
				{
					type: "p",
					content: [
						"Both live in ",
						{
							type: "link",
							href: "/settings/verification",
							text: "Settings → Verification & payouts",
						},
						", which shows what is done and the one next step.",
					],
				},
			],
		},
		{
			id: "why-before-work",
			heading: "Why it comes before the work",
			body: [
				{
					type: "p",
					content:
						"Projective checks this before you take on project work, not only when you withdraw: you can't apply for paid work, accept an invitation, claim or be assigned a ticket, or create or join a team until both steps are done. That way, money held for project work can always be paid out — it can never get stuck in escrow with nobody able to receive it.",
				},
				{
					type: "callout",
					tone: "note",
					title: "Teams",
					body: [
						{
							type: "p",
							content:
								"A team is seated on new work only when everyone who receives a share of its earnings is payout-ready. A team already working on a stage keeps working on it.",
						},
					],
				},
			],
		},
		{
			id: "clients",
			heading: "If you only hire",
			body: [
				{
					type: "p",
					content:
						"Buying never needs an identity check. If you have a refund balance you want to withdraw, you need a payout account, but not an identity check.",
				},
			],
		},
	],
});

/**
 * The pending window. Grounded in Decision #191 (earned credits — releases, team shares and vault
 * cuts, fair-exit and session payouts, product sales — are Pending for `pending_release_days` (7) and
 * cannot be withdrawn or spent; top-ups, card payments, refunds, transfers and returned payouts are
 * Available at once) and PRODUCT_SPEC §Escrow, Wallets & Finance #5.
 */
const theSevenDayPendingWindow = helpArticle({
	slug: "the-7-day-pending-window",
	category: "payouts-and-verification",
	position: 1,
	title: "Why earnings show as Pending for 7 days",
	summary:
		"Money you earn — a released payment, a team share, a session or a product sale — is Pending for 7 days as a safety window, then becomes Available to withdraw or spend. Money you put in yourself is available at once.",
	roles: ["freelancer", "team"],
	startHere: ["freelancer", "team"],
	faq: { rank: 8, question: "Why are my earnings shown as Pending?" },
	related: ["withdraw-your-earnings", "get-payout-ready", "accept-and-release-payment"],
	sections: [
		{
			id: "pending-and-available",
			heading: "Pending and Available",
			body: [
				{
					type: "p",
					content:
						"Your wallet shows two figures. Available is money you can withdraw or spend on Projective now. Pending is money you've earned that is still in its 7-day safety window; it moves to Available on its own when the window ends.",
				},
				{
					type: "table",
					head: ["Money", "Pending for 7 days?"],
					rowHeaders: true,
					rows: [
						["A released escrow payment, including your share of a team payment", "Yes"],
						["A Fair Exit payout or a session payout", "Yes"],
						["A digital product sale", "Yes"],
						["A top-up or card payment you made", "No — available at once"],
						["A refund, a transfer or a returned payout", "No — available at once"],
					],
				},
			],
		},
		{
			id: "why",
			heading: "Why the window exists",
			body: [
				{
					type: "p",
					content:
						"Card payments can be disputed with the bank for a while after they are made. The window gives Projective time to catch problems before money leaves the platform. If a client's bank wins a dispute, the money is recovered from that client's wallet — not from your earnings.",
				},
			],
		},
	],
});

/**
 * Withdrawals. Grounded in Decision #202 (debited at start and credited back on refusal; the stale
 * sweep; reversals; bank refusals reported) and finance-model.md §13 (per-currency minimums from
 * `security.platform_params.min_withdrawal_minor`, read from `00005001_seed_platform_params.sql`), with
 * the earnings rule of Decision #196 (4).
 */
const withdrawYourEarnings = helpArticle({
	slug: "withdraw-your-earnings",
	category: "payouts-and-verification",
	position: 2,
	title: "Withdrawals and minimums",
	summary:
		"Withdraw your Available balance to your verified payout account from your wallet; there is a minimum of about £10 in each currency, and a withdrawal that fails is always returned to your wallet.",
	roles: ["freelancer", "team", "client"],
	related: ["the-7-day-pending-window", "get-payout-ready", "fees"],
	sections: [
		{
			id: "how-to-withdraw",
			heading: "How to withdraw",
			body: [
				{
					type: "p",
					content: [
						"Open your ",
						{ type: "link", href: "/wallet", text: "wallet" },
						", choose Withdraw, enter an amount up to your Available balance and pick which of your payout methods to use. Your wallet is debited straight away and the money is sent to your Stripe payout account, which pays your bank on Stripe's schedule.",
					],
				},
			],
		},
		{
			id: "minimums",
			heading: "Minimums",
			body: [
				{
					type: "table",
					caption: "The smallest withdrawal in each currency",
					head: ["Currency", "Minimum"],
					rowHeaders: true,
					rows: [
						["GBP · USD · EUR · CHF", "10.00"],
						["CAD · SGD", "15.00"],
						["AUD", "20.00"],
						["AED", "45.00"],
						["JPY", "¥2,000"],
						["INR", "₹1,000"],
						["ZAR", "R200"],
						["NGN", "₦20,000"],
						["Any other currency", "1,000 of its smallest unit"],
					],
				},
			],
		},
		{
			id: "if-something-goes-wrong",
			heading: "If something goes wrong",
			body: [
				{
					type: "list",
					items: [
						"If Stripe refuses the withdrawal, the money is credited straight back to your wallet.",
						"A withdrawal is never left in limbo: one whose confirmation is lost is finished, re-sent or returned to your wallet within minutes.",
						"If your bank turns the payout down, you're told and asked to update your bank details.",
					],
				},
				{
					type: "callout",
					tone: "note",
					body: [
						{
							type: "p",
							content:
								"Earnings can only be withdrawn by someone who is payout-ready. A client taking out a refund balance needs a payout account but no identity check.",
						},
					],
				},
			],
		},
	],
});

/**
 * Business verification. Grounded in PRODUCT_SPEC §Identity Verification (Level 3 KYB: registration
 * documents and beneficial owners), finance-model.md §10 (KYB gates operating the pooled wallet), the
 * Invoice option for KYB-verified businesses (§Escrow, Wallets & Finance #4), the billing right that
 * opens Verification (Decisions #230 (d), #238) and the legal identity frozen once KYB is under way
 * (Decision #150).
 */
const businessVerificationKyb = helpArticle({
	slug: "business-verification-kyb",
	category: "payouts-and-verification",
	position: 3,
	title: "Verify a business (KYB)",
	summary:
		"A business is verified through Stripe with its registration details and the people who own it; it needs this before it can fund work or buy from its shared wallet.",
	roles: ["business"],
	startHere: ["business"],
	related: [
		"create-a-business",
		"business-wallet-and-spending-limits",
		"paying-by-card-and-currencies",
	],
	sections: [
		{
			id: "what-it-is",
			heading: "What KYB checks",
			body: [
				{
					type: "p",
					content:
						"Know Your Business is the company version of an identity check. Stripe asks for the business's registration documents and confirms who ultimately owns or controls it. Projective keeps only Stripe's reference to the check, never the documents.",
				},
			],
		},
		{
			id: "who-can-do-it",
			heading: "Who can do it",
			body: [
				{
					type: "p",
					content:
						"Verification lives in the business console's Verification view, which opens to the owner — and to an admin the owner has given the billing right. Once verification is under way, the business's legal name, registration number and corporate email are frozen, because an identity that could change after it was checked would prove nothing.",
				},
			],
		},
		{
			id: "what-it-unlocks",
			heading: "What it unlocks",
			body: [
				{
					type: "list",
					items: [
						"Paying for work and buying from the business wallet.",
						"Choosing Invoice at checkout, on a business set up for monthly invoicing.",
					],
				},
			],
		},
	],
});

/** Every `payouts-and-verification` article. */
export const PAYOUTS_AND_VERIFICATION_ARTICLES: readonly HelpCentreArticle[] = [
	getPayoutReady,
	theSevenDayPendingWindow,
	withdrawYourEarnings,
	businessVerificationKyb,
];
