import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { hireLimiter, ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { resetDraftStore } from "./draft-store.ts";
import {
	cooldownMessage,
	CreateProjectSchema,
	HIRE_RATE_LIMIT,
	HIRE_RATE_LIMIT_MESSAGE,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import type { CreateProject, HireInvitation, ProjectFeedParams } from "@projective/types/projects";

/**
 * hire-from-profile_test — the reads a profile's Add-to-project and Hire flows depend on, exercised
 * through the real fat service against the STUB branch (the default a developer runs against).
 *
 * Each of these was a real gap found by driving the surface, not by reading the code:
 *
 *  - a project minted through Quick-Init or the profile's wizard had NO roster, so the assignment
 *    modal's brief read 404'd on a draft one statement old;
 *  - an assignment onto a draft has to be a PLACEHOLDER whatever its stages are priced at, because
 *    there is no live engagement to invite anybody into yet;
 *  - "Add to projects" on a pipeline listing minted a draft the draft store remembered and every
 *    ordinary read forgot, so the board it navigated to rendered beside "Project not found".
 *
 * A tokenless actor selects the stub branch regardless of the environment's gate.
 */

// #region Fixtures
/**
 * An acting identity shaped the way `actorFrom` shapes a personal one: `contextId` IS the user id.
 * The instantiate path carries no ReadActor (its route passes `{ userId }` and the workspace rides
 * the payload), so the service RECONSTRUCTS the write-store owner from those two — and a test actor
 * with an empty `contextId` would read from a bucket no real request ever writes to.
 */
function actorOf(userId: string, contextId = userId): ReadActor {
	return { userId, contextId, contextType: "personal" };
}
const ALICE = actorOf("u-alice");
const BOB = actorOf("u-bob");

function payloadOf(
	overrides: Partial<z.input<typeof CreateProjectSchema>> = {},
): CreateProject {
	return CreateProjectSchema.parse({
		title: "Docs Pipeline Q4",
		format: "pipeline",
		currency: "GBP",
		...overrides,
	});
}

/** The widest feed query — the assertion is presence, and a narrower query could hide the row. */
function feedParams(): ProjectFeedParams {
	return {
		q: "",
		view: "projects",
		involvement: "all",
		sort: "recent",
		scope: "global",
		scopeType: null,
		scopeId: "",
		workspaces: [],
		roles: [],
		formats: [],
		kinds: [],
		statuses: [],
		quick: [],
		requests: [],
		serviceId: "",
	};
}

/** An invitation at the project's own terms, with the seller's intake satisfied. */
function inviteOf(projectId: string, stages: HireInvitation["stages"]): HireInvitation {
	return {
		projectId,
		handle: "@juno",
		message: "",
		stages,
		taskPriceCents: null,
		// `@juno`'s fixture intake asks one required question; answer it so the intake rule is not
		// what these tests end up measuring.
		answers: { scope: "Rewrite the API reference." },
	};
}
// #endregion

// #region A created draft has a roster and takes a placeholder
Deno.test("a project minted through the stub create has a roster the hire brief can read", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.ok && created.data);
	const roster = await ProjectBackendService.members({ projectId: created.data.slug }, ALICE);
	assert(roster.ok && roster.data, roster.message);
	assertEquals(roster.data.page.members.map((m) => m.role), ["client"]);
	assertEquals(roster.data.page.invites, []);
	assertEquals(roster.data.page.viewerCaps.canInvite, true);
	const brief = await ProjectBackendService.hireBrief(created.data.slug, ALICE);
	assert(brief.ok && brief.data, brief.message);
	assertEquals(brief.data.brief.status, "draft");
	assertEquals(brief.data.brief.pricingModel, "per_ticket_stage");
});

Deno.test("hiring onto an unpriced draft is a staged placeholder the roster then lists", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.ok && created.data);
	const brief = await ProjectBackendService.hireBrief(created.data.slug, ALICE);
	assert(brief.ok && brief.data);
	const stage = brief.data.brief.stages[0];
	assertEquals(stage.unitPriceCents, null);

	const hired = await ProjectBackendService.hire(
		inviteOf(created.data.slug, [{ stageId: stage.id, priceCents: null }]),
		ALICE,
	);
	assert(hired.ok && hired.data, hired.message);
	assertEquals(hired.status, 201);
	assertEquals(hired.data.placeholder, true);
	assertEquals(hired.data.total, 0);
	assertEquals(hired.data.invites.length, 1);

	const roster = await ProjectBackendService.members({ projectId: created.data.slug }, ALICE);
	assert(roster.ok && roster.data);
	assertEquals(
		roster.data.page.invites.map((i) => [i.handle, i.status, i.placeholder]),
		[["@juno", "pending", true]],
	);
});

Deno.test("a PRICED draft is still a placeholder — nothing is live to invite anybody into", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(
		payloadOf({ baselineAmountCents: 50_000 }),
		ALICE,
	);
	assert(created.ok && created.data);
	const brief = await ProjectBackendService.hireBrief(created.data.slug, ALICE);
	assert(brief.ok && brief.data);
	const stage = brief.data.brief.stages[0];
	assertEquals(stage.unitPriceCents, 50_000);
	const hired = await ProjectBackendService.hire(
		inviteOf(created.data.slug, [{ stageId: stage.id, priceCents: null }]),
		ALICE,
	);
	assert(hired.ok && hired.data, hired.message);
	assertEquals(hired.data.placeholder, true);
	assertEquals(hired.data.total, 50_000);
});

Deno.test("the seller's intake is enforced on the way in, by field", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.ok && created.data);
	const brief = await ProjectBackendService.hireBrief(created.data.slug, ALICE);
	assert(brief.ok && brief.data);
	const refused = await ProjectBackendService.hire(
		{
			...inviteOf(created.data.slug, [{
				stageId: brief.data.brief.stages[0].id,
				priceCents: null,
			}]),
			answers: {},
		},
		ALICE,
	);
	assertEquals(refused.ok, false);
	assertEquals(refused.status, 422);
	assertEquals(refused.errors?.["answers.scope"], "required");
});

Deno.test("a created draft's roster is invisible to another viewer", async () => {
	resetWriteStore();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.ok && created.data);
	const roster = await ProjectBackendService.members({ projectId: created.data.slug }, BOB);
	assertEquals(roster.ok, false);
});
// #endregion

// #region An instantiated pipeline is a project every read sees
Deno.test("Add-to-projects mints a draft the feed, the detail and the hire brief all resolve", () => {
	resetWriteStore();
	resetDraftStore();
	const added = ProjectBackendService.instantiateService(
		{ serviceId: "sv-juno-0", idempotencyKey: "probe-key-1", workspaceId: null },
		{ userId: ALICE.userId },
	);
	assert(added.ok && added.data, added.message);
	assertEquals(added.data.created, true);
	const slug = added.data.draft.slug;
	return (async () => {
		const detail = await ProjectBackendService.detail(slug, ALICE);
		assert(detail.ok && detail.data, `detail(${slug}) did not resolve`);
		assertEquals(detail.data.detail.status, "draft");
		assertEquals(detail.data.detail.format, "pipeline");

		const setup = await ProjectBackendService.setup(slug, ALICE);
		assert(setup.ok && setup.data);
		// The blueprint's four stages, each at its own floor price in the listing's currency.
		assertEquals(setup.data.setup.stages.length, 4);
		assert(setup.data.setup.stages.every((s) => s.unitPriceCents !== null && s.unitPriceCents > 0));
		assertEquals(setup.data.setup.budget.currency, "USD");

		const feed = await ProjectBackendService.list(feedParams(), ALICE);
		assert(feed.ok && feed.data);
		assert(feed.data.items.some((item) => item.slug === slug), "the draft is in the feed");

		const brief = await ProjectBackendService.hireBrief(slug, ALICE);
		assert(brief.ok && brief.data);
		assertEquals(brief.data.brief.pricingModel, "per_ticket_stage");
		assertEquals(brief.data.brief.stages.length, 4);
	})();
});

Deno.test("a repeat instantiation returns the same draft and mints no second project", async () => {
	resetWriteStore();
	resetDraftStore();
	const first = ProjectBackendService.instantiateService(
		{ serviceId: "sv-juno-0", idempotencyKey: "probe-key-1", workspaceId: null },
		{ userId: ALICE.userId },
	);
	const again = ProjectBackendService.instantiateService(
		{ serviceId: "sv-juno-0", idempotencyKey: "probe-key-1", workspaceId: null },
		{ userId: ALICE.userId },
	);
	assert(first.ok && first.data && again.ok && again.data);
	assertEquals(again.data.created, false);
	assertEquals(again.data.draft.slug, first.data.draft.slug);
	const feed = await ProjectBackendService.list(feedParams(), ALICE);
	assert(feed.ok && feed.data);
	assertEquals(feed.data.items.filter((item) => item.slug === first.data!.draft.slug).length, 1);
});

Deno.test("archiving an instantiated draft removes it from the feed", async () => {
	resetWriteStore();
	resetDraftStore();
	const added = ProjectBackendService.instantiateService(
		{ serviceId: "sv-juno-0", idempotencyKey: "probe-key-2", workspaceId: null },
		{ userId: ALICE.userId },
	);
	assert(added.ok && added.data);
	const slug = added.data.draft.slug;
	const archived = ProjectBackendService.archiveDraft({ projectId: slug }, {
		userId: ALICE.userId,
	});
	assert(archived.ok, archived.message);
	const feed = await ProjectBackendService.list(feedParams(), ALICE);
	assert(feed.ok && feed.data);
	assertEquals(feed.data.items.some((item) => item.slug === slug), false);
});
// #endregion

// #region Re-invitation cooldown + rate limit
Deno.test("hireCooldowns: a seller who declined inside 48 days is locked on that project, and only there", async () => {
	resetWriteStore();
	hireLimiter.reset();
	// `@juno` has a 5-day-old decline on every third fixture project; `@kenji`'s declines are 60
	// days old everywhere, so nothing of theirs is active.
	const juno = await ProjectBackendService.hireCooldowns("@juno", ALICE);
	const kenji = await ProjectBackendService.hireCooldowns("kenji", ALICE);
	assert(Object.keys(juno).length > 0, "expected at least one locked project for @juno");
	assertEquals(kenji, {});
	for (const until of Object.values(juno)) assert(Date.parse(until) > Date.now());
	// A guest has sent nothing.
	assertEquals(
		await ProjectBackendService.hireCooldowns("@juno", {
			userId: "",
			contextId: "",
			contextType: "personal",
		}),
		{},
	);
});

Deno.test("hire: a locked project refuses the send with the date it lifts; the brief carries it", async () => {
	resetWriteStore();
	hireLimiter.reset();
	const cooldowns = await ProjectBackendService.hireCooldowns("@juno", ALICE);
	const [slug, until] = Object.entries(cooldowns)[0];
	const brief = await ProjectBackendService.hireBrief(slug, ALICE, "@juno");
	assert(brief.ok && brief.data, brief.message);
	assertEquals(brief.data.brief.cooldownUntil, until);
	const stage = brief.data.brief.stages[0];
	const refused = await ProjectBackendService.hire(
		inviteOf(slug, stage ? [{ stageId: stage.id, priceCents: null }] : []),
		ALICE,
	);
	assertEquals(refused.ok, false);
	assertEquals(refused.status, 422);
	assertEquals(refused.errors, { projectId: "cooldown" });
	assertEquals(refused.message, cooldownMessage(until));
	// The same project is open to somebody who never declined.
	const other = await ProjectBackendService.hireBrief(slug, ALICE, "@kenji");
	assert(other.ok && other.data);
	assertEquals(other.data.brief.cooldownUntil, null);
});

Deno.test("hire: the eleventh send inside ten minutes is refused, and a refused offer never counts", async () => {
	resetWriteStore();
	hireLimiter.reset();
	const created = await ProjectBackendService.create(payloadOf(), ALICE);
	assert(created.ok && created.data);
	const brief = await ProjectBackendService.hireBrief(created.data.slug, ALICE);
	assert(brief.ok && brief.data);
	const stage = brief.data.brief.stages[0];
	const good = inviteOf(created.data.slug, [{ stageId: stage.id, priceCents: null }]);
	// A refused offer (an unknown stage) spends nothing.
	const bad = await ProjectBackendService.hire(
		inviteOf(created.data.slug, [{ stageId: "stg-nope", priceCents: null }]),
		ALICE,
	);
	assertEquals(bad.status, 422);
	for (let i = 0; i < HIRE_RATE_LIMIT.max; i++) {
		const sent = await ProjectBackendService.hire(good, ALICE);
		assertEquals(sent.status, 201, `send ${i + 1}: ${sent.message}`);
	}
	const limited = await ProjectBackendService.hire(good, ALICE);
	assertEquals(limited.ok, false);
	assertEquals(limited.status, 429);
	assertEquals(limited.message, HIRE_RATE_LIMIT_MESSAGE);
	// Another client is not the one being limited.
	const bobCreated = await ProjectBackendService.create(payloadOf(), BOB);
	assert(bobCreated.ok && bobCreated.data);
	const bobBrief = await ProjectBackendService.hireBrief(bobCreated.data.slug, BOB);
	assert(bobBrief.ok && bobBrief.data);
	const bobSent = await ProjectBackendService.hire(
		inviteOf(bobCreated.data.slug, [{
			stageId: bobBrief.data.brief.stages[0].id,
			priceCents: null,
		}]),
		BOB,
	);
	assertEquals(bobSent.status, 201);
	hireLimiter.reset();
});
// #endregion
