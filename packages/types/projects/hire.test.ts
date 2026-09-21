import { assert, assertEquals } from "@std/assert";
import {
	activeInviteCooldown,
	buildHireBrief,
	cooldownActive,
	cooldownDateLabel,
	type HireBrief,
	type HireInvitation,
	hireInvitationRefusal,
	hireInvitationTotalCents,
	hirePricingModelFor,
	resolveHireOffer,
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
	status: "draft" | "active" = "active",
) {
	return reconcileSetup({
		id: "11111111-1111-4111-8111-111111111111",
		slug: "prj-test000001",
		title: "Helia wallet redesign",
		format,
		structure,
		status,
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
		answers: {},
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
	answers: {},
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
	// A null task price on a PRICED project resolves to the configured figure, so it is accepted.
	assertEquals(hireInvitationRefusal(task, { ...offer([]), taskPriceCents: null }), null);
	// An UNPRICED live project has nothing to offer and must be priced first. (A single-stage
	// one-off falls back to the project budget, so the brief itself is unpriced here, not the stage.)
	const unpriced: HireBrief = { ...task, taskPriceCents: null };
	assertEquals(
		hireInvitationRefusal(unpriced, { ...offer([]), taskPriceCents: null })?.errors.taskPriceCents,
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

Deno.test("hireInvitationRefusal: a live project refuses an unpriced stage; a draft takes a placeholder", () => {
	// `stg-b` carries no configured rate. On the LIVE pipeline that is a gap the client must close.
	const live = hireInvitationRefusal(pipeline, offer([{ stageId: "stg-b", priceCents: null }]));
	assertEquals(live?.errors.stages, "unpriced");
	// The same stage on a DRAFT is a placeholder assignment — attached now, priced at publish.
	const draft = buildHireBrief(setupFor("pipeline", "standard", undefined, "draft"), roster);
	assertEquals(hireInvitationRefusal(draft, offer([{ stageId: "stg-b", priceCents: null }])), null);
	const resolved = resolveHireOffer(
		draft,
		offer([{ stageId: "stg-a", priceCents: null }, { stageId: "stg-b", priceCents: null }]),
	);
	assertEquals(resolved.placeholder, true);
	assertEquals(resolved.totalCents, null);
	assertEquals(resolved.stages[0].priceCents, 40_000);
	assertEquals(resolved.stages[1].priceCents, null);
	// A fully PRICED draft is still a placeholder — nothing is live to invite anybody into — but its
	// total is known and is carried, because the modal prints the figures it has.
	const pricedDraft = resolveHireOffer(draft, offer([{ stageId: "stg-a", priceCents: null }]));
	assertEquals(pricedDraft.placeholder, true);
	assertEquals(pricedDraft.totalCents, 40_000);
});

Deno.test("resolveHireOffer: a caller's figure wins over the configured rate, else the rate applies", () => {
	const resolved = resolveHireOffer(
		pipeline,
		offer([{ stageId: "stg-a", priceCents: 55_000 }]),
	);
	assertEquals(resolved.stages, [{ stageId: "stg-a", priceCents: 55_000 }]);
	assertEquals(resolved.totalCents, 55_000);
	assertEquals(resolved.placeholder, false);
	const configured = resolveHireOffer(pipeline, offer([{ stageId: "stg-a", priceCents: null }]));
	assertEquals(configured.totalCents, 40_000);
	// A task model resolves to its one figure and no stages.
	const task = buildHireBrief(
		setupFor("one_off", "single_stage", [priced("stg-root", 0, 90_000)]),
		roster,
	);
	assertEquals(resolveHireOffer(task, offer([])), {
		stages: [],
		taskPriceCents: 90_000,
		placeholder: false,
		totalCents: 90_000,
	});
});

Deno.test("activeInviteCooldown: a decline inside 48 days locks the pair; older, pending or other people do not", () => {
	const NOW = Date.parse("2026-07-17T16:20:00.000Z");
	const day = 86_400_000;
	const declined = (daysAgo: number, handle = "@juno") => ({
		status: "declined" as const,
		declinedAt: new Date(NOW - daysAgo * day).toISOString(),
		handle,
	});
	// Five days ago → lifts 43 days from now.
	const until = activeInviteCooldown([declined(5)], "juno", NOW);
	assertEquals(until, new Date(NOW + 43 * day).toISOString());
	assertEquals(cooldownActive(until, NOW), true);
	assertEquals(cooldownActive(until, NOW + 43 * day), false);
	assertEquals(cooldownDateLabel(until as string), "29 Aug 2026");
	// The LATEST decline governs when there are several.
	assertEquals(
		activeInviteCooldown([declined(30), declined(2)], "@juno", NOW),
		new Date(NOW + 46 * day).toISOString(),
	);
	// Elapsed, pending, expired, and somebody else's decline all start nothing.
	assertEquals(activeInviteCooldown([declined(60)], "juno", NOW), null);
	assertEquals(activeInviteCooldown([declined(48)], "juno", NOW), null);
	assertEquals(
		activeInviteCooldown([{ status: "pending", declinedAt: null, handle: "@juno" }], "juno", NOW),
		null,
	);
	assertEquals(activeInviteCooldown([declined(5, "@kenji")], "juno", NOW), null);
	// Handle matching is bare and case-insensitive: `@Juno` and `juno` name one person.
	assertEquals(activeInviteCooldown([declined(5, "Juno")], "@JUNO", NOW) !== null, true);
});

Deno.test("hireInvitationRefusal: an active cooldown refuses with the date it lifts", () => {
	const NOW = Date.parse("2026-07-17T16:20:00.000Z");
	const day = 86_400_000;
	const withCooldown: MemberRosterPage = {
		...roster,
		invites: [{
			id: "inv-declined",
			email: "@juno",
			handle: "@juno",
			role: "freelancer",
			stageId: "stg-a",
			stageName: "Stage 1",
			invitedBy: "Mara Ellison",
			invitedAt: new Date(NOW - 6 * day).toISOString(),
			invitedLabel: "6 days ago",
			status: "declined",
			declinedAt: new Date(NOW - 5 * day).toISOString(),
		}],
	};
	const locked = buildHireBrief(setupFor("pipeline", "standard"), withCooldown, {
		handle: "juno",
		nowMs: NOW,
	});
	assertEquals(locked.cooldownUntil, new Date(NOW + 43 * day).toISOString());
	const refused = hireInvitationRefusal(
		locked,
		offer([{ stageId: "stg-a", priceCents: null }]),
		NOW,
	);
	assertEquals(refused?.errors, { projectId: "cooldown" });
	assertEquals(
		refused?.message,
		"You can invite this freelancer to this project again after 29 Aug 2026.",
	);
	// Once it has lifted, the same brief admits the same offer.
	assertEquals(
		hireInvitationRefusal(locked, offer([{ stageId: "stg-a", priceCents: null }]), NOW + 44 * day),
		null,
	);
	// A brief built for ANOTHER seller carries no cooldown from Juno's decline.
	const other = buildHireBrief(setupFor("pipeline", "standard"), withCooldown, {
		handle: "kenji",
		nowMs: NOW,
	});
	assertEquals(other.cooldownUntil, null);
	// And a brief built for nobody carries none at all.
	assertEquals(buildHireBrief(setupFor("pipeline", "standard"), withCooldown).cooldownUntil, null);
});
