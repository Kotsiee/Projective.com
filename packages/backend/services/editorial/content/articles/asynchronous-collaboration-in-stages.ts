import type { EditorialArticleRecord } from "@projective/types/editorial";
import { COVER_MOUNTAIN_WATCH, placeholderFigure } from "./covers.ts";

/** "Work that keeps moving when nobody is online" — asynchronous collaboration. */
export const ASYNCHRONOUS_COLLABORATION_IN_STAGES: EditorialArticleRecord = {
	slug: "asynchronous-collaboration-in-stages",
	title: "Work that keeps moving when nobody is online",
	standfirst:
		"Most of a project happens while the other person is asleep, in a meeting or simply busy. Here is how to set up a stage so that work, questions and money keep moving without anyone waiting for a call.",
	topics: ["async-collaboration", "team-structure"],
	cover: COVER_MOUNTAIN_WATCH,
	authorSlug: "projective-editorial",
	status: "published",
	publishedAt: "2026-08-26T08:00:00Z",
	updatedAt: "2026-08-26T08:00:00Z",
	sections: [
		{
			id: "the-meeting-is-not-the-work",
			heading: "The meeting is not the work",
			body: [
				{
					type: "p",
					content:
						"Freelance projects rarely fail in the work itself. They fail in the gaps between people: the question that sat unanswered over a weekend, the file that lived in somebody's inbox, the approval that waited for a call nobody could schedule across three time zones.",
				},
				{
					type: "p",
					content:
						"Working asynchronously is not a compromise you make because you cannot meet. It is a way of arranging the work so that nobody has to be online at the same moment for it to move. The arrangement matters more than the tools: a project with ten chat apps and no shared place for decisions is still synchronous, because every answer depends on catching someone.",
				},
				{
					type: "p",
					content: [
						"Projective is built around that arrangement. A project is a run of ",
						{ type: "strong", text: "stages" },
						", and each stage carries everything needed to finish it: a conversation, files, the work handed over for review, the money held for it before anyone starts and, on a larger project, a board.",
					],
				},
			],
		},
		{
			id: "give-every-stage-one-home",
			heading: "Give every stage one home",
			body: [
				{
					type: "p",
					content:
						"The first habit of an asynchronous team is that every piece of information has exactly one place to live. When a decision might be in a chat thread, an email or a call note, everyone has to check all three before acting, and someone always misses one.",
				},
				{
					type: "list",
					items: [
						{
							content: [
								{ type: "strong", text: "The stage's room" },
								" holds the conversation and the decisions made in it.",
							],
						},
						{
							content: [
								{ type: "strong", text: "The board" },
								" shows how the stage is broken down and how far each part has got.",
							],
						},
						{
							content: [
								{ type: "strong", text: "Files" },
								" keeps the references, drafts and assets the stage depends on.",
							],
						},
						{
							content: [
								{ type: "strong", text: "Submissions" },
								" is where finished work is handed over and reviewed.",
							],
						},
					],
				},
				{
					type: "p",
					content:
						"A small engagement keeps it simpler still: a Task, a single deliverable for a single price, has one shared Discussion and no channel tree to navigate. The rule is the same either way. If something matters to the stage, it lives in the stage.",
				},
			],
		},
		{
			id: "write-for-the-reader-who-was-not-there",
			heading: "Write for the reader who was not there",
			body: [
				{
					type: "p",
					content:
						"An asynchronous message is read hours later, by someone switching in from other work. It has to stand on its own. A useful test is whether the reader could act on it without scrolling up.",
				},
				{
					type: "list",
					ordered: true,
					items: [
						"Lead with what you need: a decision, a file, an approval.",
						"Give the context in two sentences, not ten.",
						"Link the ticket, file or submission you are talking about.",
						"Say when you need an answer, and what you will do if none comes.",
					],
				},
				{
					type: "callout",
					tone: "tip",
					title: "One decision per message",
					body: [
						{
							type: "p",
							content:
								"Three questions in one message tend to get one answer. Split them, and each can be answered, quoted and found again on its own.",
						},
					],
				},
			],
		},
		{
			id: "let-the-board-answer-the-status-question",
			heading: "Let the board answer the status question",
			body: [
				{
					type: "p",
					content:
						'"Where are we?" is the most expensive question in a remote project, because it interrupts the person doing the work to report on it. Inside every stage of a one-off or pipeline project is a board where the freelancer breaks the stage into smaller steps — an initial sketch, a colour pass, the export — and moves them as they go. The client sees that progress as it happens, without asking.',
				},
				{
					type: "image",
					src: placeholderFigure("Stage board"),
					alt:
						"Placeholder for a stage board: three columns of task cards moving from to-do to done",
					w: 1200,
					h: 675,
					caption:
						"A stage's board: the work broken into steps, visible to the client as it moves.",
				},
				{
					type: "p",
					content:
						"The project's Overview does the same job one level up. It leads with what needs you — a submission to review, a stage waiting for funding — so a client opening the project after a day away starts with the one thing only they can do.",
				},
			],
		},
		{
			id: "hand-over-work-not-updates",
			heading: "Hand over work, not updates",
			body: [
				{
					type: "p",
					content:
						"The most important asynchronous moment is the handover. On a deliverable stage, the freelancer works through the stage's checklist and attaches what it asks for: files where there are files, proof of action where there are none. The client reviews the submission against that same checklist, at a time that suits them.",
				},
				{
					type: "p",
					content:
						"The review ends in one of two answers. Accepting the submission completes the work and releases its escrow to the freelancer, after one confirmation, because money released is released for good. Requesting a revision sends the work back with the reasons attached. Each free revision round the stage allows is counted, so both sides can see how many are left.",
				},
				{
					type: "quote",
					content:
						"A good handover answers the reviewer's questions before they are asked: what was done, what was not, and what to look at first.",
				},
			],
		},
		{
			id: "keep-calls-for-what-needs-them",
			heading: "Keep calls for what needs them",
			body: [
				{
					type: "p",
					content:
						"Asynchronous does not mean never talking. Some things need a conversation: a first conversation to check fit, a tangled decision with many trade-offs, a person who is stuck. Make those calls deliberate rather than habitual.",
				},
				{
					type: "p",
					content: [
						"A ",
						{ type: "strong", text: "courtesy call" },
						" is booked straight from a freelancer's availability page. It is free, it creates no project and moves no money, and it respects the freelancer's own rules: the working hours they publish, a narrower call window for interruptions, buffers either side and a minimum notice period. Working windows are set in each person's own time zone and shown to the other side in theirs.",
					],
				},
				{
					type: "p",
					content:
						"When the conversation itself is the product — advice, tutoring, a regular check-in — it is a session: booked, paid for and held in escrow like any other stage.",
				},
			],
		},
		{
			id: "a-checklist-for-your-next-stage",
			heading: "A checklist for your next stage",
			body: [
				{
					type: "list",
					items: [
						"Write the stage's checklist before anyone starts, in words a reviewer can tick off.",
						"Agree where decisions are recorded: the stage's room, not a side channel.",
						"Ask for the board to be kept current, and read it before asking for status.",
						"Answer submissions within an agreed number of working days.",
						"Book a call only when a message has failed twice.",
					],
				},
				{
					type: "p",
					content: [
						"None of this needs a new tool. It needs the work to have one home, and the people in it to trust that home. For how stages fit together over a whole project, read ",
						{
							type: "link",
							href: "/articles/agile-delivery-in-stages",
							text: "Agile without the ceremony",
						},
						".",
					],
				},
			],
		},
	],
};
