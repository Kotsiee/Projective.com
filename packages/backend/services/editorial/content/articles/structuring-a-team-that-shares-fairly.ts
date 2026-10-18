import type { EditorialArticleRecord } from "@projective/types/editorial";
import { COVER_RED_MOON, placeholderFigure } from "./covers.ts";

/** "How to structure a team that shares fairly" — team structure. */
export const STRUCTURING_A_TEAM_THAT_SHARES_FAIRLY: EditorialArticleRecord = {
	slug: "structuring-a-team-that-shares-fairly",
	title: "How to structure a team that shares fairly",
	standfirst:
		"A team on Projective is a group of freelancers who take on work under one name, without forming a company or opening a joint account. The hard part is not the paperwork. It is agreeing, before the first payment, who gets what.",
	topics: ["team-structure", "value-pricing"],
	cover: COVER_RED_MOON,
	authorSlug: "projective-editorial",
	status: "published",
	publishedAt: "2026-09-23T08:00:00Z",
	updatedAt: "2026-09-23T08:00:00Z",
	sections: [
		{
			id: "a-team-without-a-company",
			heading: "A team without a company",
			body: [
				{
					type: "p",
					content:
						"Freelancers have always teamed up. What usually stops them is the overhead: someone has to invoice the client, hold the money and pay everyone else, and that person carries the tax, the risk and the awkward conversations. A Projective team removes that role. The team applies, is hired and is paid as one entity, and each payment is split to its members the moment it is released.",
				},
				{
					type: "p",
					content:
						"Starting one is deliberately light. A team needs a name and a unique @handle, and it begins as a draft. Branding, roles, the split and invitations come afterwards, from the team's console. It can only apply for work once it is published and has at least two members, and every member with a share of its earnings must be ready to be paid — identity checked and a payout account on file — before the team is seated on a stage.",
				},
			],
		},
		{
			id: "decide-the-split-before-the-work",
			heading: "Decide the split before the work",
			body: [
				{
					type: "p",
					content:
						"Money arguments inside a team almost never come from a bad split. They come from a split that was never agreed, or was agreed in a chat nobody can find. On Projective the split is a stored rule, and it is applied automatically to every release: part can go to the team's own vault, and the rest to members' personal wallets.",
				},
				{
					type: "table",
					head: ["Template", "How a release is divided", "Available on"],
					rows: [
						[
							"Co-op",
							"An optional vault cut, then the remainder shared equally by every member",
							"Every team plan",
						],
						[
							"Finder's fee",
							"A fixed percentage to the member who brought the work in, the remainder split",
							"Pro Team",
						],
						[
							"Benevolent dictator",
							"Everything to the team vault, distributed by an admin",
							"Pro Team",
						],
					],
					caption: "The three split templates a team can choose.",
					rowHeaders: true,
				},
				{
					type: "callout",
					tone: "note",
					title: "A worked example",
					body: [
						{
							type: "p",
							content:
								"A three-person co-op with a 10% vault cut completes a £2,000 stage. The 5% service fee (£100) comes off at release, leaving £1,900. The vault takes £190 and each member receives £570.",
						},
					],
				},
				{
					type: "p",
					content:
						"Changing the split does not rewrite history. Saving a new template retires the old one and keeps it on record, so a team always has exactly one active rule and an audit trail of every rule it has had.",
				},
			],
		},
		{
			id: "roles-are-permissions-not-titles",
			heading: "Roles are permissions, not titles",
			body: [
				{
					type: "p",
					content:
						"Every team has exactly one owner. Others join as admins or members, or under custom roles the team defines. What matters about a role is not its name but what it allows: inviting people, managing the split, or committing the team to paid work.",
				},
				{
					type: "p",
					content:
						"That last permission deserves the most care. Only someone allowed to commit the team — the owner, an admin, or a lead the team has trusted with it — can apply for a stage on the team's behalf. An ordinary member cannot sign everyone up for a project, however good it looks.",
				},
			],
		},
		{
			id: "staff-stages-not-people",
			heading: "Staff stages, not people",
			body: [
				{
					type: "p",
					content:
						"A client builds a stage with seats, each with a role: architecture, implementation, testing. A team can take one seat as a single unit, or several, and decide internally who does what. Three patterns cover most teams:",
				},
				{
					type: "list",
					items: [
						{
							content: [
								{ type: "strong", text: "Solo stage" },
								" — one member owns the whole stage.",
							],
						},
						{
							content: [
								{ type: "strong", text: "Sequential handover" },
								" — one member designs, the next builds, the next tests.",
							],
						},
						{
							content: [
								{ type: "strong", text: "Collaborative stage" },
								" — several members work the same stage's tickets in parallel.",
							],
						},
					],
				},
				{
					type: "image",
					src: placeholderFigure("Stage seats"),
					alt:
						"Placeholder for a stage with three seats — architecture, implementation and testing — one of them held by a team",
					w: 1200,
					h: 675,
					caption: "A stage staffed by seat: a team can hold one seat as a unit, or several.",
				},
				{
					type: "p",
					content:
						"Workload is measured per ticket, not per seat. Being seated on a stage adds nothing to anyone's workload; the caps on how much a person may hold at once bite only when a ticket is claimed or assigned. So a team can say yes to a stage without anyone overcommitting before the work is actually handed out.",
				},
			],
		},
		{
			id: "when-members-change",
			heading: "When members change",
			body: [
				{
					type: "p",
					content:
						"People leave teams. When they do, their membership is marked as left rather than deleted, so the record of what they worked on and were paid stays intact, and anyone who returns is reactivated by a new invitation rather than added twice.",
				},
				{
					type: "p",
					content:
						"The owner can never simply walk away: ownership moves only by transfer to another active member. And a team cannot be archived while money is still held in escrow for work it owes, so nobody can dissolve a team to escape a stage in progress.",
				},
			],
		},
		{
			id: "a-structure-to-start-from",
			heading: "A structure to start from",
			body: [
				{
					type: "list",
					ordered: true,
					items: [
						"Start as a co-op with a small vault cut for shared costs; move to a finder's fee only once one person is reliably bringing in the work.",
						"Give the right to commit the team to one or two people, and say so in the team's description.",
						"Agree, in writing inside the team, how members choose tickets on a collaborative stage.",
						"Make sure every member is ready to be paid before you apply for anything.",
					],
				},
				{
					type: "p",
					content: [
						"How the team prices its work is the other half of fairness. ",
						{
							type: "link",
							href: "/articles/price-the-outcome-not-the-hour",
							text: "Price the outcome, not the hour",
						},
						" covers it.",
					],
				},
			],
		},
	],
};
