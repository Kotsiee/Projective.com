import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `projects-and-stages` category's articles, in reading order. */

/**
 * Creating a project. Grounded in PRODUCT_SPEC §Project Creation (Quick-Init → Configuration,
 * Decisions #163, #195) and §Post-Onboarding Immutability (the publish confirmation); personal
 * projects from Decision #208 (C).
 */
const createAProject = helpArticle({
	slug: "create-a-project",
	category: "projects-and-stages",
	position: 0,
	title: "Create a project and set it up",
	summary:
		"Start with a title, a type, a currency and an optional price; Projective creates a draft with its first stage, and you finish the brief, the stages and the terms on the project's setup page before publishing.",
	roles: ["client", "business"],
	related: ["choose-a-project-type", "stages-and-tickets", "what-locks-after-hiring"],
	sections: [
		{
			id: "quick-start",
			heading: "Step 1: the quick start",
			body: [
				{
					type: "p",
					content: [
						"Choose ",
						{ type: "strong", text: "Create project" },
						" on your Projects page. The window asks for only four things:",
					],
				},
				{
					type: "list",
					ordered: true,
					items: [
						"A title of at least three characters.",
						"The project type — Task, One-off or Pipeline.",
						"The currency. It is fixed to the project, because escrow is priced in it.",
						"Optionally, one price: a pipeline's usual ticket rate, or the budget of a one-off or Task.",
					],
				},
				{
					type: "p",
					content:
						"That creates a private draft with its first stage already in place, and takes you straight to its setup page. Nothing is published yet.",
				},
			],
		},
		{
			id: "set-it-up",
			heading: "Step 2: set it up",
			body: [
				{
					type: "p",
					content:
						"The setup page is one long page with a section list beside it, not a step-by-step wizard, so you can fill it in any order. It covers the brief, who owns the work you receive, visibility, deadline bonuses, reference files, an NDA, and each stage's scope, tasks, skills, duration and seats.",
				},
				{
					type: "image",
					src: "https://placehold.co/1200x675?text=Project+setup+page",
					alt:
						"The project setup page: a section list on the left and the brief, stages and terms on the right.",
					w: 1200,
					h: 675,
					caption: "The setup page lists its sections beside the form.",
				},
				{
					type: "p",
					content:
						"A progress ladder shows how far along you are. You can preview the project as a freelancer will see it once the essentials are there: the title, the type, pricing and who you need.",
				},
			],
		},
		{
			id: "publish",
			heading: "Step 3: publish",
			body: [
				{
					type: "p",
					content:
						"Publishing takes the project live. Before it does, a confirmation tells you exactly what will lock once someone is hired, so nothing changes under anyone's feet later.",
				},
				{
					type: "callout",
					tone: "tip",
					title: "Just organising your own work?",
					body: [
						{
							type: "p",
							content:
								"Choose Personal project when you create it. A personal project has stages, tickets, a board and files, but no money and no members — it is a planning tool that stays private.",
						},
					],
				},
			],
		},
	],
});

/**
 * Stages and tickets. Grounded in PRODUCT_SPEC §Features → Stage-Based Projects (Deliverable-Based
 * workflow), §Ticket Lifecycle & Business Rules (Creation & Purchasing Gate, Ticket Movement — Decision
 * #94, Editing & Reordering Restrictions) and §Stage Management.
 */
const stagesAndTickets = helpArticle({
	slug: "stages-and-tickets",
	category: "projects-and-stages",
	position: 1,
	title: "Stages and tickets, explained",
	summary:
		"A stage is a step of the project that is funded, delivered and approved on its own; a ticket is one piece of work inside it that a freelancer claims, completes and submits.",
	roles: ["client", "freelancer", "team", "business"],
	related: ["claim-and-start-a-ticket", "how-stage-funding-works", "submit-work-for-review"],
	sections: [
		{
			id: "stages",
			heading: "Stages",
			body: [
				{
					type: "p",
					content:
						"A stage is the unit money moves in. Its tickets are paid for before work starts, and the stage closes when its work is approved and paid. You can add, rename, reorder and remove stages as the project changes.",
				},
				{
					type: "p",
					content:
						"Reordering stages never reshuffles the tickets inside them. Removing a stage that holds claimed, funded work releases that money to the freelancer doing it — the same as removing the ticket.",
				},
			],
		},
		{
			id: "tickets",
			heading: "Tickets",
			body: [
				{
					type: "p",
					content:
						"A ticket needs only a title to exist, so you can sketch the work quickly. It needs a description before anyone can pay for it, because a freelancer has to know what they are agreeing to.",
				},
				{
					type: "list",
					items: [
						"You can edit a ticket until a freelancer claims it. After that its title, description and price are locked.",
						"You can move a ticket between stages until a freelancer is working on it. Moving it then would change the work they agreed to, so it waits until the work is handed back for review.",
						"Freelancers only ever see tickets that are paid for in the stage they sit in.",
					],
				},
			],
		},
		{
			id: "the-board",
			heading: "The board",
			body: [
				{
					type: "p",
					content:
						"Each stage has a board with columns for every step a ticket goes through. Clients can follow progress there without interrupting the work. In a New column you can drag tickets into the order you want; after that, tickets sort by their latest update.",
				},
			],
		},
	],
});

/**
 * Inviting people. Grounded in PRODUCT_SPEC §The Hiring Process → The Outbound Invitation (the
 * 48-day lockout after a decline, the 10-per-10-minutes cap), Managing what you sent, Stages are
 * offered one at a time (Decision #139), Staffing can be delegated and stage invite links
 * (Decision #145).
 */
const invitePeopleToAStage = helpArticle({
	slug: "invite-people-to-a-stage",
	category: "projects-and-stages",
	position: 2,
	title: "Invite people to a stage",
	summary:
		"Invite a freelancer or team to a stage from the project's Members page or a shared invite link; they accept or decline each stage, and someone who declines can't be re-invited to that project for 48 days.",
	roles: ["client", "business"],
	startHere: ["business"],
	related: ["hire-your-first-freelancer", "what-locks-after-hiring", "create-a-business"],
	sections: [
		{
			id: "send-an-invitation",
			heading: "Send an invitation",
			body: [
				{
					type: "p",
					content:
						"Open the project's Members page and choose Invite. Search for a person or a team, or pick from Quick add — the people you already work with. You can also type an email address to invite someone who isn't on Projective yet.",
				},
				{
					type: "p",
					content:
						"Each invitation is for one stage at that stage's price. To give a member another stage, use Invite to stage on their card; they accept or decline it like any other invitation.",
				},
			],
		},
		{
			id: "invite-links",
			heading: "Share an invite link",
			body: [
				{
					type: "p",
					content:
						"Every stage can have one invite link to share by email, WhatsApp, LinkedIn or X. Opening it asks the person to sign in and offers Ask to join. A link never puts anyone on the stage by itself: it files a request you accept or decline. You can reset the link (the old one stops working at once) or turn it off.",
				},
			],
		},
		{
			id: "after-you-send",
			heading: "After you send",
			body: [
				{
					type: "p",
					content:
						"The Invitations section shows each invitation as Pending, Accepted, Declined or Expired. You can cancel an open one, dismiss a declined or expired one, and remove someone who joined.",
				},
				{
					type: "callout",
					tone: "warning",
					title: "Saying no once is enough",
					body: [
						{
							type: "p",
							content:
								"If someone declines, the invite control for them on that project shows a lock and the date it reopens, 48 days after their decline. Dismissing the declined invitation doesn't shorten the wait. You can also send at most 10 invitations in any 10 minutes.",
						},
					],
				},
				{
					type: "p",
					content:
						"The project's owner can let an admin or manager invite people and answer requests on their behalf. Appointing admins and removing people stay with the owner.",
				},
			],
		},
	],
});

/**
 * Claiming work. Grounded in PRODUCT_SPEC §Escrow, Wallets & Finance #2 (No hold, no work — Decision
 * #165; the column lock — Decision #210) and §Escrow Lifecycle for Tickets (prepaid escrow bound at
 * the claim — Decision #197); payout readiness from Decision #196.
 */
const claimAndStartATicket = helpArticle({
	slug: "claim-and-start-a-ticket",
	category: "projects-and-stages",
	position: 3,
	title: "Claiming a ticket and starting work",
	summary:
		"Claiming a ticket is what holds its money in escrow, so you only ever start work that is already paid for; if the money can't be held, the claim is refused and the client is asked to fund it.",
	roles: ["freelancer", "team"],
	startHere: ["freelancer", "team"],
	related: ["needs-funding", "submit-work-for-review", "get-payout-ready"],
	sections: [
		{
			id: "claiming",
			heading: "What claiming does",
			body: [
				{
					type: "p",
					content:
						"On a stage you're part of, drag a ticket into the work column or choose Claim. The ticket's escrow is held at that moment — or, if the client already paid for it in advance, the claim simply names you as the person to be paid.",
				},
				{
					type: "p",
					content: "You're told “Funded — you can start” as soon as the money is held.",
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
						"If the money can't be held — the ticket has no price, or the client's wallet can't cover it — the claim is refused and the ticket moves to ",
						{ type: "strong", text: "Needs funding" },
						". It leaves every freelancer's board until the client pays, and the client is told why.",
					],
				},
				{
					type: "p",
					content:
						"The board shows the work columns as locked while you drag a claimed ticket that isn't funded, with the reason, rather than letting you drop it somewhere it can't go.",
				},
			],
		},
		{
			id: "before-you-can-claim",
			heading: "Before you can claim",
			body: [
				{
					type: "p",
					content: [
						"You need to be on the stage and payout-ready. ",
						{
							type: "link",
							href: "/help/payouts-and-verification/get-payout-ready",
							text: "Here's how to get payout-ready",
						},
						".",
					],
				},
			],
		},
	],
});

/**
 * What freezes on hiring. Grounded in PRODUCT_SPEC §Stage Management → 4. Post-Onboarding
 * Immutability (Decision #139: a draft acceptance is staged until publishing).
 */
const whatLocksAfterHiring = helpArticle({
	slug: "what-locks-after-hiring",
	category: "projects-and-stages",
	position: 4,
	title: "What you can still change after someone is hired",
	summary:
		"Once a freelancer joins, the project's type is fixed and each staffed stage's ticket price is frozen; scope, checklists, skills and notes stay editable.",
	roles: ["client", "business"],
	related: ["create-a-project", "stages-and-tickets", "choose-a-project-type"],
	sections: [
		{
			id: "what-locks",
			heading: "What locks, and when",
			body: [
				{
					type: "table",
					head: ["What", "Locks when"],
					rowHeaders: true,
					rows: [
						["The project type", "The first freelancer joins anywhere on the project."],
						[
							"A stage's ticket price",
							"That stage is staffed. Other stages can still be repriced.",
						],
						[
							"The single price of a Task or flat One-off",
							"Anyone joins the project, since they were hired against that price.",
						],
					],
				},
				{
					type: "p",
					content:
						"These are the terms a freelancer accepted, so they can't change once the work is agreed. A seat someone took stays counted even if they later leave. A declined invitation never locks anything.",
				},
			],
		},
		{
			id: "what-stays-editable",
			heading: "What stays editable",
			body: [
				{
					type: "p",
					content:
						"Scope, the task checklist, required skills and delivery notes can always be clarified — that helps the people doing the work. If you accept someone while the project is still a draft, nothing locks until you publish.",
				},
			],
		},
	],
});

/** Every `projects-and-stages` article. */
export const PROJECTS_AND_STAGES_ARTICLES: readonly HelpCentreArticle[] = [
	createAProject,
	stagesAndTickets,
	invitePeopleToAStage,
	claimAndStartATicket,
	whatLocksAfterHiring,
];
