import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `teams-and-businesses` category's articles, in reading order. */

/**
 * Teams. Grounded in PRODUCT_SPEC §Freelancers & Teams (Virtual Agency; freelancer-only space —
 * Decision #228 (A); Draft-First creation), §Proposal allowances (published and two members —
 * Decision #228 (E)), finance-model.md §5 (split templates; Co-op free, Finder's Fee and Benevolent
 * Dictator on Pro Team — Decisions #226 (d), #234) and the payout-ready rule for team creation and
 * shareholders (Decision #196).
 */
const createATeam = helpArticle({
	slug: "create-a-team",
	category: "teams-and-businesses",
	position: 0,
	title: "Create a team and split earnings",
	summary:
		"Freelancers can form a team with just a name and a @handle, invite members, and agree how earnings are split; every payment to the team is divided automatically when it is released.",
	roles: ["team", "freelancer"],
	startHere: ["team"],
	related: ["get-payout-ready", "invite-people-to-a-stage", "the-7-day-pending-window"],
	sections: [
		{
			id: "start-a-team",
			heading: "Start a team",
			body: [
				{
					type: "p",
					content:
						"Teams are for freelancers: you need a freelancer profile and to be payout-ready. Create one from Teams with a display name and a unique @handle — that's all. It starts as a draft, and you add branding, roles, members and the earnings split afterwards in its settings. No company registration or joint bank account is needed.",
				},
			],
		},
		{
			id: "taking-work",
			heading: "Taking work as a team",
			body: [
				{
					type: "list",
					items: [
						"A team must be published and have at least two members before it can apply to projects.",
						"It applies through a member who is allowed to commit it to work, and uses the team's own proposal allowance.",
						"It is seated on a stage only when every member who receives a share of its earnings is payout-ready.",
					],
				},
			],
		},
		{
			id: "splitting-earnings",
			heading: "Splitting earnings",
			body: [
				{
					type: "p",
					content:
						"When a stage's payment is released to the team, it is divided at once between the team vault and members' own wallets, following the team's split. Each share then clears the 7-day pending window in its owner's wallet.",
				},
				{
					type: "table",
					head: ["Split", "How it divides", "Plan"],
					rowHeaders: true,
					rows: [
						["Co-op", "Equal shares for every member, after the vault's cut.", "Every team"],
						[
							"Finder's fee",
							"A fixed percentage to the member who found the project, the rest shared.",
							"Pro Team",
						],
						[
							"Benevolent dictator",
							"Everything to the team vault, shared out by an admin.",
							"Pro Team",
						],
					],
				},
				{
					type: "p",
					content:
						"Saving a new split replaces the active one and keeps the old one as history. A team that moves back to the free plan keeps using the split it already has until it saves a new one.",
				},
			],
		},
	],
});

/**
 * Businesses. Grounded in PRODUCT_SPEC §Clients & Businesses (any adult account may create one —
 * Decision #230 (a); Draft-First; visibility — Decision #230 (h); Owner · Admin · Member with Project
 * Manager and Observer as custom-role templates — Decision #230 (b); one permission per act; billing
 * and verification are the Owner's — Decisions #230 (d), #238).
 */
const createABusiness = helpArticle({
	slug: "create-a-business",
	category: "teams-and-businesses",
	position: 1,
	title: "Create a business and invite your colleagues",
	summary:
		"Any adult account can create a business with a name and a @handle; colleagues join as Owner, Admin or Member, and custom roles decide exactly who may hire, approve work and spend.",
	roles: ["business", "client"],
	startHere: ["business"],
	related: [
		"business-wallet-and-spending-limits",
		"business-verification-kyb",
		"invite-people-to-a-stage",
	],
	sections: [
		{
			id: "create-one",
			heading: "Create one",
			body: [
				{
					type: "p",
					content:
						"Choose Create Business from Businesses and give it a display name and a unique @handle. It starts as a draft; you add its legal name, logo, billing details and members afterwards. Acting as a business is always acting as a client, so the business view shows no selling tools.",
				},
				{
					type: "p",
					content:
						"A business can be public (listed in the directory), unlisted, or invite-only. How many businesses you can own depends on your plan; how many you can join is never limited.",
				},
			],
		},
		{
			id: "roles",
			heading: "Roles",
			body: [
				{
					type: "dl",
					items: [
						{
							term: "Owner",
							definition:
								"Everything, including withdrawing from the business wallet, billing, verification and archiving the business. One per business.",
						},
						{
							term: "Admin",
							definition:
								"Manages the wallet, sets spending limits and invites or removes members — everything except withdrawing, billing, verification and archiving, unless the owner grants them.",
						},
						{
							term: "Member",
							definition:
								"Sees the business's projects, comments, asks for free revisions and can add money to the wallet. Anything more comes from a custom role.",
						},
					],
				},
				{
					type: "p",
					content:
						"Custom roles grant exactly what they list. Project Manager (creates projects, approves work, releases payments) and Observer (view only) are offered as starting points.",
				},
			],
		},
		{
			id: "one-permission-per-act",
			heading: "One permission for each act",
			body: [
				{
					type: "p",
					content:
						"Hiring and approving work that releases payment need the hiring permission; creating a project billed to the business needs the project permission; buying from the business wallet needs the purchasing permission; and funding escrow needs the right to spend from the wallet. A member who created a project keeps the authority to hire and approve on it.",
				},
			],
		},
	],
});

/**
 * The business wallet. Grounded in PRODUCT_SPEC §Business Wallets (no minted money — Decision #122),
 * §Escrow, Wallets & Finance #4–#5 (auto-funding, the low-balance warning, a short pool refused with
 * Contribute — Decision #230 (c), whoever spends answers for it — Decision #240), finance-model.md
 * §14, and PRODUCT_MANAGEMENT §3.5 Spend approval (7-day expiry; bound to what it approves and spent
 * once — Decision #239). Caps and the approval threshold are Business Pro (Decision #230 (e)).
 */
const businessWalletAndSpendingLimits = helpArticle({
	slug: "business-wallet-and-spending-limits",
	category: "teams-and-businesses",
	position: 2,
	title: "The business wallet, spending limits and approvals",
	summary:
		"A business pays from one shared wallet that starts at zero; on Business Pro, members can be given spending limits, and payments over a limit or threshold wait for someone else's approval.",
	roles: ["business"],
	startHere: ["business"],
	related: ["create-a-business", "business-verification-kyb", "needs-funding"],
	sections: [
		{
			id: "the-shared-wallet",
			heading: "The shared wallet",
			body: [
				{
					type: "p",
					content:
						"The business wallet holds the money every member spends on the business's behalf, so nobody needs the company card for each payment. It starts at zero and only ever holds real money: top-ups, refunds and transfers in.",
				},
				{
					type: "p",
					content:
						"When the wallet can't cover a payment, the payment is refused — it is never topped up from a member's own card — and members who can add money see Contribute.",
				},
			],
		},
		{
			id: "limits-and-approvals",
			heading: "Spending limits and approvals",
			body: [
				{
					type: "p",
					content:
						"On Business Pro, each member can have a spending limit, and the wallet can have an approval threshold. A payment over the member's limit, or at or above the threshold, becomes a spend request instead of going through.",
				},
				{
					type: "list",
					items: [
						"Someone with the approve-spend permission — never the person asking — approves or rejects it.",
						"An approval covers exactly the payment it was for, and is used once.",
						"A request nobody answers expires after 7 days.",
					],
				},
				{
					type: "p",
					content:
						"Every payment is counted against the member who made it. Payments nobody makes by hand — a claim, an automatic stage funding — count against the project's owner.",
				},
			],
		},
		{
			id: "staying-topped-up",
			heading: "Staying topped up",
			body: [
				{
					type: "list",
					items: [
						"Set a balance floor to warn everyone who can add money when the wallet drops below it.",
						"Add a floor top-up that charges a saved card each time the balance drops below the floor.",
						"Choose what happens when a ticket needs funding: tell the project owner, add it to their basket, or pay it from the wallet as soon as the money is there.",
					],
				},
			],
		},
	],
});

/** Every `teams-and-businesses` article. */
export const TEAMS_AND_BUSINESSES_ARTICLES: readonly HelpCentreArticle[] = [
	createATeam,
	createABusiness,
	businessWalletAndSpendingLimits,
];
