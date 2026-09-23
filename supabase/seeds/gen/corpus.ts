/**
 * corpus.ts — the discovery corpus the development seed publishes: services, digital products and
 * articles, with the rich content their listing pages render (stage plans, team roles, session
 * formats, intake questions, file manifests, specification ledgers, licences, article bodies).
 *
 * SEED-ONLY DATA. Nothing in `apps/` or `packages/` imports this — the running app reads these rows
 * back out of Postgres (`marketplace.service_blueprints`, `catalogue.*`). It was frozen once from the
 * retired runtime fixtures (2026-09-22) so the seeded marketplace keeps the listings the product was
 * designed against; it is now edited here, as data.
 *
 * Every `key` is a stable SEED key (the old corpus id), used only to derive deterministic database ids
 * and slugs. It is never a public address — the app routes on the minted `svc-` / `prd-` / `art-`
 * slugs. Money is integer MINOR units. Images are `test_images/` filenames, uploaded into Storage by
 * the generator; there is no external URL anywhere in this file.
 *
 * Regenerating the SQL after an edit: `deno task db:seed:generate`.
 */

import type { IntakeField } from "@projective/types/services";

// #region Types
/** One stage in a Pipeline / One-Off service's template (`service_blueprints.stage_template`). */
export interface CorpusStage {
	name: string;
	description: string;
	deliverables: string[];
	turnaround?: string;
	/** Standard per-ticket price (Pipeline) or fixed milestone amount (One-Off), minor units. */
	priceMinor: number;
	/** Skill LABELS as the seller wrote them on the stage (rendered verbatim). */
	skills: string[];
}

export interface CorpusService {
	key: string;
	owner: string;
	title: string;
	summary: string;
	category: string;
	delivery: string;
	model: "pipeline" | "one_off" | "direct_deliverable" | "session" | "group_session";
	priceMinor: number;
	currency: string;
	ticketPriceMinor?: number;
	sessionPriceMinor?: number;
	freeRevisions?: number;
	extraRevisionPriceMinor?: number;
	sponsored: boolean;
	/** `org.skills` slugs (`world.ts` SKILLS) — seeded into `catalogue.listing_skills`. */
	skills: string[];
	seatsPerSession?: number;
	sessionMinutes?: number;
	sessionCount?: number;
	stages: CorpusStage[];
	teamRoles: Array<{ name: string; summary: string; skills: string[]; count: number }>;
	deliverables: string[];
	intake: IntakeField[];
}

export interface CorpusProduct {
	key: string;
	owner: string;
	title: string;
	summary: string;
	category: string;
	priceMinor: number;
	currency: string;
	span: 1 | 2 | 3;
	sponsored: boolean;
	/** `org.skills` slugs — seeded into `catalogue.listing_skills`. */
	skills: string[];
	/** `catalogue.product_format`. */
	format: string;
	files: Array<{ name: string; label: string; extension: string; bytes: number }>;
	specs: Array<{ label: string; value: string }>;
	compatibility: Array<{ app: string; versions: string }>;
	licence: "standard" | "extended";
	attributionRequired: boolean;
}

export type CorpusArticleBlock =
	| { type: "heading" | "subheading"; id?: string; text?: string }
	| { type: "paragraph" | "quote"; text?: string }
	| { type: "list"; items?: string[] }
	| { type: "image"; asset: string; alt?: string; caption?: string };

export interface CorpusArticle {
	key: string;
	owner: string;
	title: string;
	summary: string;
	topic: string;
	readMinutes: number;
	/** `test_images/` filename for the cover. */
	cover: string;
	blocks: CorpusArticleBlock[];
}
// #endregion

export const SERVICES: CorpusService[] = [
	{
		"key": "sv-brand-identity-sprint",
		"owner": "@ateliernova",
		"title": "Brand identity sprint",
		"summary":
			"A staged identity system — discovery, concept routes, and a final kit with a Webflow handoff.",
		"category": "branding",
		"delivery": "10-day delivery",
		"model": "pipeline",
		"priceMinor": 480000,
		"currency": "USD",
		"ticketPriceMinor": 24000,
		"freeRevisions": 2,
		"extraRevisionPriceMinor": 12000,
		"sponsored": true,
		"skills": [
			"branding",
			"identity-systems",
			"typography",
			"art-direction",
		],
		"stages": [
			{
				"name": "Discovery & scope",
				"description":
					"Kick off Brand identity sprint: align on the scope, the success criteria, and the plan every following stage delivers against.",
				"deliverables": [
					"Agreed scope & success criteria",
					"Kickoff notes and a delivery timeline",
				],
				"turnaround": "~3 days",
				"priceMinor": 26000,
				"skills": [
					"Branding",
					"Identity systems",
					"Typography",
				],
			},
			{
				"name": "Design & build",
				"description":
					"The core of the engagement — brand identity sprint takes shape here as reviewable, on-brief output.",
				"deliverables": [
					"First-round output for review",
					"Working source files",
				],
				"turnaround": "~3 days",
				"priceMinor": 26000,
				"skills": [
					"Branding",
					"Identity systems",
					"Typography",
				],
			},
			{
				"name": "Review & revisions",
				"description":
					"Refine and revise: your feedback is folded in across the agreed revision rounds until the bar is met.",
				"deliverables": [
					"Feedback folded in across the agreed revision rounds",
					"Consolidated change log",
				],
				"turnaround": "~1 week",
				"priceMinor": 24000,
				"skills": [
					"Branding",
					"Identity systems",
					"Typography",
				],
			},
			{
				"name": "Handoff & launch",
				"description":
					"Wrap up and hand over — production-ready files, documentation, and everything you need to launch.",
				"deliverables": [
					"Production-ready final files",
					"Handoff guide & asset package",
				],
				"turnaround": "~2 days",
				"priceMinor": 20000,
				"skills": [
					"Branding",
					"Identity systems",
					"Typography",
				],
			},
		],
		"teamRoles": [],
		"deliverables": [
			"Brand strategy and positioning summary",
			"Logo suite with clear-space and minimum-size rules",
			"Colour and typography system",
			"Brand guidelines document (PDF)",
			"Webflow-ready asset kit",
		],
		"intake": [
			{
				"id": "platforms",
				"kind": "pills",
				"label": "Target platforms",
				"required": false,
				"options": [
					{
						"value": "web",
						"label": "Web",
					},
					{
						"value": "ios",
						"label": "iOS",
					},
					{
						"value": "android",
						"label": "Android",
					},
					{
						"value": "print",
						"label": "Print",
					},
				],
				"multiple": true,
				"maxSelections": 3,
				"slider": false,
			},
			{
				"id": "depth",
				"kind": "radio",
				"label": "How deep should this go?",
				"required": true,
				"options": [
					{
						"value": "light",
						"label": "Light touch",
						"hint": "Polish what exists.",
					},
					{
						"value": "standard",
						"label": "Standard",
						"hint": "A proper pass with revisions.",
					},
					{
						"value": "deep",
						"label": "Deep",
						"hint": "Rethink it from the ground up.",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "brand",
				"kind": "boolean",
				"label": "Do you have brand guidelines?",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-design-system-foundation",
		"owner": "@marisdelacroix",
		"title": "Design-system foundation",
		"summary":
			"Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.",
		"category": "product",
		"delivery": "2-week delivery",
		"model": "pipeline",
		"priceMinor": 320000,
		"currency": "USD",
		"ticketPriceMinor": 18000,
		"freeRevisions": 0,
		"extraRevisionPriceMinor": 9000,
		"sponsored": false,
		"skills": [
			"design-systems",
			"figma",
			"a11y",
			"typography",
		],
		"stages": [
			{
				"name": "Discovery & scope",
				"description":
					"Kick off Design-system foundation: align on the scope, the success criteria, and the plan every following stage delivers against.",
				"deliverables": [
					"Agreed scope & success criteria",
					"Kickoff notes and a delivery timeline",
				],
				"turnaround": "~3 days",
				"priceMinor": 20000,
				"skills": [
					"Design systems",
					"Figma",
					"Accessibility",
				],
			},
			{
				"name": "Design & build",
				"description":
					"The core of the engagement — design-system foundation takes shape here as reviewable, on-brief output.",
				"deliverables": [
					"First-round output for review",
					"Working source files",
				],
				"turnaround": "~4 days",
				"priceMinor": 16000,
				"skills": [
					"Design systems",
					"Figma",
					"Accessibility",
				],
			},
			{
				"name": "Review & revisions",
				"description":
					"Refine and revise: your feedback is folded in across the agreed revision rounds until the bar is met.",
				"deliverables": [
					"Feedback folded in across the agreed revision rounds",
					"Consolidated change log",
				],
				"turnaround": "~1 week",
				"priceMinor": 18000,
				"skills": [
					"Design systems",
					"Figma",
					"Accessibility",
				],
			},
			{
				"name": "Handoff & launch",
				"description":
					"Wrap up and hand over — production-ready files, documentation, and everything you need to launch.",
				"deliverables": [
					"Production-ready final files",
					"Handoff guide & asset package",
				],
				"turnaround": "~4 days",
				"priceMinor": 16000,
				"skills": [
					"Design systems",
					"Figma",
					"Accessibility",
				],
			},
		],
		"teamRoles": [],
		"deliverables": [
			"Design token architecture — colour, type, spacing and radius",
			"Core component library in Figma",
			"Theming contract for light and dark modes",
			"Accessibility checklist for every component",
			"Adoption guide for engineers",
		],
		"intake": [
			{
				"id": "goal",
				"kind": "textarea",
				"label": "What outcome are you after?",
				"hint": "One or two sentences is plenty — the brief below carries the detail.",
				"required": true,
				"options": [],
				"multiple": false,
				"slider": false,
				"maxLength": 600,
			},
			{
				"id": "deadline",
				"kind": "select",
				"label": "When do you need it?",
				"required": true,
				"options": [
					{
						"value": "asap",
						"label": "As soon as possible",
					},
					{
						"value": "2w",
						"label": "Within two weeks",
					},
					{
						"value": "1m",
						"label": "Within a month",
					},
					{
						"value": "flex",
						"label": "Flexible",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "depth",
				"kind": "radio",
				"label": "How deep should this go?",
				"required": true,
				"options": [
					{
						"value": "light",
						"label": "Light touch",
						"hint": "Polish what exists.",
					},
					{
						"value": "standard",
						"label": "Standard",
						"hint": "A proper pass with revisions.",
					},
					{
						"value": "deep",
						"label": "Deep",
						"hint": "Rethink it from the ground up.",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "formats",
				"kind": "checkboxes",
				"label": "Formats you need back",
				"required": false,
				"options": [
					{
						"value": "figma",
						"label": "Figma file",
					},
					{
						"value": "pdf",
						"label": "PDF export",
					},
					{
						"value": "source",
						"label": "Source files",
					},
				],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-landing-page-in-a-week",
		"owner": "@juno",
		"title": "Landing page in a week",
		"summary":
			"One high-converting landing page — copy polish, responsive build, and analytics wired in five days.",
		"category": "web",
		"delivery": "5-day delivery",
		"model": "one_off",
		"priceMinor": 240000,
		"currency": "USD",
		"freeRevisions": 1,
		"extraRevisionPriceMinor": 18000,
		"sponsored": false,
		"skills": [
			"figma",
			"prototyping",
			"preact",
			"typescript",
		],
		"stages": [
			{
				"name": "Kickoff & scope",
				"description":
					"Kick off Landing page in a week: align on the scope, the success criteria, and the plan every following stage delivers against.",
				"deliverables": [
					"Agreed scope & success criteria",
					"Kickoff notes and a delivery timeline",
				],
				"turnaround": "~3 days",
				"priceMinor": 80000,
				"skills": [
					"Figma",
					"Prototyping",
					"Preact",
				],
			},
			{
				"name": "Production",
				"description":
					"The core of the engagement — landing page in a week takes shape here as reviewable, on-brief output.",
				"deliverables": [
					"First-round output for review",
					"Working source files",
				],
				"turnaround": "~3 days",
				"priceMinor": 80000,
				"skills": [
					"Figma",
					"Prototyping",
					"Preact",
				],
			},
			{
				"name": "Final handoff",
				"description":
					"Wrap up and hand over — production-ready files, documentation, and everything you need to launch.",
				"deliverables": [
					"Production-ready final files",
					"Handoff guide & asset package",
				],
				"turnaround": "~5 days",
				"priceMinor": 80000,
				"skills": [
					"Figma",
					"Prototyping",
					"Preact",
				],
			},
		],
		"teamRoles": [],
		"deliverables": [
			"Responsive landing page, built and deployed",
			"Figma source for every section",
			"Copy and SEO metadata pass",
			"Analytics and form wiring",
			"One round of post-launch fixes",
		],
		"intake": [
			{
				"id": "screens",
				"kind": "number",
				"label": "Screens or pages",
				"hint": "A rough count is fine.",
				"required": false,
				"options": [],
				"multiple": false,
				"min": 1,
				"max": 40,
				"step": 1,
				"unit": "screens",
				"slider": true,
			},
			{
				"id": "platforms",
				"kind": "pills",
				"label": "Target platforms",
				"required": false,
				"options": [
					{
						"value": "web",
						"label": "Web",
					},
					{
						"value": "ios",
						"label": "iOS",
					},
					{
						"value": "android",
						"label": "Android",
					},
					{
						"value": "print",
						"label": "Print",
					},
				],
				"multiple": true,
				"maxSelections": 3,
				"slider": false,
			},
			{
				"id": "depth",
				"kind": "radio",
				"label": "How deep should this go?",
				"required": true,
				"options": [
					{
						"value": "light",
						"label": "Light touch",
						"hint": "Polish what exists.",
					},
					{
						"value": "standard",
						"label": "Standard",
						"hint": "A proper pass with revisions.",
					},
					{
						"value": "deep",
						"label": "Deep",
						"hint": "Rethink it from the ground up.",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "formats",
				"kind": "checkboxes",
				"label": "Formats you need back",
				"required": false,
				"options": [
					{
						"value": "figma",
						"label": "Figma file",
					},
					{
						"value": "pdf",
						"label": "PDF export",
					},
					{
						"value": "source",
						"label": "Source files",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "brand",
				"kind": "boolean",
				"label": "Do you have brand guidelines?",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-realtime-mvp-build",
		"owner": "@northloop",
		"title": "Realtime MVP build",
		"summary":
			"A working realtime product MVP on Deno + Postgres, shipped in weekly milestones you sign off.",
		"category": "product",
		"delivery": "4-week delivery",
		"model": "pipeline",
		"priceMinor": 950000,
		"currency": "USD",
		"ticketPriceMinor": 32000,
		"freeRevisions": 2,
		"extraRevisionPriceMinor": 0,
		"sponsored": false,
		"skills": [
			"deno",
			"postgres",
			"realtime",
			"typescript",
		],
		"stages": [
			{
				"name": "Discovery & scope",
				"description":
					"Kick off Realtime MVP build: align on the scope, the success criteria, and the plan every following stage delivers against.",
				"deliverables": [
					"Agreed scope & success criteria",
					"Kickoff notes and a delivery timeline",
				],
				"turnaround": "~1 week",
				"priceMinor": 32000,
				"skills": [
					"Deno",
					"Postgres",
					"Realtime systems",
				],
			},
			{
				"name": "Design & build",
				"description":
					"The core of the engagement — realtime mvp build takes shape here as reviewable, on-brief output.",
				"deliverables": [
					"First-round output for review",
					"Working source files",
				],
				"turnaround": "~2 days",
				"priceMinor": 26000,
				"skills": [
					"Deno",
					"Postgres",
					"Realtime systems",
				],
			},
			{
				"name": "Review & revisions",
				"description":
					"Refine and revise: your feedback is folded in across the agreed revision rounds until the bar is met.",
				"deliverables": [
					"Feedback folded in across the agreed revision rounds",
					"Consolidated change log",
				],
				"turnaround": "~1 week",
				"priceMinor": 32000,
				"skills": [
					"Deno",
					"Postgres",
					"Realtime systems",
				],
			},
			{
				"name": "Handoff & launch",
				"description":
					"Wrap up and hand over — production-ready files, documentation, and everything you need to launch.",
				"deliverables": [
					"Production-ready final files",
					"Handoff guide & asset package",
				],
				"turnaround": "~1 week",
				"priceMinor": 32000,
				"skills": [
					"Deno",
					"Postgres",
					"Realtime systems",
				],
			},
		],
		"teamRoles": [],
		"deliverables": [
			"Deno and Postgres backend with realtime channels",
			"Authentication and row-level security policies",
			"Typed API client",
			"Load-test report",
			"Deployment runbook",
		],
		"intake": [
			{
				"id": "screens",
				"kind": "number",
				"label": "Screens or pages",
				"hint": "A rough count is fine.",
				"required": false,
				"options": [],
				"multiple": false,
				"min": 1,
				"max": 40,
				"step": 1,
				"unit": "screens",
				"slider": true,
			},
			{
				"id": "platforms",
				"kind": "pills",
				"label": "Target platforms",
				"required": false,
				"options": [
					{
						"value": "web",
						"label": "Web",
					},
					{
						"value": "ios",
						"label": "iOS",
					},
					{
						"value": "android",
						"label": "Android",
					},
					{
						"value": "print",
						"label": "Print",
					},
				],
				"multiple": true,
				"maxSelections": 3,
				"slider": false,
			},
			{
				"id": "depth",
				"kind": "radio",
				"label": "How deep should this go?",
				"required": true,
				"options": [
					{
						"value": "light",
						"label": "Light touch",
						"hint": "Polish what exists.",
					},
					{
						"value": "standard",
						"label": "Standard",
						"hint": "A proper pass with revisions.",
					},
					{
						"value": "deep",
						"label": "Deep",
						"hint": "Rethink it from the ground up.",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "brand",
				"kind": "boolean",
				"label": "Do you have brand guidelines?",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-product-launch-film",
		"owner": "@renkoda",
		"title": "Product launch film",
		"summary":
			"A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.",
		"category": "motion",
		"delivery": "3-week delivery",
		"model": "one_off",
		"priceMinor": 610000,
		"currency": "USD",
		"freeRevisions": 2,
		"extraRevisionPriceMinor": 24000,
		"sponsored": false,
		"skills": [
			"motion-design",
			"webgl",
			"blender",
			"art-direction",
		],
		"stages": [
			{
				"name": "Kickoff & scope",
				"description":
					"Kick off Product launch film: align on the scope, the success criteria, and the plan every following stage delivers against.",
				"deliverables": [
					"Agreed scope & success criteria",
					"Kickoff notes and a delivery timeline",
				],
				"turnaround": "~3 days",
				"priceMinor": 203000,
				"skills": [
					"Motion design",
					"WebGL",
					"Blender",
				],
			},
			{
				"name": "Production",
				"description":
					"The core of the engagement — product launch film takes shape here as reviewable, on-brief output.",
				"deliverables": [
					"First-round output for review",
					"Working source files",
				],
				"turnaround": "~1 week",
				"priceMinor": 203000,
				"skills": [
					"Motion design",
					"WebGL",
					"Blender",
				],
			},
			{
				"name": "Final handoff",
				"description":
					"Wrap up and hand over — production-ready files, documentation, and everything you need to launch.",
				"deliverables": [
					"Production-ready final files",
					"Handoff guide & asset package",
				],
				"turnaround": "~2 days",
				"priceMinor": 203000,
				"skills": [
					"Motion design",
					"WebGL",
					"Blender",
				],
			},
		],
		"teamRoles": [],
		"deliverables": [
			"60–90 second launch film, 4K master",
			"Cut-downs for social in 9:16 and 1:1",
			"Storyboard and style frames",
			"Licensed music and sound design",
		],
		"intake": [
			{
				"id": "goal",
				"kind": "textarea",
				"label": "What outcome are you after?",
				"hint": "One or two sentences is plenty — the brief below carries the detail.",
				"required": true,
				"options": [],
				"multiple": false,
				"slider": false,
				"maxLength": 600,
			},
			{
				"id": "depth",
				"kind": "radio",
				"label": "How deep should this go?",
				"required": true,
				"options": [
					{
						"value": "light",
						"label": "Light touch",
						"hint": "Polish what exists.",
					},
					{
						"value": "standard",
						"label": "Standard",
						"hint": "A proper pass with revisions.",
					},
					{
						"value": "deep",
						"label": "Deep",
						"hint": "Rethink it from the ground up.",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "formats",
				"kind": "checkboxes",
				"label": "Formats you need back",
				"required": false,
				"options": [
					{
						"value": "figma",
						"label": "Figma file",
					},
					{
						"value": "pdf",
						"label": "PDF export",
					},
					{
						"value": "source",
						"label": "Source files",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "brand",
				"kind": "boolean",
				"label": "Do you have brand guidelines?",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-portfolio-review-session",
		"owner": "@studiofern",
		"title": "Live portfolio review",
		"summary":
			"A booked 1:1 call — a working editor walks your portfolio and leaves a written action plan.",
		"category": "content",
		"delivery": "60-minute session",
		"model": "session",
		"priceMinor": 18000,
		"currency": "USD",
		"sessionPriceMinor": 18000,
		"sponsored": false,
		"skills": [
			"mentoring",
			"editorial-design",
			"typography",
		],
		"sessionMinutes": 60,
		"sessionCount": 1,
		"stages": [],
		"teamRoles": [],
		"deliverables": [
			"60-minute live review call",
			"Written action plan within 48 hours",
			"A prioritised list of pieces to cut, keep and rework",
		],
		"intake": [
			{
				"id": "recording",
				"kind": "boolean",
				"label": "Record the session for me",
				"hint": "You get the recording afterwards; it is never shared.",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "brand",
				"kind": "boolean",
				"label": "Do you have brand guidelines?",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-design-mentorship-block",
		"owner": "@studiofern",
		"title": "Design mentorship block",
		"summary":
			"Six fortnightly 1:1s with a senior product designer — portfolio, craft, and the career conversation nobody schedules.",
		"category": "product",
		"delivery": "6 × 45-minute sessions",
		"model": "session",
		"priceMinor": 96000,
		"currency": "USD",
		"sessionPriceMinor": 16000,
		"sponsored": false,
		"skills": [
			"mentoring",
			"ux",
			"design-systems",
		],
		"sessionMinutes": 45,
		"sessionCount": 6,
		"stages": [],
		"teamRoles": [],
		"deliverables": [
			"Six 45-minute one-to-one sessions",
			"A growth plan agreed in the first session",
			"Async feedback on work between sessions",
			"Notes after every call",
		],
		"intake": [
			{
				"id": "topics",
				"kind": "multiselect",
				"label": "What should we cover?",
				"required": true,
				"options": [
					{
						"value": "portfolio",
						"label": "Portfolio review",
					},
					{
						"value": "process",
						"label": "Process and tooling",
					},
					{
						"value": "career",
						"label": "Career direction",
					},
					{
						"value": "critique",
						"label": "Critique of one piece",
					},
				],
				"multiple": false,
				"maxSelections": 3,
				"slider": false,
			},
			{
				"id": "brand",
				"kind": "boolean",
				"label": "Do you have brand guidelines?",
				"required": false,
				"options": [],
				"multiple": false,
				"slider": false,
			},
		],
	},
	{
		"key": "sv-packaging-art-direction",
		"owner": "@renkoda",
		"title": "Packaging art direction",
		"summary":
			"A single, self-contained packaging scope: art direction, dielines, and print-ready files from a defined team.",
		"category": "branding",
		"delivery": "7-day delivery",
		"model": "direct_deliverable",
		"priceMinor": 190000,
		"currency": "USD",
		"freeRevisions": 3,
		"extraRevisionPriceMinor": 6000,
		"sponsored": false,
		"skills": [
			"art-direction",
			"branding",
			"illustration",
		],
		"stages": [],
		"teamRoles": [
			{
				"name": "Lead Designer",
				"summary": "Owns the direction and signs off the final deliverable.",
				"skills": [
					"branding",
					"design",
				],
				"count": 1,
			},
			{
				"name": "Brand Strategist",
				"summary": "Frames the approach and positioning the work delivers against.",
				"skills": [
					"design",
					"branding",
				],
				"count": 1,
			},
			{
				"name": "Production Artist",
				"summary": "Produces their part of the agreed scope to spec.",
				"skills": [
					"branding",
					"design",
				],
				"count": 1,
			},
		],
		"deliverables": [
			"Three packaging concept routes",
			"Final artwork for one SKU family",
			"Print-ready dielines and colour specifications",
			"Supplier handoff pack",
		],
		"intake": [
			{
				"id": "deadline",
				"kind": "select",
				"label": "When do you need it?",
				"required": true,
				"options": [
					{
						"value": "asap",
						"label": "As soon as possible",
					},
					{
						"value": "2w",
						"label": "Within two weeks",
					},
					{
						"value": "1m",
						"label": "Within a month",
					},
					{
						"value": "flex",
						"label": "Flexible",
					},
				],
				"multiple": false,
				"slider": false,
			},
			{
				"id": "screens",
				"kind": "number",
				"label": "Screens or pages",
				"hint": "A rough count is fine.",
				"required": false,
				"options": [],
				"multiple": false,
				"min": 1,
				"max": 40,
				"step": 1,
				"unit": "screens",
				"slider": true,
			},
			{
				"id": "platforms",
				"kind": "pills",
				"label": "Target platforms",
				"required": false,
				"options": [
					{
						"value": "web",
						"label": "Web",
					},
					{
						"value": "ios",
						"label": "iOS",
					},
					{
						"value": "android",
						"label": "Android",
					},
					{
						"value": "print",
						"label": "Print",
					},
				],
				"multiple": true,
				"maxSelections": 3,
				"slider": false,
			},
			{
				"id": "reference",
				"kind": "text",
				"label": "A link to your current site or file",
				"required": false,
				"placeholder": "https://…",
				"options": [],
				"multiple": false,
				"slider": false,
				"maxLength": 300,
			},
		],
	},
	{
		"key": "sv-design-systems-workshop",
		"owner": "@marisdelacroix",
		"title": "Design systems workshop",
		"summary":
			"A live, multi-seat workshop: build a token-driven design system alongside a small cohort, seats sold per attendee.",
		"category": "product",
		"delivery": "2-hour class",
		"model": "group_session",
		"priceMinor": 9000,
		"currency": "USD",
		"sessionPriceMinor": 9000,
		"sponsored": false,
		"skills": [
			"design-systems",
			"figma",
			"mentoring",
		],
		"seatsPerSession": 16,
		"sessionMinutes": 120,
		"stages": [],
		"teamRoles": [],
		"deliverables": [
			"A live two-hour group class",
			"Workshop slides and exercise files",
			"Recording of the session",
			"A follow-up Q&A thread",
		],
		"intake": [],
	},
];

export const PRODUCTS: CorpusProduct[] = [
	{
		"key": "pr-aurora-ui-kit",
		"owner": "@ateliernova",
		"title": "Aurora UI kit",
		"summary": "Aurora UI kit — a ready-to-buy download from Atelier Nova.",
		"category": "ui-kit",
		"priceMinor": 7900,
		"currency": "USD",
		"span": 3,
		"sponsored": true,
		"skills": [
			"figma",
			"design-systems",
			"prototyping",
		],
		"format": "source_code",
		"files": [
			{
				"name": "aurora-ui-kit.zip",
				"label": "Source bundle",
				"extension": ".zip",
				"bytes": 12582912,
			},
			{
				"name": "aurora-ui-kit.ts",
				"label": "Typed entry points",
				"extension": ".ts",
				"bytes": 1048576,
			},
			{
				"name": "aurora-ui-kit.md",
				"label": "Integration guide",
				"extension": ".md",
				"bytes": 1048576,
			},
		],
		"specs": [
			{
				"label": "Language",
				"value": "TypeScript (strict)",
			},
			{
				"label": "Runtime",
				"value": "Deno 2.x, Node 20+",
			},
			{
				"label": "Dependencies",
				"value": "Zero runtime dependencies",
			},
			{
				"label": "Tests",
				"value": "50 unit tests included",
			},
		],
		"compatibility": [
			{
				"app": "Deno",
				"versions": "2.x",
			},
			{
				"app": "Node.js",
				"versions": "20 LTS and later",
			},
			{
				"app": "TypeScript",
				"versions": "5.4 and later",
			},
		],
		"licence": "extended",
		"attributionRequired": false,
	},
	{
		"key": "pr-grain-lightroom-pack",
		"owner": "@renkoda",
		"title": "Grain — Lightroom pack",
		"summary": "Grain — Lightroom pack — a ready-to-buy download from Ren Koda.",
		"category": "presets",
		"priceMinor": 2400,
		"currency": "USD",
		"span": 1,
		"sponsored": false,
		"skills": [
			"art-direction",
		],
		"format": "preset",
		"files": [
			{
				"name": "grain-lightroom-pack.cube",
				"label": "3D LUT",
				"extension": ".cube",
				"bytes": 2097152,
			},
			{
				"name": "grain-lightroom-pack.aep",
				"label": "After Effects project",
				"extension": ".aep",
				"bytes": 154140672,
			},
			{
				"name": "grain-lightroom-pack.mov",
				"label": "ProRes preview",
				"extension": ".mov",
				"bytes": 321912832,
			},
		],
		"specs": [
			{
				"label": "Colour space",
				"value": "Rec.709 with Log-to-Rec conversion included",
			},
			{
				"label": "Presets included",
				"value": "13 looks",
			},
			{
				"label": "Resolution",
				"value": "Resolution-independent (tested to 6K)",
			},
			{
				"label": "Frame rate",
				"value": "Any - no baked timing",
			},
		],
		"compatibility": [
			{
				"app": "After Effects",
				"versions": "2022 and later",
			},
			{
				"app": "DaVinci Resolve",
				"versions": "18 and later",
			},
			{
				"app": "Premiere Pro",
				"versions": "2022 and later",
			},
		],
		"licence": "standard",
		"attributionRequired": true,
	},
	{
		"key": "pr-motion-primitives",
		"owner": "@juno",
		"title": "Motion primitives",
		"summary": "Motion primitives — a ready-to-buy download from Juno Park.",
		"category": "templates",
		"priceMinor": 4900,
		"currency": "USD",
		"span": 2,
		"sponsored": false,
		"skills": [
			"motion-design",
			"typescript",
			"preact",
		],
		"format": "preset",
		"files": [
			{
				"name": "motion-primitives.cube",
				"label": "3D LUT",
				"extension": ".cube",
				"bytes": 2097152,
			},
			{
				"name": "motion-primitives.aep",
				"label": "After Effects project",
				"extension": ".aep",
				"bytes": 175112192,
			},
			{
				"name": "motion-primitives.mov",
				"label": "ProRes preview",
				"extension": ".mov",
				"bytes": 367001600,
			},
		],
		"specs": [
			{
				"label": "Colour space",
				"value": "Rec.709 with Log-to-Rec conversion included",
			},
			{
				"label": "Presets included",
				"value": "17 looks",
			},
			{
				"label": "Resolution",
				"value": "Resolution-independent (tested to 6K)",
			},
			{
				"label": "Frame rate",
				"value": "Any - no baked timing",
			},
		],
		"compatibility": [
			{
				"app": "After Effects",
				"versions": "2022 and later",
			},
			{
				"app": "DaVinci Resolve",
				"versions": "18 and later",
			},
			{
				"app": "Premiere Pro",
				"versions": "2022 and later",
			},
		],
		"licence": "standard",
		"attributionRequired": true,
	},
	{
		"key": "pr-editorial-type-system",
		"owner": "@studiofern",
		"title": "Editorial type system",
		"summary": "Editorial type system — a ready-to-buy download from Studio Fern.",
		"category": "templates",
		"priceMinor": 12000,
		"currency": "USD",
		"span": 3,
		"sponsored": false,
		"skills": [
			"typography",
			"editorial-design",
		],
		"format": "download",
		"files": [
			{
				"name": "editorial-type-system.wav",
				"label": "24-bit / 48kHz stem",
				"extension": ".wav",
				"bytes": 363855872,
			},
			{
				"name": "editorial-type-system.mp3",
				"label": "320kbps reference mix",
				"extension": ".mp3",
				"bytes": 20971520,
			},
			{
				"name": "editorial-type-system.als",
				"label": "Ableton session",
				"extension": ".als",
				"bytes": 8388608,
			},
		],
		"specs": [
			{
				"label": "Sample rate",
				"value": "48 kHz / 24-bit",
			},
			{
				"label": "Stems included",
				"value": "8 separated stems",
			},
			{
				"label": "Tempo",
				"value": "90 BPM",
			},
			{
				"label": "Key",
				"value": "F# minor",
			},
		],
		"compatibility": [
			{
				"app": "Ableton Live",
				"versions": "11 and later",
			},
			{
				"app": "Logic Pro",
				"versions": "10.7 and later",
			},
			{
				"app": "Any DAW",
				"versions": "WAV / MP3 import",
			},
		],
		"licence": "extended",
		"attributionRequired": false,
	},
	{
		"key": "pr-dashboard-blocks",
		"owner": "@northloop",
		"title": "Dashboard blocks",
		"summary": "Dashboard blocks — a ready-to-buy download from North Loop.",
		"category": "templates",
		"priceMinor": 6500,
		"currency": "USD",
		"span": 2,
		"sponsored": false,
		"skills": [
			"figma",
			"design-systems",
			"typescript",
		],
		"format": "template",
		"files": [
			{
				"name": "dashboard-blocks.fig",
				"label": "Figma source",
				"extension": ".fig",
				"bytes": 14680064,
			},
			{
				"name": "dashboard-blocks.pdf",
				"label": "Print-ready export",
				"extension": ".pdf",
				"bytes": 5242880,
			},
			{
				"name": "dashboard-blocks.md",
				"label": "Setup guide",
				"extension": ".md",
				"bytes": 1048576,
			},
		],
		"specs": [
			{
				"label": "Pages / artboards",
				"value": "23",
			},
			{
				"label": "Grid",
				"value": "12-column, 8pt baseline",
			},
			{
				"label": "Type styles",
				"value": "Variable-font ready, tokenised",
			},
			{
				"label": "Dark mode",
				"value": "Light only",
			},
		],
		"compatibility": [
			{
				"app": "Figma",
				"versions": "Current web + desktop",
			},
			{
				"app": "Adobe Acrobat",
				"versions": "2020 and later",
			},
		],
		"licence": "extended",
		"attributionRequired": false,
	},
	{
		"key": "pr-iconography-set",
		"owner": "@marisdelacroix",
		"title": "Iconography set — 640",
		"summary": "Iconography set — 640 — a ready-to-buy download from Maris Delacroix.",
		"category": "icons",
		"priceMinor": 3800,
		"currency": "USD",
		"span": 1,
		"sponsored": false,
		"skills": [
			"illustration",
			"figma",
		],
		"format": "download",
		"files": [
			{
				"name": "iconography-set.ai",
				"label": "Vector source",
				"extension": ".ai",
				"bytes": 57671680,
			},
			{
				"name": "iconography-set.png",
				"label": "Transparent exports",
				"extension": ".png",
				"bytes": 168820736,
			},
			{
				"name": "iconography-set.svg",
				"label": "Scalable set",
				"extension": ".svg",
				"bytes": 4194304,
			},
		],
		"specs": [
			{
				"label": "Artboards",
				"value": "10",
			},
			{
				"label": "Max export",
				"value": "6000 x 6000 px at 300 DPI",
			},
			{
				"label": "Colour profile",
				"value": "sRGB plus CMYK variants",
			},
		],
		"compatibility": [
			{
				"app": "Illustrator",
				"versions": "2021 and later",
			},
			{
				"app": "Affinity Designer",
				"versions": "2 and later",
			},
		],
		"licence": "standard",
		"attributionRequired": true,
	},
	{
		"key": "pr-3d-product-scenes",
		"owner": "@renkoda",
		"title": "3D product scenes",
		"summary": "3D product scenes — a ready-to-buy download from Ren Koda.",
		"category": "3d",
		"priceMinor": 9500,
		"currency": "USD",
		"span": 2,
		"sponsored": false,
		"skills": [
			"blender",
			"webgl",
			"three-js",
		],
		"format": "download",
		"files": [
			{
				"name": "3d-product-scenes.blend",
				"label": "Blender scene",
				"extension": ".blend",
				"bytes": 332398592,
			},
			{
				"name": "3d-product-scenes.fbx",
				"label": "FBX mesh + rig",
				"extension": ".fbx",
				"bytes": 77594624,
			},
			{
				"name": "3d-product-scenes.png",
				"label": "4K PBR texture set",
				"extension": ".png",
				"bytes": 193986560,
			},
		],
		"specs": [
			{
				"label": "Poly count",
				"value": "25k tris (quad topology)",
			},
			{
				"label": "Texture resolution",
				"value": "4096 x 4096 PBR (albedo, normal, roughness)",
			},
			{
				"label": "Rigged",
				"value": "No - static mesh",
			},
			{
				"label": "UV layout",
				"value": "Non-overlapping, single UDIM",
			},
		],
		"compatibility": [
			{
				"app": "Blender",
				"versions": "3.6 LTS - 4.2",
			},
			{
				"app": "Cinema 4D",
				"versions": "R25 and later",
			},
			{
				"app": "Unreal Engine",
				"versions": "5.1 - 5.4",
			},
		],
		"licence": "standard",
		"attributionRequired": true,
	},
	{
		"key": "pr-notion-ops-suite",
		"owner": "@studiofern",
		"title": "Notion ops suite",
		"summary": "Notion ops suite — a ready-to-buy download from Studio Fern.",
		"category": "templates",
		"priceMinor": 2900,
		"currency": "USD",
		"span": 1,
		"sponsored": false,
		"skills": [
			"notion",
		],
		"format": "template",
		"files": [
			{
				"name": "notion-ops-suite.fig",
				"label": "Figma source",
				"extension": ".fig",
				"bytes": 14680064,
			},
			{
				"name": "notion-ops-suite.pdf",
				"label": "Print-ready export",
				"extension": ".pdf",
				"bytes": 5242880,
			},
			{
				"name": "notion-ops-suite.md",
				"label": "Setup guide",
				"extension": ".md",
				"bytes": 1048576,
			},
		],
		"specs": [
			{
				"label": "Pages / artboards",
				"value": "17",
			},
			{
				"label": "Grid",
				"value": "12-column, 8pt baseline",
			},
			{
				"label": "Type styles",
				"value": "Variable-font ready, tokenised",
			},
			{
				"label": "Dark mode",
				"value": "Light only",
			},
		],
		"compatibility": [
			{
				"app": "Figma",
				"versions": "Current web + desktop",
			},
			{
				"app": "Adobe Acrobat",
				"versions": "2020 and later",
			},
		],
		"licence": "extended",
		"attributionRequired": false,
	},
];

export const ARTICLES: CorpusArticle[] = [
	{
		"key": "ar-hiring-a-team",
		"owner": "@studiofern",
		"title": "How to hire a whole team, not just one person",
		"summary":
			"How to hire a whole team, not just one person — a practical guide from the Projective team.",
		"topic": "hiring",
		"readMinutes": 6,
		"cover": "banner_2.jpg",
		"blocks": [
			{
				"type": "paragraph",
				"text":
					"How to hire a whole team, not just one person — a practical guide from the Projective team. Here's the practical version, without the jargon.",
			},
			{
				"type": "paragraph",
				"text":
					"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.",
			},
			{
				"type": "heading",
				"id": "why-this-matters-1",
				"text": "Why this matters",
			},
			{
				"type": "paragraph",
				"text":
					"The short version: you never pay for work you haven't seen, and freelancers never deliver work they won't be paid for. The platform sits in the middle and releases funds only when a stage is accepted.",
			},
			{
				"type": "paragraph",
				"text":
					"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.",
			},
			{
				"type": "image",
				"asset": "banner_2.jpg",
				"alt": "How to hire a whole team, not just one person",
				"caption": "How to hire a whole team, not just one person — the flow at a glance.",
			},
			{
				"type": "heading",
				"id": "how-it-actually-works-2",
				"text": "How it actually works",
			},
			{
				"type": "subheading",
				"id": "step-by-step-3",
				"text": "Step by step",
			},
			{
				"type": "paragraph",
				"text":
					"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.",
			},
			{
				"type": "list",
				"items": [
					"Agree the scope and the definition of done before any money moves.",
					"Fund the first stage — it sits safely in escrow until you accept it.",
					"Review the submission, request revisions if needed, then release.",
					"Repeat for each stage; you only ever have one in flight.",
				],
			},
			{
				"type": "subheading",
				"id": "in-practice-4",
				"text": "In practice",
			},
			{
				"type": "paragraph",
				"text":
					"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.",
			},
			{
				"type": "image",
				"asset": "banner_2.jpg",
				"alt": "hiring in practice",
				"caption": "Every stage carries its own channel, submissions, and escrow.",
			},
			{
				"type": "heading",
				"id": "a-worked-example-5",
				"text": "A worked example",
			},
			{
				"type": "paragraph",
				"text":
					"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.",
			},
			{
				"type": "paragraph",
				"text":
					"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.",
			},
			{
				"type": "heading",
				"id": "common-questions-6",
				"text": "Common questions",
			},
			{
				"type": "subheading",
				"id": "what-if-something-goes-wrong-7",
				"text": "What if something goes wrong?",
			},
			{
				"type": "list",
				"items": [
					"Keep the brief short and specific — one outcome per ticket.",
					"Use the stage channel for questions so the history stays in one place.",
					"Accept promptly once a stage meets the bar; it releases the escrow.",
					"Leave a review — it feeds both sides' reputation tracks.",
				],
			},
			{
				"type": "heading",
				"id": "where-to-go-next-8",
				"text": "Where to go next",
			},
			{
				"type": "paragraph",
				"text":
					"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.",
			},
			{
				"type": "quote",
				"text":
					"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.",
			},
		],
	},
	{
		"key": "ar-escrow-explained",
		"owner": "@northloop",
		"title": "Escrow, explained: how your money stays safe",
		"summary":
			"Escrow, explained: how your money stays safe — a practical guide from the Projective team.",
		"topic": "payments",
		"readMinutes": 4,
		"cover": "banner_4.jpg",
		"blocks": [
			{
				"type": "paragraph",
				"text":
					"Escrow, explained: how your money stays safe — a practical guide from the Projective team. Here's the practical version, without the jargon.",
			},
			{
				"type": "paragraph",
				"text":
					"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.",
			},
			{
				"type": "heading",
				"id": "why-this-matters-1",
				"text": "Why this matters",
			},
			{
				"type": "paragraph",
				"text":
					"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.",
			},
			{
				"type": "paragraph",
				"text":
					"The short version: you never pay for work you haven't seen, and freelancers never deliver work they won't be paid for. The platform sits in the middle and releases funds only when a stage is accepted.",
			},
			{
				"type": "image",
				"asset": "banner_4.jpg",
				"alt": "Escrow, explained: how your money stays safe",
				"caption": "Escrow, explained: how your money stays safe — the flow at a glance.",
			},
			{
				"type": "heading",
				"id": "how-it-actually-works-2",
				"text": "How it actually works",
			},
			{
				"type": "subheading",
				"id": "step-by-step-3",
				"text": "Step by step",
			},
			{
				"type": "paragraph",
				"text":
					"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.",
			},
			{
				"type": "list",
				"items": [
					"Keep the brief short and specific — one outcome per ticket.",
					"Use the stage channel for questions so the history stays in one place.",
					"Accept promptly once a stage meets the bar; it releases the escrow.",
					"Leave a review — it feeds both sides' reputation tracks.",
				],
			},
			{
				"type": "subheading",
				"id": "in-practice-4",
				"text": "In practice",
			},
			{
				"type": "paragraph",
				"text":
					"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.",
			},
			{
				"type": "image",
				"asset": "banner_4.jpg",
				"alt": "payments in practice",
				"caption": "Every stage carries its own channel, submissions, and escrow.",
			},
			{
				"type": "heading",
				"id": "a-worked-example-5",
				"text": "A worked example",
			},
			{
				"type": "paragraph",
				"text":
					"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.",
			},
			{
				"type": "paragraph",
				"text":
					"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.",
			},
			{
				"type": "heading",
				"id": "common-questions-6",
				"text": "Common questions",
			},
			{
				"type": "subheading",
				"id": "what-if-something-goes-wrong-7",
				"text": "What if something goes wrong?",
			},
			{
				"type": "list",
				"items": [
					"Agree the scope and the definition of done before any money moves.",
					"Fund the first stage — it sits safely in escrow until you accept it.",
					"Review the submission, request revisions if needed, then release.",
					"Repeat for each stage; you only ever have one in flight.",
				],
			},
			{
				"type": "heading",
				"id": "where-to-go-next-8",
				"text": "Where to go next",
			},
			{
				"type": "paragraph",
				"text":
					"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.",
			},
			{
				"type": "quote",
				"text":
					"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.",
			},
		],
	},
	{
		"key": "ar-paying-step-by-step",
		"owner": "@marisdelacroix",
		"title": "Paying step by step across stages",
		"summary": "Paying step by step across stages — a practical guide from the Projective team.",
		"topic": "payments",
		"readMinutes": 5,
		"cover": "banner_7.jpg",
		"blocks": [
			{
				"type": "paragraph",
				"text":
					"Paying step by step across stages — a practical guide from the Projective team. Here's the practical version, without the jargon.",
			},
			{
				"type": "paragraph",
				"text":
					"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.",
			},
			{
				"type": "heading",
				"id": "why-this-matters-1",
				"text": "Why this matters",
			},
			{
				"type": "paragraph",
				"text":
					"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.",
			},
			{
				"type": "paragraph",
				"text":
					"The short version: you never pay for work you haven't seen, and freelancers never deliver work they won't be paid for. The platform sits in the middle and releases funds only when a stage is accepted.",
			},
			{
				"type": "image",
				"asset": "banner_7.jpg",
				"alt": "Paying step by step across stages",
				"caption": "Paying step by step across stages — the flow at a glance.",
			},
			{
				"type": "heading",
				"id": "how-it-actually-works-2",
				"text": "How it actually works",
			},
			{
				"type": "subheading",
				"id": "step-by-step-3",
				"text": "Step by step",
			},
			{
				"type": "paragraph",
				"text":
					"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.",
			},
			{
				"type": "list",
				"items": [
					"Keep the brief short and specific — one outcome per ticket.",
					"Use the stage channel for questions so the history stays in one place.",
					"Accept promptly once a stage meets the bar; it releases the escrow.",
					"Leave a review — it feeds both sides' reputation tracks.",
				],
			},
			{
				"type": "subheading",
				"id": "in-practice-4",
				"text": "In practice",
			},
			{
				"type": "paragraph",
				"text":
					"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.",
			},
			{
				"type": "image",
				"asset": "banner_7.jpg",
				"alt": "payments in practice",
				"caption": "Every stage carries its own channel, submissions, and escrow.",
			},
			{
				"type": "heading",
				"id": "a-worked-example-5",
				"text": "A worked example",
			},
			{
				"type": "paragraph",
				"text":
					"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.",
			},
			{
				"type": "paragraph",
				"text":
					"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.",
			},
			{
				"type": "heading",
				"id": "common-questions-6",
				"text": "Common questions",
			},
			{
				"type": "subheading",
				"id": "what-if-something-goes-wrong-7",
				"text": "What if something goes wrong?",
			},
			{
				"type": "list",
				"items": [
					"Agree the scope and the definition of done before any money moves.",
					"Fund the first stage — it sits safely in escrow until you accept it.",
					"Review the submission, request revisions if needed, then release.",
					"Repeat for each stage; you only ever have one in flight.",
				],
			},
			{
				"type": "heading",
				"id": "where-to-go-next-8",
				"text": "Where to go next",
			},
			{
				"type": "paragraph",
				"text":
					"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.",
			},
			{
				"type": "quote",
				"text":
					"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.",
			},
		],
	},
	{
		"key": "ar-running-a-small-team",
		"owner": "@ateliernova",
		"title": "Running a small team without the chaos",
		"summary":
			"Running a small team without the chaos — a practical guide from the Projective team.",
		"topic": "teams",
		"readMinutes": 7,
		"cover": "banner_3.jpg",
		"blocks": [
			{
				"type": "paragraph",
				"text":
					"Running a small team without the chaos — a practical guide from the Projective team. Here's the practical version, without the jargon.",
			},
			{
				"type": "paragraph",
				"text":
					"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.",
			},
			{
				"type": "heading",
				"id": "why-this-matters-1",
				"text": "Why this matters",
			},
			{
				"type": "paragraph",
				"text":
					"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.",
			},
			{
				"type": "paragraph",
				"text":
					"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.",
			},
			{
				"type": "image",
				"asset": "banner_3.jpg",
				"alt": "Running a small team without the chaos",
				"caption": "Running a small team without the chaos — the flow at a glance.",
			},
			{
				"type": "heading",
				"id": "how-it-actually-works-2",
				"text": "How it actually works",
			},
			{
				"type": "subheading",
				"id": "step-by-step-3",
				"text": "Step by step",
			},
			{
				"type": "paragraph",
				"text":
					"The short version: you never pay for work you haven't seen, and freelancers never deliver work they won't be paid for. The platform sits in the middle and releases funds only when a stage is accepted.",
			},
			{
				"type": "list",
				"items": [
					"Agree the scope and the definition of done before any money moves.",
					"Fund the first stage — it sits safely in escrow until you accept it.",
					"Review the submission, request revisions if needed, then release.",
					"Repeat for each stage; you only ever have one in flight.",
				],
			},
			{
				"type": "subheading",
				"id": "in-practice-4",
				"text": "In practice",
			},
			{
				"type": "paragraph",
				"text":
					"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.",
			},
			{
				"type": "image",
				"asset": "banner_3.jpg",
				"alt": "teams in practice",
				"caption": "Every stage carries its own channel, submissions, and escrow.",
			},
			{
				"type": "heading",
				"id": "a-worked-example-5",
				"text": "A worked example",
			},
			{
				"type": "paragraph",
				"text":
					"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.",
			},
			{
				"type": "paragraph",
				"text":
					"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.",
			},
			{
				"type": "heading",
				"id": "common-questions-6",
				"text": "Common questions",
			},
			{
				"type": "subheading",
				"id": "what-if-something-goes-wrong-7",
				"text": "What if something goes wrong?",
			},
			{
				"type": "list",
				"items": [
					"Keep the brief short and specific — one outcome per ticket.",
					"Use the stage channel for questions so the history stays in one place.",
					"Accept promptly once a stage meets the bar; it releases the escrow.",
					"Leave a review — it feeds both sides' reputation tracks.",
				],
			},
			{
				"type": "heading",
				"id": "where-to-go-next-8",
				"text": "Where to go next",
			},
			{
				"type": "paragraph",
				"text":
					"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.",
			},
			{
				"type": "quote",
				"text":
					"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.",
			},
		],
	},
	{
		"key": "ar-getting-started",
		"owner": "@juno",
		"title": "Getting started on Projective",
		"summary": "Getting started on Projective — a practical guide from the Projective team.",
		"topic": "getting-started",
		"readMinutes": 3,
		"cover": "banner_5.jpg",
		"blocks": [
			{
				"type": "paragraph",
				"text":
					"Getting started on Projective — a practical guide from the Projective team. Here's the practical version, without the jargon.",
			},
			{
				"type": "paragraph",
				"text":
					"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.",
			},
			{
				"type": "heading",
				"id": "why-this-matters-1",
				"text": "Why this matters",
			},
			{
				"type": "paragraph",
				"text":
					"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.",
			},
			{
				"type": "paragraph",
				"text":
					"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.",
			},
			{
				"type": "image",
				"asset": "banner_5.jpg",
				"alt": "Getting started on Projective",
				"caption": "Getting started on Projective — the flow at a glance.",
			},
			{
				"type": "heading",
				"id": "how-it-actually-works-2",
				"text": "How it actually works",
			},
			{
				"type": "subheading",
				"id": "step-by-step-3",
				"text": "Step by step",
			},
			{
				"type": "paragraph",
				"text":
					"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.",
			},
			{
				"type": "list",
				"items": [
					"Keep the brief short and specific — one outcome per ticket.",
					"Use the stage channel for questions so the history stays in one place.",
					"Accept promptly once a stage meets the bar; it releases the escrow.",
					"Leave a review — it feeds both sides' reputation tracks.",
				],
			},
			{
				"type": "subheading",
				"id": "in-practice-4",
				"text": "In practice",
			},
			{
				"type": "paragraph",
				"text":
					"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.",
			},
			{
				"type": "image",
				"asset": "banner_5.jpg",
				"alt": "getting-started in practice",
				"caption": "Every stage carries its own channel, submissions, and escrow.",
			},
			{
				"type": "heading",
				"id": "a-worked-example-5",
				"text": "A worked example",
			},
			{
				"type": "paragraph",
				"text":
					"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.",
			},
			{
				"type": "paragraph",
				"text":
					"The short version: you never pay for work you haven't seen, and freelancers never deliver work they won't be paid for. The platform sits in the middle and releases funds only when a stage is accepted.",
			},
			{
				"type": "heading",
				"id": "common-questions-6",
				"text": "Common questions",
			},
			{
				"type": "subheading",
				"id": "what-if-something-goes-wrong-7",
				"text": "What if something goes wrong?",
			},
			{
				"type": "list",
				"items": [
					"Agree the scope and the definition of done before any money moves.",
					"Fund the first stage — it sits safely in escrow until you accept it.",
					"Review the submission, request revisions if needed, then release.",
					"Repeat for each stage; you only ever have one in flight.",
				],
			},
			{
				"type": "heading",
				"id": "where-to-go-next-8",
				"text": "Where to go next",
			},
			{
				"type": "paragraph",
				"text":
					"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.",
			},
			{
				"type": "quote",
				"text":
					"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.",
			},
		],
	},
];
