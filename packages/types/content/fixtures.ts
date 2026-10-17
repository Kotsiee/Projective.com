/**
 * content.fixtures — one sample document that exercises every node type, for the editorial
 * consumers' tests (legal, help, changelog, articles) to render.
 *
 * It is also the worked example of the extension pattern: {@link SampleDocSchema} adds an article's
 * `cover` + `author` and a help article's `faq` to the {@link DocSchema} core with `.extend()`.
 *
 * Deliberate traps, each pinned by a test: two sub-headings share the text "An example" (their ids
 * must come out `an-example` and `an-example-2`), one sub-heading pins an explicit id, and a
 * sub-heading's text slugifies to an id a section already owns (`releases` vs the "Releases" h3).
 * It also carries a `kbd` run, a `lower-alpha` ordered list and a definition list.
 *
 * @module
 */
import {
	ContentAuthorSchema,
	ContentImageSchema,
	defineContent,
	DocSchema,
	FaqItemSchema,
} from "./doc.ts";
import { z } from "zod";

// #region Schema
/** The sample's schema: the document core plus a cover, an author and FAQ items. */
export const SampleDocSchema = DocSchema.extend({
	cover: ContentImageSchema,
	author: ContentAuthorSchema,
	faq: z.array(FaqItemSchema),
});
/** A sample document. */
export type SampleDoc = z.infer<typeof SampleDocSchema>;
// #endregion

// #region Sample
/** The sample document. Statements about the product are true of it as shipped. */
export const SAMPLE_DOC: SampleDoc = defineContent(SampleDocSchema, {
	id: "sample-stage-payments",
	slug: "sample-stage-payments",
	title: "How stage payments work",
	summary:
		"A sample editorial document: how money moves through a project's stages, from funding to release.",
	updatedAt: "2026-10-17",
	version: "1.0",
	cover: {
		src: "/test_images/banner_1.jpg",
		alt: "A wide, softly lit workspace with a laptop on a desk",
		w: 643,
		h: 360,
	},
	author: {
		name: "Projective Editorial",
		role: "Product team",
		href: "/about",
		avatar: {
			src: "/test_images/profile_3.jpg",
			alt: "Portrait of the editorial team lead",
			w: 449,
			h: 445,
		},
	},
	faq: [
		{
			question: "When is a stage paid out?",
			answer: [{ type: "p", content: "When the client approves the stage's submitted work." }],
		},
		{
			id: "pending-window",
			question: "Why is my payout pending?",
			answer: [
				{
					type: "p",
					content:
						"Earned money clears a 7-day pending window before it reaches your available balance.",
				},
			],
		},
	],
	sections: [
		{
			id: "overview",
			heading: "Overview",
			tldr: "Money for a stage is held before work starts and released when the stage is approved.",
			body: [
				{
					type: "p",
					content: [
						"Every project is split into ",
						{ type: "strong", text: "stages" },
						". A stage is funded up front, so the freelancer knows the money exists before they ",
						{ type: "em", text: "start" },
						" — see ",
						{ type: "link", href: "/help/escrow", text: "how payment protection works" },
						" or the ",
						{ type: "link", href: "#fees", text: "fees" },
						" below.",
					],
				},
				{
					type: "image",
					src: "https://placehold.co/1200x675?text=Stage+timeline",
					alt: "A timeline of three stages: funded, in progress, approved",
					w: 1200,
					h: 675,
					caption: "Each stage moves from funded to approved on its own.",
				},
				{ type: "h3", text: "An example" },
				{
					type: "list",
					ordered: true,
					items: [
						"The client funds the first stage.",
						{
							content: [
								"The freelancer delivers and ",
								{ type: "code", text: "submits" },
								" the work.",
							],
							list: {
								type: "list",
								items: ["Files are attached to the submission.", "The client is notified."],
							},
						},
						"The client approves, and the stage's money is released.",
					],
				},
				{ type: "h3", text: "An example" },
				{
					type: "quote",
					content: "Knowing the stage was funded meant I could start on day one.",
					cite: "A freelancer on the platform",
				},
			],
		},
		{
			id: "fees",
			heading: "Fees",
			body: [
				{
					type: "table",
					caption: "A £1,000 stage, released",
					rowHeaders: true,
					head: ["Line", "Amount"],
					rows: [
						["Stage price", "£1,000.00"],
						[[{ type: "strong", text: "5%" }, " platform fee"], "£50.00"],
						["Released to the freelancer", "£950.00"],
					],
				},
				{
					type: "callout",
					tone: "important",
					body: [{
						type: "p",
						content: "The platform fee is deducted when a stage's money is released.",
					}],
				},
				{ type: "h3", text: "Worked numbers", id: "worked-numbers" },
				{
					type: "code",
					lang: "text",
					text: "fee      = stage price × 0.05\nreleased = stage price − fee",
				},
			],
		},
		{
			id: "releases",
			heading: "Releases",
			body: [
				{ type: "h3", text: "Releases" },
				{
					type: "callout",
					tone: "tip",
					title: "Before you withdraw",
					body: [
						{
							type: "list",
							items: ["Check your payout details are verified.", "Allow for the pending window."],
						},
					],
				},
				{
					type: "p",
					content: [
						"A stage's money is released when either of these happens (press ",
						{ type: "kbd", text: "Ctrl+/" },
						" to search for the terms):",
					],
				},
				{
					type: "list",
					ordered: true,
					marker: "lower-alpha",
					items: ["the client approves the stage; or", "a Fair Exit settles it."],
				},
				{
					type: "dl",
					items: [
						{ term: "Stage", definition: "One funded unit of a project's work." },
						{
							term: "Release",
							definition: [
								"The moment a stage's money moves to the ",
								{ type: "strong", text: "freelancer" },
								".",
							],
						},
					],
				},
			],
		},
	],
});
// #endregion
