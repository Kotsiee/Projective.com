import { assert, assertEquals } from "@std/assert";
import {
	buildHireBrief,
	type HireBrief,
	type HireInvitation,
	hireInvitationRefusal,
	hireInvitationTotalCents,
	hirePricingModelFor,
} from "./hire.ts";
import type { MemberRosterPage } from "./members.ts";
import { blankStage, reconcileSetup } from "./setup.ts";

/**
 * The Hire invitation's rules, pinned.
 *
 * Each assertion is a CLAIM the modal makes to a client about what they are offering and to whom:
 * which price field a project takes, which stages a person can be invited onto, and what an offer
 * adds up to. The pricing-model derivation in particular is invisible to a source-reading review —
 * a pipeline rendered with "Stage price" instead of "Per-ticket price" compiles, renders and lies.
 */

const priced = (id: string, order: number, cents: number | null, description = "") => ({
	...blankStage(id, `Stage ${order + 1}`, order),
	unitPriceCents: cents,
	description,
});

/** A setup for the given shape, through the SSOT's own reconciler so no field is invented here. */
function setupFor(
	format: "pipeline" | "one_off",
	structure: "standard" | "one_off" | "single_stage" | "single_task",
	stages = [
		priced("stg-a", 0, 40_000, "<p>Discovery and <b>research</b></p>"),
		priced("stg-b", 1, null),
	],
) {
	return reconcileSetup({
		id: "11111111-1111-4111-8111-111111111111",
		slug: "prj-test000001",
		title: "Helia wallet redesign",
		format,
		structure,
		status: "active",
		description: "<p>A wallet <em>redesign</em>.</p>",
		budget: { budgetType: "fixed_price", amountCents: 250_000, currency: "GBP" },
		stages,
		viewerIsClient: true,
	});
}

const roster: MemberRosterPage = {
	scope: "project",
	projectId: "prj-test000001",
	channelId: null,
	channelName: null,
	channelKind: null,
	projectTitle: "Helia wallet redesign",
	format: "pipeline",
	members: [
		{
			id: "m-1",
			party: { name: "Mara Ellison", avatar: null, handle: "mara" },
			email: "mara@example.com",
			role: "client",
			assignment: null,
			presence: "offline",
			assignedStages: [],
			openTickets: 0,
			ticketsLabel: "—",
			joinedAt: "2026-07-01T00:00:00Z",
			joinedLabel: "Jul 1, 2026",
			isViewer: true,
		},
		{
			id: "m-2",
			party: { name: "Priya Nair", avatar: null, handle: "priya" },
			email: "priya@example.com",
			role: "freelancer",
			assignment: null,
			presence: "online",
			assignedStages: ["Stage 1"],
			openTickets: 2,
			ticketsLabel: "2 open",
			joinedAt: "2026-07-03T00:00:00Z",
			joinedLabel: "Jul 3, 2026",
			isViewer: false,
		},
	],
	invites: [],
	stages: [{ id: "stg-a", name: "Stage 1" }, { id: "stg-b", name: "Stage 2" }],
	viewerId: "m-1",
	viewerRole: "client",
	viewerCaps: {
		canManage: true,
		canInvite: true,
		canAssign: true,
		canEditRoles: true,
		canRemove: true,
	},
	total: 2,
};

Deno.test("hirePricingModelFor: the model follows the engagement's shape", () => {
	assertEquals(hirePricingModelFor("pipeline", "standard"), "per_ticket_stage");
	assertEquals(hirePricingModelFor("one_off", "one_off"), "per_stage");
	assertEquals(hirePricingModelFor("one_off", "single_stage"), "task");
	assertEquals(hirePricingModelFor("one_off", "single_task"), "task");
	// A stage-less pipeline is still a single unit of work, whatever its format says.
	assertEquals(hirePricingModelFor("pipeline", "single_stage"), "task");
});

Deno.test("buildHireBrief: a pipeline lists every stage with its price and its members", () => {
	const brief = buildHireBrief(setupFor("pipeline", "standard"), roster);
	assertEquals(brief.pricingModel, "per_ticket_stage");
	assertEquals(brief.currency, "GBP");
	assertEquals(brief.taskPriceCents, null);
	assertEquals(brief.stages.map((s) => s.id), ["stg-a", "stg-b"]);
	assertEquals(brief.stages[0].unitPriceCents, 40_000);
	assertEquals(brief.stages[1].unitPriceCents, null);
	// Rich text is flattened to prose for the preview.
	assertEquals(brief.stages[0].summary, "Discovery and research");
	assertEquals(brief.summary, "A wallet redesign.");
	// Members are matched to stages by the roster's own stage-name summary.
	assertEquals(brief.stages[0].memberNames, ["Priya Nair"]);
	assertEquals(brief.stages[1].memberNames, []);
	assertEquals(brief.members.length, 2);
	assert(brief.canInvite);
});

Deno.test("buildHireBrief: a single-stage one-off exposes its root stage and a task price", () => {
	const brief = buildHireBrief(
		setupFor("one_off", "single_stage", [priced("stg-root", 0, 90_000)]),
		roster,
	);
	assertEquals(brief.pricingModel, "task");
	assertEquals(brief.stages.length, 1);
	assertEquals(brief.taskPriceCents, 90_000);
});

Deno.test("buildHireBrief: a Direct Deliverable is priced at the project level", () => {
	const brief = buildHireBrief(
		setupFor("one_off", "single_task", [priced("stg-root", 0, null)]),
		roster,
	);
	assertEquals(brief.pricingModel, "task");
	// The root stage carries no price of its own; the budget is the offer's seed.
	assertEquals(brief.taskPriceCents, 250_000);
});

Deno.test("buildHireBrief: a viewer without the invite capability cannot send", () => {
	const brief = buildHireBrief(setupFor("pipeline", "standard"), {
		...roster,
		viewerCaps: { ...roster.viewerCaps, canInvite: false },
	});
	assertEquals(brief.canInvite, false);
	const refusal = hireInvitationRefusal(brief, {
		projectId: brief.projectId,
		handle: "@juno",
		message: "",
		stages: [{ stageId: "stg-a", priceCents: 1 }],
		taskPriceCents: null,
	});
	assertEquals(refusal?.errors.projectId, "not_invitable");
});

const pipeline: HireBrief = buildHireBrief(setupFor("pipeline", "standard"), roster);
const offer = (stages: HireInvitation["stages"], taskPriceCents: number | null = null) => ({
	projectId: pipeline.projectId,
	handle: "juno",
	message: "Hello",
	stages,
	taskPriceCents,
});

Deno.test("hireInvitationRefusal: a stage model needs at least one known, unique stage", () => {
	assertEquals(hireInvitationRefusal(pipeline, offer([]))?.errors.stages, "required");
	assertEquals(
		hireInvitationRefusal(pipeline, offer([{ stageId: "stg-zzz", priceCents: 10 }]))?.errors.stages,
		"unknown_stage",
	);
	assertEquals(
		hireInvitationRefusal(
			pipeline,
			offer([{ stageId: "stg-a", priceCents: 10 }, { stageId: "stg-a", priceCents: 20 }]),
		)?.errors.stages,
		"duplicate_stage",
	);
	assertEquals(
		hireInvitationRefusal(pipeline, offer([{ stageId: "stg-a", priceCents: 10 }], 5))?.errors
			.taskPriceCents,
		"not_applicable",
	);
	assertEquals(
		hireInvitationRefusal(pipeline, offer([{ stageId: "stg-a", priceCents: 10 }])),
		null,
	);
});

Deno.test("hireInvitationRefusal: a task model needs its one price and no stages", () => {
	const task = buildHireBrief(
		setupFor("one_off", "single_stage", [priced("stg-root", 0, 90_000)]),
		roster,
	);
	assertEquals(
		hireInvitationRefusal(task, { ...offer([]), taskPriceCents: null })?.errors.taskPriceCents,
		"required",
	);
	assertEquals(
		hireInvitationRefusal(task, offer([{ stageId: "stg-root", priceCents: 1 }], 90_000))?.errors
			.stages,
		"not_applicable",
	);
	assertEquals(hireInvitationRefusal(task, offer([], 90_000)), null);
});

Deno.test("hireInvitationTotalCents: one ticket per selected stage, or the task price", () => {
	assertEquals(
		hireInvitationTotalCents(
			offer([{ stageId: "stg-a", priceCents: 40_000 }, { stageId: "stg-b", priceCents: 12_500 }]),
		),
		52_500,
	);
	assertEquals(hireInvitationTotalCents(offer([], 90_000)), 90_000);
	assertEquals(hireInvitationTotalCents(offer([])), 0);
});
