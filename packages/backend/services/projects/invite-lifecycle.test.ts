import { assert, assertEquals, assertFalse } from "@std/assert";
import { hireLimiter, ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { CreateProjectSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { JUNO_HIRE_INTAKE, stubProfileOverview } from "../profile/test-doubles.ts";

// The seller's profile is a LIVE read; these tests run without a database, so `@juno` — the seller
// the hire-driven cases invite — is supplied by a test double with the intake the hires answer.
stubProfileOverview({ juno: { hireIntake: JUNO_HIRE_INTAKE } });

/**
 * invite-lifecycle_test — the client's management of the invitations they sent, exercised through the
 * fat service on the STUB branch (a tokenless actor selects it regardless of the environment's gate).
 *
 * Each rule here is one the Members tab renders a control for, so a wrong answer is a control that
 * does something other than what its label says:
 *
 *  - a stage page lists the invitations addressed to THAT stage and no other;
 *  - cancel is for an open offer, dismiss for an answered one, and each refuses the other;
 *  - dismissing a decline hides the record and KEEPS the cooldown;
 *  - a forced acceptance seats the invitee, a removal unseats them and retires the record;
 *  - the forcing door does not exist outside development.
 */

// #region Fixtures

function actorOf(userId: string): ReadActor {
	return { userId, contextId: userId, contextType: "personal" };
}
const CLIENT = actorOf("u-client");

/** A pipeline the fixture corpus resolves with the viewer as its OWNER, two stages, five invitations. */
const PROJECT = "prj-tm2bjk9mdq";

function stageSlug(index: number): string {
	const detail = findProjectDetail(PROJECT);
	if (!detail) throw new Error("fixture project missing");
	return detail.channels.stages[index].slug;
}

async function roster(channelId?: string) {
	const res = await ProjectBackendService.members({ projectId: PROJECT, channelId }, CLIENT);
	if (!res.ok || !res.data) throw new Error(`roster read failed: ${res.message}`);
	return res.data.page;
}

function withEnv<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
	const previous = Deno.env.get(name);
	Deno.env.set(name, value);
	return run().finally(() => {
		if (previous === undefined) Deno.env.delete(name);
		else Deno.env.set(name, previous);
	});
}

// #endregion

// #region Scope

Deno.test("project scope lists every invitation; a stage page lists only its own", async () => {
	resetWriteStore();
	const all = await roster();
	const ids = new Set(all.invites.map((i) => i.id));
	assert(ids.has(`${PROJECT}-inv-0`), "the stage-0 offer is on the project list");
	assert(ids.has(`${PROJECT}-inv-1`), "the stage-1 offer is on the project list");
	assert(ids.has(`${PROJECT}-inv-2`), "the whole-project (expired) record is on the project list");
	assert(ids.has(`${PROJECT}-inv-accepted`), "the accepted record is on the project list");

	const stage1 = await roster(stageSlug(1));
	assertEquals(stage1.scope, "channel");
	assertEquals(stage1.stageId, "stage-1");
	for (const invite of stage1.invites) {
		assertEquals(invite.stageId, "stage-1", `${invite.id} is not addressed to stage-1`);
	}
	assert(stage1.invites.some((i) => i.id === `${PROJECT}-inv-1`));
	assertFalse(stage1.invites.some((i) => i.id === `${PROJECT}-inv-0`), "a sibling stage's offer");
	assertFalse(stage1.invites.some((i) => i.id === `${PROJECT}-inv-2`), "a whole-project record");
});

Deno.test("an accepted invitation points at the member it brought in, who is on the roster", async () => {
	resetWriteStore();
	const page = await roster();
	const accepted = page.invites.find((i) => i.status === "accepted");
	assert(accepted, "the corpus carries an accepted record");
	assert(accepted.memberId, "it names its member");
	assert(page.members.some((m) => m.id === accepted.memberId), "and that member is on the roster");
	assert(accepted.acceptedAt, "and says when they joined");
});

// #endregion

// #region Cancel · dismiss

Deno.test("cancel withdraws an open offer and refuses an answered one", async () => {
	resetWriteStore();
	const pending = `${PROJECT}-inv-0`;
	const ok = await ProjectBackendService.inviteAction(
		{ projectId: PROJECT, inviteId: pending, action: "cancel" },
		CLIENT,
	);
	assert(ok.ok, ok.message);
	const after = await roster();
	assertFalse(after.invites.some((i) => i.id === pending), "a cancelled offer leaves the list");

	const declined = `${PROJECT}-inv-3`;
	const refused = await ProjectBackendService.inviteAction(
		{ projectId: PROJECT, inviteId: declined, action: "cancel" },
		CLIENT,
	);
	assertFalse(refused.ok);
	assertEquals(refused.status, 409);
	assertEquals(refused.errors?.inviteId, "not_pending");
});

Deno.test("dismiss hides a declined record and KEEPS the cooldown it started", async () => {
	resetWriteStore();
	hireLimiter.reset();
	// The cooldown is keyed on the invitee's HANDLE, and the corpus's own declines are either outside
	// the window (`@kenji`, 60 days) or email-addressed — so the case needs a fresh identity-addressed
	// offer: mint a project through the stub create, hire `@juno` onto its root stage from her profile,
	// force a decline, then dismiss it.
	const created = await ProjectBackendService.create(
		CreateProjectSchema.parse({ title: "Cooldown probe", format: "pipeline", currency: "GBP" }),
		CLIENT,
	);
	assert(created.ok && created.data, created.message);
	const slug = created.data.slug;
	const brief = await ProjectBackendService.hireBrief(slug, CLIENT, "@juno");
	assert(brief.ok && brief.data, brief.message);
	const sent = await ProjectBackendService.hire(
		{
			projectId: slug,
			handle: "@juno",
			message: "",
			stages: [{ stageId: brief.data.brief.stages[0].id, priceCents: null }],
			taskPriceCents: null,
			// `@juno`'s fixture intake asks one required question; answer it so the intake rule is not
			// what this test ends up measuring.
			answers: { scope: "Rewrite the API reference." },
		},
		CLIENT,
	);
	assert(sent.ok && sent.data, sent.message);
	const target = sent.data.invites[0].id;
	await withEnv("DENO_ENV", "development", async () => {
		const declined = await ProjectBackendService.decideInvite(
			{ projectId: slug, inviteId: target, decision: "decline" },
			CLIENT,
		);
		assert(declined.ok, declined.message);
		assertEquals(declined.data?.invite?.status, "declined");
	});

	const before = await ProjectBackendService.hireCooldowns("@juno", CLIENT);
	assert(before[slug], "the fresh decline locks the pair");

	const dismissed = await ProjectBackendService.inviteAction(
		{ projectId: slug, inviteId: target, action: "dismiss" },
		CLIENT,
	);
	assert(dismissed.ok, dismissed.message);
	const after = await ProjectBackendService.members({ projectId: slug }, CLIENT);
	assert(after.ok && after.data);
	assertFalse(
		after.data.page.invites.some((i) => i.id === target),
		"the dismissed record leaves the list",
	);

	const still = await ProjectBackendService.hireCooldowns("@juno", CLIENT);
	assertEquals(still[slug], before[slug], "dismissing a decline does not lift its cooldown");
});

Deno.test("dismiss refuses an open offer — that is a cancel", async () => {
	resetWriteStore();
	const refused = await ProjectBackendService.inviteAction(
		{ projectId: PROJECT, inviteId: `${PROJECT}-inv-0`, action: "dismiss" },
		CLIENT,
	);
	assertFalse(refused.ok);
	assertEquals(refused.status, 409);
	assertEquals(refused.errors?.inviteId, "still_pending");
});

// #endregion

// #region Forced decisions

Deno.test("a forced acceptance seats the invitee; removing them unseats them and retires the record", async () => {
	resetWriteStore();
	const target = `${PROJECT}-inv-0`; // an email-addressed offer on stage-0
	await withEnv("DENO_ENV", "development", async () => {
		const res = await ProjectBackendService.decideInvite(
			{ projectId: PROJECT, inviteId: target, decision: "accept" },
			CLIENT,
		);
		assert(res.ok, res.message);
		assertEquals(res.data?.invite?.status, "accepted");
		assert(res.data?.invite?.memberId, "the acceptance names the member it produced");
	});

	const page = await roster();
	const record = page.invites.find((i) => i.id === target);
	assert(record && record.status === "accepted");
	const member = page.members.find((m) => m.id === record.memberId);
	assert(member, "the invitee is on the roster");
	assertEquals(member.role, "freelancer");
	assertEquals(member.assignedStages, [record.stageName]);

	// A stage page for stage-0 lists them as a contributor; stage-1's does not list the record.
	const stage0 = await roster(stageSlug(0));
	assertEquals(stage0.members.find((m) => m.id === member.id)?.assignment, "contributor");
	assert(stage0.invites.some((i) => i.id === target));
	const stage1 = await roster(stageSlug(1));
	assertFalse(stage1.invites.some((i) => i.id === target));

	const removed = await ProjectBackendService.removeMember(
		{ projectId: PROJECT, memberId: member.id, stageId: null },
		CLIENT,
	);
	assert(removed.ok, removed.message);
	assertEquals(removed.data?.removedFrom, "project");
	const after = await roster();
	assertFalse(after.members.some((m) => m.id === member.id), "the person left the roster");
	assertFalse(after.invites.some((i) => i.id === target), "the accepted record left the list");
});

Deno.test("a stage-scoped removal takes one seat and leaves the person on the project", async () => {
	resetWriteStore();
	const page = await roster();
	const accepted = page.invites.find((i) => i.status === "accepted");
	assert(accepted?.memberId && accepted.stageId && accepted.stageName);
	const before = page.members.find((m) => m.id === accepted.memberId);
	assert(before && before.assignedStages.includes(accepted.stageName));

	const removed = await ProjectBackendService.removeMember(
		{ projectId: PROJECT, memberId: accepted.memberId, stageId: accepted.stageId },
		CLIENT,
	);
	assert(removed.ok, removed.message);
	assertEquals(removed.data?.removedFrom, "stage");

	const after = await roster();
	const still = after.members.find((m) => m.id === accepted.memberId);
	assert(still, "they are still on the project");
	assertFalse(still.assignedStages.includes(accepted.stageName), "but no longer on that stage");
	assertFalse(after.invites.some((i) => i.id === accepted.id), "the accepted record was retired");

	const stagePage = await roster(stageSlug(1));
	assertFalse(
		stagePage.members.some((m) => m.id === accepted.memberId),
		"that stage's roster no longer lists them",
	);
});

Deno.test("removing yourself or the client side is refused", async () => {
	resetWriteStore();
	const page = await roster();
	const self = await ProjectBackendService.removeMember(
		{ projectId: PROJECT, memberId: page.viewerId, stageId: null },
		CLIENT,
	);
	assertFalse(self.ok);
	assertEquals(self.errors?.memberId, "self");
});

Deno.test("the forcing door and the sent-invitations read do not exist outside development", async () => {
	resetWriteStore();
	await withEnv("DENO_ENV", "production", async () => {
		const forced = await ProjectBackendService.decideInvite(
			{ projectId: PROJECT, inviteId: `${PROJECT}-inv-0`, decision: "accept" },
			CLIENT,
		);
		assertFalse(forced.ok);
		assertEquals(forced.status, 404);
		const sent = await ProjectBackendService.sentInvites(CLIENT);
		assertFalse(sent.ok);
		assertEquals(sent.status, 404);
	});
	// And nothing was recorded by the refused attempt.
	const page = await roster();
	assertEquals(page.invites.find((i) => i.id === `${PROJECT}-inv-0`)?.status, "pending");
});

Deno.test("sent invitations are grouped by project and carry every state", async () => {
	resetWriteStore();
	await withEnv("DENO_ENV", "development", async () => {
		const res = await ProjectBackendService.sentInvites(CLIENT);
		assert(res.ok, res.message);
		const page = res.data!.page;
		const group = page.projects.find((p) => p.id === PROJECT);
		assert(group, "the fixture project is one of the groups");
		assertEquals(group.invites.length, 5);
		const states = new Set(group.invites.map((i) => i.status));
		for (const state of ["pending", "accepted", "declined", "expired"] as const) {
			assert(states.has(state), `${state} is reachable from the corpus`);
		}
		assertEquals(page.total, page.projects.reduce((n, p) => n + p.invites.length, 0));
	});
});

// #endregion
