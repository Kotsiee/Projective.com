import { assert, assertEquals } from "@std/assert";
import {
	type BoardCard,
	type BoardPage,
	briefOf,
	composeWorkspace,
	type ProjectSetup,
	type SubmissionListPage,
} from "@projective/types/projects";
import { allProjects } from "./fixtures.ts";
import { findProjectOverview } from "./overview-fixtures.ts";
import { findBoardPage } from "./board-fixtures.ts";
import { findMemberRoster } from "./members-fixtures.ts";
import { findProjectSetup } from "./setup-fixtures.ts";
import { findFilePage } from "./files-fixtures.ts";

/**
 * The Overview's composition over the stub corpus: the brief every viewer reads, the People list, the
 * one-room presentation of a Task, and a freelancer's work signals (claimable tickets within their
 * workload cap, deliverables by review state).
 */

const TASK_SLUG = "prj-cujw52gg3p";

function pipelineSlug(): string {
	const row = allProjects().find((p) => p.format === "pipeline" && p.status === "active");
	assert(row, "the corpus holds an active pipeline");
	return row.slug;
}

function sources(slug: string, viewer: "owner" | "participant") {
	const base = findProjectOverview(slug);
	assert(base);
	return {
		base,
		board: findBoardPage({ projectId: slug }),
		roster: findMemberRoster({ projectId: slug }) ?? null,
		setup: findProjectSetup(slug),
		viewer,
	};
}

Deno.test("a Task composes a brief, names no stage on its people and presents one Discussion", () => {
	const s = sources(TASK_SLUG, "owner");
	const ws = composeWorkspace(s.base, s);
	assert(ws.brief);
	assertEquals(ws.brief.formatLabel, "Task");
	assertEquals(ws.task, true);
	assert(ws.roster.length > 0);
	assert(ws.roster.every((person) => person.stages === null));
	assertEquals(ws.roster[0].role, "owner");

	const shared = ws.channels.filter((c) => c.kind !== "dm");
	assertEquals(shared.map((c) => c.name), ["Discussion"]);
	assert(shared[0].href.endsWith("/discussion"));
	assertEquals(ws.submissions, []);
	assertEquals(ws.claimable, []);
});

Deno.test("a Task's files tree lists its Discussion and private threads, never its stage room", () => {
	const page = findFilePage({ projectId: TASK_SLUG });
	assert(page);
	assertEquals(page.task, true);
	assert(page.channels.some((c) => c.name === "Discussion"));
	assert(!page.channels.some((c) => c.name === "Delivery"));
	assert(page.channels.every((c) => c.kind === "general" || c.kind === "dm"));
});

Deno.test("a pipeline keeps its stage rooms and lists stages on its people", () => {
	const slug = pipelineSlug();
	const s = sources(slug, "owner");
	const ws = composeWorkspace(s.base, s);
	assertEquals(ws.task, false);
	assert(ws.brief);
	assertEquals(ws.brief.formatLabel, "Pipeline");
	assert(ws.channels.length > 1);
});

Deno.test("briefOf words the NDA, the budget model and the skills exactly as configured", () => {
	const setup = findProjectSetup(pipelineSlug());
	assert(setup);
	const custom: ProjectSetup = {
		...setup,
		description: "<p>First paragraph.</p><p>Second paragraph.</p>",
		budget: { budgetType: "hourly_cap", amountCents: 6000, currency: "USD" },
		rules: { ...setup.rules, ndaRequired: true, ndaSource: "custom", allowDeadlineBonuses: true },
		stages: setup.stages.map((stage, i) => ({
			...stage,
			skills: i === 0 ? ["Figma", "figma ", "Branding"] : ["Branding", "Motion"],
			deliveryDate: i === 0 ? "2026-09-12T00:00:00.000Z" : null,
		})),
	};
	const brief = briefOf(custom);
	assertEquals(brief.nda, { required: true, source: "custom", label: "Custom NDA from the client" });
	assert(brief.budgetLabel.startsWith("Hourly cap · "));
	assertEquals(brief.tags.slice(0, 3), ["Figma", "Branding", "Motion"]);
	assertEquals(brief.deadlineLabel, "Due Sat, 12 Sep");
	assert(brief.description.includes("First paragraph."));
	assert(brief.terms.some((t) => t.label === "Deadline bonuses"));

	const none = briefOf({ ...custom, rules: { ...custom.rules, ndaRequired: false } });
	assertEquals(none.nda.source, "none");
});

function card(over: Partial<BoardCard>): BoardCard {
	return {
		id: "c",
		title: "Ticket",
		description: "Described",
		hasDescription: true,
		status: "todo",
		stageId: "s1",
		assignee: null,
		owner: null,
		contributors: [],
		claimed: false,
		claimedAt: null,
		escrowHeld: false,
		paymentScope: "per_stage",
		paidStageIds: ["s1"],
		priority: "normal",
		intensity: "standard",
		workload: 1,
		dueDate: null,
		dueLabel: null,
		budgetCents: null,
		budgetLabel: null,
		activity: null,
		frozen: false,
		commentCount: 0,
		attachmentCount: 0,
		checklistDone: 0,
		checklistTotal: 0,
		...over,
	} as BoardCard;
}

Deno.test("claimable tickets are ready, described, open-pull, on the viewer's stage and within the cap", () => {
	const slug = pipelineSlug();
	const s = sources(slug, "participant");
	assert(s.board);
	const stage = { ...s.board.stages[0], id: "s1", assignmentMode: "open_pull" as const, maxConcurrentIntensity: 3 };
	const closed = { ...s.board.stages[0], id: "s2", assignmentMode: "manual" as const, maxConcurrentIntensity: null };
	const board: BoardPage = {
		...s.board,
		stages: [stage, closed],
		viewerStageIds: ["s1", "s2"],
		cards: [
			card({ id: "held", status: "in_progress", claimed: true, workload: 2 }),
			card({ id: "fits", workload: 1 }),
			card({ id: "too-heavy", workload: 2, intensity: "high" }),
			card({ id: "undescribed", hasDescription: false }),
			card({ id: "manual-stage", stageId: "s2" }),
			card({ id: "claimed", claimed: true }),
		],
	};
	const base = {
		...s.base,
		assignments: [{
			ticketId: "held",
			title: "Held",
			stageName: null,
			status: "in_progress" as const,
			dueLabel: null,
			href: "/x",
		}],
	};
	const ws = composeWorkspace(base, { ...s, board });
	assertEquals(ws.claimable.map((c) => c.ticketId), ["fits"]);
	assert(ws.claimable[0].loadLabel.startsWith("Standard · 1 unit"));
});

Deno.test("active submissions walk the viewer's tree, returned work first, drafts left out", () => {
	const slug = pipelineSlug();
	const s = sources(slug, "participant");
	const tree: SubmissionListPage["tree"] = [{
		segment: "stage-a",
		kind: "stage",
		label: "Discovery",
		fileCount: 3,
		children: [{
			segment: "me",
			kind: "submitter",
			label: "You",
			fileCount: 3,
			children: [
				{ segment: "u1", kind: "unit", label: "Logo v1", status: "accepted", fileCount: 1, children: [] },
				{ segment: "u2", kind: "unit", label: "Logo v2", status: "revision_requested", fileCount: 1, children: [] },
				{ segment: "u3", kind: "unit", label: "Draft", status: "draft", fileCount: 1, children: [] },
				{ segment: "u4", kind: "unit", label: "Palette", status: "pending_review", fileCount: 0, children: [] },
			],
		}],
	}];
	const submissions = { tree } as SubmissionListPage;
	const ws = composeWorkspace(s.base, { ...s, submissions });
	assertEquals(ws.submissions.map((x) => [x.title, x.state]), [
		["Logo v2", "in_revision"],
		["Palette", "pending_review"],
		["Logo v1", "approved"],
	]);
	assertEquals(ws.submissions[0].stageName, "Discovery");
	assert(ws.submissions[0].href.endsWith("/submissions/stage-a/me/u2"));

	const owner = composeWorkspace(s.base, { ...s, viewer: "owner", submissions });
	assertEquals(owner.submissions, []);
});
