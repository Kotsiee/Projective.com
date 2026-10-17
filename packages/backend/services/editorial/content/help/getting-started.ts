import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `getting-started` category's articles, in reading order. */

/**
 * What Projective is. Grounded in PRODUCT_SPEC §Features → Stage-Based Projects (stages, escrow,
 * CREATE), §Projects & Services and §Escrow, Wallets & Finance.
 */
const whatIsProjective = helpArticle({
	slug: "what-is-projective",
	category: "getting-started",
	position: 0,
	title: "What is Projective?",
	summary:
		"Projective is a place to hire freelancers and teams, or to work as one, where every project is split into stages and the money for each stage is held safely until the work is approved.",
	roles: ["client", "freelancer", "team", "business"],
	startHere: ["client", "freelancer", "business"],
	related: ["choose-a-project-type", "what-is-escrow", "hire-your-first-freelancer"],
	sections: [
		{
			id: "the-idea",
			heading: "The idea in one minute",
			body: [
				{
					type: "p",
					content:
						"Most freelance work goes wrong in the middle: the brief drifts, nobody is sure what has been paid for, and the person doing the work carries all the risk. Projective breaks every project into stages — a design stage, a build stage, a launch stage — and treats each one as its own small agreement.",
				},
				{
					type: "p",
					content: [
						"Before work on a stage starts, the client's money for it is put in ",
						{ type: "strong", text: "escrow" },
						": Projective holds it, and it belongs to neither side yet. When the client accepts the work, the money is released to the freelancer. Nobody works for free, and nobody pays for work they have not seen.",
					],
				},
			],
		},
		{
			id: "who-it-is-for",
			heading: "Who it is for",
			body: [
				{
					type: "dl",
					items: [
						{
							term: "Client",
							definition:
								"Anyone who hires: post a project, invite people to it, or buy a service a freelancer has packaged up.",
						},
						{
							term: "Freelancer",
							definition:
								"Anyone who works: apply to projects, sell services and digital products, and get paid stage by stage.",
						},
						{
							term: "Team",
							definition:
								"Freelancers who work together under one name, with earnings split between members automatically.",
						},
						{
							term: "Business",
							definition:
								"A company that hires: several colleagues share one wallet, with roles that decide who can hire and who can spend.",
						},
					],
				},
				{
					type: "p",
					content:
						"One account can be more than one of these. A client can become a freelancer at any time, and anyone aged 18 or over can create or join a business.",
				},
			],
		},
		{
			id: "what-a-stage-is-for",
			heading: "What every stage is for",
			body: [
				{
					type: "p",
					content:
						"Each stage is labelled with what it sets out to do, so both sides agree on what “done” means:",
				},
				{
					type: "list",
					items: [
						"Create — making something: a design, code, copy.",
						"Run — keeping something going: hosting, posting, monitoring.",
						"Educate — teaching: tutoring or lessons.",
						"Advise — guidance: a review, a strategy, a second opinion.",
						"Test — checking something works: QA, audits, user tests.",
						"Empower — handing over: documentation, onboarding, training.",
					],
				},
			],
		},
	],
});

/**
 * The three project types. Grounded in PRODUCT_SPEC §Projects & Services → The Three Work Flows
 * (Decisions #117, #143). Read from the code: the create modal (`ProjectCreateModal.tsx`) offers
 * Task · One-off · Pipeline — the spec's Quick-Init table still lists two.
 */
const chooseAProjectType = helpArticle({
	slug: "choose-a-project-type",
	category: "getting-started",
	position: 1,
	title: "Task, One-off or Pipeline: which project type fits?",
	summary:
		"A Task is one deliverable for one price, a One-off is a finite piece of work carried through a few milestone stages, and a Pipeline is a board of tickets for continuous work.",
	roles: ["client", "business"],
	startHere: ["client"],
	related: ["create-a-project", "stages-and-tickets", "what-locks-after-hiring"],
	sections: [
		{
			id: "the-three-types",
			heading: "The three types",
			body: [
				{
					type: "table",
					head: ["Type", "Use it for", "How it looks"],
					rowHeaders: true,
					rows: [
						[
							"Task",
							"One deliverable for one price — a logo, a bug fix, a short article.",
							"One stage holding one ticket, and one shared Discussion room. No timeline or calendar.",
						],
						[
							"One-off",
							"A finite project carried through milestones — a website in design, build and launch stages.",
							"One master ticket moving through a run of stages, shown on a timeline.",
						],
						[
							"Pipeline",
							"Ongoing work that keeps arriving — content production, maintenance, a product backlog.",
							"Many tickets moving through stages on a board.",
						],
					],
				},
			],
		},
		{
			id: "how-to-choose",
			heading: "How to choose",
			body: [
				{
					type: "list",
					items: [
						"If you can describe the whole job in one sentence and pay for it once, choose a Task.",
						"If the job has a clear end but happens in steps you want to approve one at a time, choose a One-off.",
						"If you will keep adding work for weeks or months, choose a Pipeline.",
					],
				},
				{
					type: "callout",
					tone: "note",
					title: "Sessions are sold, not posted",
					body: [
						{
							type: "p",
							content:
								"Live calls, lessons and consultations are sessions. A freelancer packages them as a service, and you book them from their listing — you do not create a session project yourself.",
						},
					],
				},
			],
		},
		{
			id: "changing-your-mind",
			heading: "Changing your mind later",
			body: [
				{
					type: "p",
					content: [
						"You can change a project's type while you are setting it up. Once the first freelancer has joined, the type is fixed, because they agreed to that shape of work. See ",
						{
							type: "link",
							href: "/help/projects-and-stages/what-locks-after-hiring",
							text: "what you can still change after someone is hired",
						},
						".",
					],
				},
			],
		},
	],
});

/**
 * The three discovery paths. Grounded in PRODUCT_SPEC §The Hiring Process → 1. Discovery Paths
 * (applications, invitations — the 48-day re-invitation lockout and the 10-per-10-minutes cap — and
 * Discovery & Courtesy Calls), and §Proposal allowances.
 */
const hireYourFirstFreelancer = helpArticle({
	slug: "hire-your-first-freelancer",
	category: "getting-started",
	position: 2,
	title: "How hiring works: invitations, applications and calls",
	summary:
		"You can invite someone you found on Explore, accept a freelancer who applied to your project, or book a short call first — and every hire is agreed one stage at a time.",
	roles: ["client", "business"],
	startHere: ["client"],
	related: ["invite-people-to-a-stage", "how-stage-funding-works", "create-a-project"],
	sections: [
		{
			id: "three-ways-in",
			heading: "Three ways to start",
			body: [
				{ type: "h3", text: "Invite someone", id: "invite-someone" },
				{
					type: "p",
					content:
						"Find a freelancer or a team on Explore and invite them to a stage of your project. If you wrote an introduction, it opens a conversation with them; they accept or decline the stage.",
				},
				{ type: "h3", text: "Accept an application", id: "accept-an-application" },
				{
					type: "p",
					content:
						"Once your project is published, freelancers can apply to its stages with a short note. You'll find every application under Requests on the project's Members page, with Accept and Reject on each.",
				},
				{ type: "h3", text: "Talk first", id: "talk-first" },
				{
					type: "p",
					content:
						"Many freelancers offer a free courtesy call on their availability page. It is just a conversation: it creates no project, holds no money and commits nobody to anything.",
				},
			],
		},
		{
			id: "one-stage-at-a-time",
			heading: "Hiring happens one stage at a time",
			body: [
				{
					type: "p",
					content:
						"Joining a project never puts someone on every stage. A freelancer holds exactly the stages they were invited to and accepted, at the price set for each stage — so you can bring in a designer for the design stage and a developer for the build.",
				},
			],
		},
		{
			id: "fair-play",
			heading: "Fair-play limits",
			body: [
				{
					type: "list",
					items: [
						"If someone declines your invitation, you can't invite them to the same project again for 48 days.",
						"You can send up to 10 invitations in any 10 minutes, across all your projects.",
						"Freelancers' proposals are paced with a weekly allowance, so the same few people can't apply to everything — which makes your shortlist better.",
					],
				},
			],
		},
	],
});

/**
 * Becoming a freelancer. Grounded in PRODUCT_SPEC §Freelancers & Teams → Additive, Unlockable
 * Personas (Decisions #149, #150) and §Escrow, Wallets & Finance #5 "payout-ready before they earn"
 * (Decision #196); the menu label is `SETUP_STEP_LABEL.become_partner` ("Become a Freelancer").
 */
const startWorkingAsAFreelancer = helpArticle({
	slug: "start-working-as-a-freelancer",
	category: "getting-started",
	position: 3,
	title: "Start working as a freelancer",
	summary:
		"Unlock a freelancer profile from Become a Freelancer, finish the basics of your profile, and get payout-ready — you need a verified identity and payout account before you can take paid work.",
	roles: ["freelancer", "team"],
	startHere: ["freelancer", "team"],
	related: ["get-payout-ready", "claim-and-start-a-ticket", "create-a-team"],
	sections: [
		{
			id: "unlock-the-profile",
			heading: "Unlock your freelancer profile",
			body: [
				{
					type: "p",
					content: [
						"If you signed up to hire, you can still work: open ",
						{ type: "link", href: "/become-partner", text: "Become a Freelancer" },
						" from the account menu. It is free, and you pick between one and ten starting skills. Your reviews and reputation stay with the same account, and you switch between hiring and working from the account menu.",
					],
				},
			],
		},
		{
			id: "go-live",
			heading: "Reach the go-live milestone",
			body: [
				{
					type: "p",
					content:
						"Your profile can go public once it has a photo, a headline, a short story about you and at least three skills. That is enough to publish services and apply to work, even before every section is complete.",
				},
				{
					type: "p",
					content:
						"The ring around your avatar in the account menu shows how complete your profile is, and lists the steps left.",
				},
			],
		},
		{
			id: "get-paid",
			heading: "Get ready to be paid",
			body: [
				{
					type: "callout",
					tone: "important",
					title: "Payout-ready before you earn",
					body: [
						{
							type: "p",
							content: [
								"Before you can apply for paid work, accept an invitation, claim a ticket or join a team, you need a verified identity and a verified payout account. Set both up in ",
								{
									type: "link",
									href: "/settings/verification",
									text: "Settings → Verification & payouts",
								},
								". This is what guarantees that money held for you can always be paid out.",
							],
						},
					],
				},
			],
		},
	],
});

/** Every `getting-started` article. */
export const GETTING_STARTED_ARTICLES: readonly HelpCentreArticle[] = [
	whatIsProjective,
	chooseAProjectType,
	hireYourFirstFreelancer,
	startWorkingAsAFreelancer,
];
