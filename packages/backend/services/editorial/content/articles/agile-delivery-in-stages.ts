import type { EditorialArticleRecord } from "@projective/types/editorial";
import { COVER_PALM_DUSK, placeholderFigure } from "./covers.ts";

/** "Agile without the ceremony: stages as increments" — agile delivery. */
export const AGILE_DELIVERY_IN_STAGES: EditorialArticleRecord = {
	slug: "agile-delivery-in-stages",
	title: "Agile without the ceremony: stages as increments",
	standfirst:
		"Sprints, stand-ups and story points were designed for teams who share an office and a payroll. A stage keeps what made agile work — small increments, a clear definition of done, review before moving on — and drops the rituals that assume you do.",
	topics: ["agile-delivery", "async-collaboration"],
	cover: COVER_PALM_DUSK,
	authorSlug: "projective-editorial",
	status: "published",
	publishedAt: "2026-09-09T08:00:00Z",
	updatedAt: "2026-09-09T08:00:00Z",
	sections: [
		{
			id: "what-agile-was-for",
			heading: "What agile was for",
			body: [
				{
					type: "p",
					content:
						'Strip away the ceremonies and agile delivery rests on three ideas: deliver in small increments, agree what "done" means before you start, and look at the result before deciding what comes next. Everything else — the stand-up, the planning poker, the two-week sprint — is scaffolding for teams who sit together and are paid whether or not an increment lands.',
				},
				{
					type: "p",
					content:
						"Freelance work has a risk an employed team does not: payment. A client is exposed if they pay for work that never arrives; a freelancer is exposed if they deliver work that is never paid. So an increment for independent work has to carry its money with it. That is what a stage is.",
				},
			],
		},
		{
			id: "a-stage-is-an-increment",
			heading: "A stage is an increment",
			body: [
				{
					type: "p",
					content:
						"Every stage on Projective has one objective and one category from the CREATE framework, which says what kind of increment it is:",
				},
				{
					type: "table",
					head: ["Category", "The stage's objective", "For example"],
					rows: [
						["Create", "Produce an asset", "UI design, code, copywriting"],
						["Run", "Operate something over time", "Server upkeep, social posting"],
						["Educate", "Transfer knowledge", "Programming tutoring, language lessons"],
						["Advise", "Give strategic guidance", "Architecture review, business strategy"],
						["Test", "Validate quality", "Bug hunting, security audits, user testing"],
						["Empower", "Hand over and enable", "Team onboarding, documentation"],
					],
					caption: "The six CREATE categories a stage can take.",
					rowHeaders: true,
				},
				{
					type: "p",
					content:
						"The category is not a label for its own sake. It sets the stage's baseline weight when work is shared out, and it tells everyone what evidence will prove the stage is finished: files for a design stage, a logged session for advice, a clean report for a test.",
				},
			],
		},
		{
			id: "pick-the-shape-of-the-work",
			heading: "Pick the shape of the work",
			body: [
				{
					type: "p",
					content: "A client-architected project takes one of three shapes:",
				},
				{
					type: "dl",
					items: [
						{
							term: "Task",
							definition:
								"One deliverable for one price: a single stage holding a single ticket. No timeline to manage, because there is nothing to sequence.",
						},
						{
							term: "One-off",
							definition:
								"A finite piece of work carried through a run of milestone stages, shown on a timeline toward a single delivery.",
						},
						{
							term: "Pipeline",
							definition:
								"Continuous work: many tickets moving through stages on a Kanban board, for content production, maintenance or ongoing development.",
						},
					],
				},
				{
					type: "p",
					content:
						"Choose the smallest shape that fits. A one-off with one milestone is a Task wearing a costume, and a pipeline for three tickets is a board nobody needs.",
				},
			],
		},
		{
			id: "the-checklist-is-the-definition-of-done",
			heading: "The checklist is the definition of done",
			body: [
				{
					type: "p",
					content:
						'On a deliverable stage, "done" is written down before work starts as the stage\'s checklist. The freelancer submits against it; the client reviews against it. That single shared list removes the most common argument in freelance work, which is not about quality but about scope.',
				},
				{
					type: "p",
					content:
						"The number of revision rounds is part of the same agreement. When a project is created from a freelancer's service, the stage copies that service's free rounds and its price for an extra round, and the terms are then frozen: a later change to the listing does not reach back into work already bought.",
				},
				{
					type: "callout",
					tone: "note",
					body: [
						{
							type: "p",
							content:
								'A good checklist item can be ticked by someone who was not in the room: "Homepage hero exported at 1x and 2x" rather than "Hero looks good".',
						},
					],
				},
			],
		},
		{
			id: "pull-dont-push",
			heading: "Pull, don't push",
			body: [
				{
					type: "p",
					content:
						"On a pipeline, freelancers hired for a stage pull work from its backlog by claiming tickets. A claim locks the ticket to them, and the escrow for it is held at that moment at the latest. A claim that is parked — taken but never started — expires after a time limit (24 hours by default), and the ticket returns to the backlog with any escrow refunded to the client in full.",
				},
				{
					type: "p",
					content: [
						"Capacity is measured, not guessed. Each ticket carries a ",
						{ type: "strong", text: "workload intensity" },
						": its category's baseline weight multiplied by a difficulty the client sets (low, standard or high). A stage can cap how much intensity one freelancer holds at once, and every freelancer has a global cap across all their projects, so nobody can hoard a backlog they cannot finish.",
					],
				},
				{
					type: "h3",
					text: "When pulling is the wrong model",
				},
				{
					type: "p",
					content:
						"A client can change how a stage hands out work: round robin gives the next ticket to whoever holds the least intensity, manual assignment lets the client place each ticket, and a parallel stream fans the stage's tickets across everyone hired on it at once. The capacity caps apply on every path.",
				},
			],
		},
		{
			id: "review-is-where-money-moves",
			heading: "Review is where the money moves",
			body: [
				{
					type: "p",
					content:
						"In an agile team the review is a meeting. Here it is a decision with consequences. When a client approves a pipeline ticket's work on one stage, that stage's escrow is released and the ticket moves to its next stage. If the next stage has Fund on arrival switched on — the default — its escrow is held straight away from the paying wallet and the freelancer is told they can start.",
				},
				{
					type: "image",
					src: placeholderFigure("Ticket moving between stages"),
					alt:
						"Placeholder for a diagram of one ticket moving from an approved stage into the next, with its escrow released and then held again",
					w: 1200,
					h: 675,
					caption:
						"Approval releases one stage's money and, with Fund on arrival on, holds the next stage's.",
				},
				{
					type: "p",
					content:
						"If that hold cannot be made, the approval still stands and the finished stage is still paid. The ticket simply waits in the next stage as Needs funding until the client clears it. Nobody works ahead of the money.",
				},
			],
		},
		{
			id: "what-you-can-drop",
			heading: "What you can drop",
			body: [
				{
					type: "list",
					items: [
						"The daily stand-up: the board already says who is doing what.",
						"Estimation poker: the client sets each ticket's difficulty, and the freelancer sees it before claiming.",
						"Sprint planning: the stage plan is the plan, and each stage is funded as it starts.",
						"The retrospective as a ritual: each review is a small one, and its outcome is money moving or work coming back.",
					],
				},
				{
					type: "p",
					content: [
						"Keep the habits, drop the calendar. For the money side of the same loop, read ",
						{ type: "link", href: "/articles/no-hold-no-work", text: "No hold, no work" },
						".",
					],
				},
			],
		},
	],
};
