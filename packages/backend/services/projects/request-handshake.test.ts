import { assert, assertEquals, assertFalse } from "@std/assert";
import { CreateProjectSchema, INVITE_COOLDOWN_DAYS } from "@projective/types/projects";
import type { HireInvitation } from "@projective/types/projects";
import { hireLimiter, ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { clearRequestStore } from "./request-store.ts";
import type { ReadActor } from "../read-actor.ts";
import { JUNO_HIRE_INTAKE, stubProfileOverview } from "../profile/test-doubles.ts";
import { MessagingBackendService } from "../messaging/MessagingBackendService.ts";

stubProfileOverview({ juno: { hireIntake: JUNO_HIRE_INTAKE } });

/*
 * The hiring handshake through the fat service's stub branch (a tokenless actor selects it whatever
 * the environment's gate): the 48-day re-invitation lockout and the instant it reports, the intro
 * message a hire posts into the pair's conversation, and the freelancer-led application with the two
 * answers that close a request. The live twins are `projects.invite_to_project` (cooldown DETAIL),
 * `projects.apply_to_project` and `comms.send_request_message`, pinned by the SQL probe.
 */

const DAY_MS = 86_400_000;
const actorOf = (userId: string): ReadActor => ({
	userId,
	contextId: userId,
	contextType: "personal",
});
const CLIENT = actorOf("u-handshake-client");

function withEnv<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
	const previous = Deno.env.get(name);
	Deno.env.set(name, value);
	return run().finally(() => {
		if (previous === undefined) Deno.env.delete(name);
		else Deno.env.set(name, previous);
	});
}

async function freshProject(title: string): Promise<{ slug: string; stageId: string }> {
	const created = await ProjectBackendService.create(
		CreateProjectSchema.parse({ title, format: "pipeline", currency: "GBP" }),
		CLIENT,
	);
	assert(created.ok && created.data, created.message);
	const brief = await ProjectBackendService.hireBrief(created.data.slug, CLIENT, "@juno");
	assert(brief.ok && brief.data, brief.message);
	return { slug: created.data.slug, stageId: brief.data.brief.stages[0].id };
}

function hireOf(slug: string, stageId: string, message = ""): HireInvitation {
	return {
		projectId: slug,
		handle: "@juno",
		message,
		stages: [{ stageId, priceCents: null }],
		taskPriceCents: null,
		answers: { scope: "Rewrite the API reference." },
	};
}

// #region 48-day lockout
Deno.test("a decline locks re-invitation for exactly 48 days and the refusal carries the ISO instant it reopens", async () => {
	resetWriteStore();
	hireLimiter.reset();
	const { slug, stageId } = await freshProject("Lockout probe");
	const sent = await ProjectBackendService.hire(hireOf(slug, stageId), CLIENT);
	assert(sent.ok && sent.data, sent.message);
	const inviteId = sent.data.invites[0].id;

	const declinedAt = await withEnv("DENO_ENV", "development", async () => {
		const declined = await ProjectBackendService.decideInvite(
			{ projectId: slug, inviteId, decision: "decline" },
			CLIENT,
		);
		assert(declined.ok, declined.message);
		const at = declined.data?.invite?.declinedAt;
		assert(at, "a decline is dated");
		return at;
	});

	const again = await ProjectBackendService.hire(hireOf(slug, stageId), CLIENT);
	assertFalse(again.ok);
	assertEquals(again.status, 422);
	assertEquals(again.errors, { projectId: "cooldown" });
	const reopensAt = again.details?.reopensAt;
	assert(typeof reopensAt === "string", "the refusal names when the project reopens");
	assertEquals(new Date(reopensAt).toISOString(), reopensAt, "an ISO-8601 instant");
	assertEquals(Date.parse(reopensAt) - Date.parse(declinedAt), INVITE_COOLDOWN_DAYS * DAY_MS);

	const other = await freshProject("Another project");
	const elsewhere = await ProjectBackendService.hire(hireOf(other.slug, other.stageId), CLIENT);
	assert(elsewhere.ok, "the lockout is per project");
	hireLimiter.reset();
});

Deno.test("the eleventh hire inside ten minutes is refused 429 with the instant it may retry", async () => {
	resetWriteStore();
	hireLimiter.reset();
	const { slug, stageId } = await freshProject("Rate probe");
	let limited = await ProjectBackendService.hire(hireOf(slug, stageId), CLIENT);
	for (let i = 0; i < 20 && limited.ok; i++) {
		limited = await ProjectBackendService.hire(hireOf(slug, stageId), CLIENT);
	}
	assertEquals(limited.status, 429);
	const retryAt = limited.details?.retryAt;
	assert(typeof retryAt === "string" && Date.parse(retryAt) > Date.now());
	hireLimiter.reset();
});
// #endregion

// #region Intro message
Deno.test("a hire with an intro posts it into the pair's conversation; without one, no conversation opens", async () => {
	resetWriteStore();
	hireLimiter.reset();
	const { slug, stageId } = await freshProject("Intro probe");

	const quiet = await ProjectBackendService.hire(hireOf(slug, stageId), CLIENT);
	assert(quiet.ok && quiet.data, quiet.message);
	assertEquals(quiet.data.conversationId, null);

	const other = await freshProject("Intro probe two");
	const spoken = await ProjectBackendService.hire(
		hireOf(other.slug, other.stageId, "Hi Juno — would love you on this."),
		CLIENT,
	);
	assert(spoken.ok && spoken.data, spoken.message);
	assertEquals(spoken.data.conversationId, "dm-juno");
	const thread = await MessagingBackendService.messages({ conversationId: "dm-juno" }, CLIENT);
	assert(thread.ok && thread.data, thread.message);
	assert(
		thread.data.page.messages.some((m) => m.text.includes("would love you on this")),
		"the intro is the conversation's message",
	);
	hireLimiter.reset();
});
// #endregion

// #region Application and answers
Deno.test("an application is recorded pending, and a second one for the same seat is refused", async () => {
	clearRequestStore();
	const freelancer = actorOf("u-handshake-freelancer");
	const input = {
		projectId: "prj-tm2bjk9mdq",
		stageId: "stg-anything",
		roleId: null,
		message: "I've shipped three of these — call me on +44 7700 900123.",
	};
	const first = await ProjectBackendService.apply(input, freelancer);
	assert(first.ok && first.data, first.message);
	assertEquals(first.status, 201);
	assertEquals(first.data.status, "pending");
	assert(
		first.data.message && !first.data.message.includes("7700 900123"),
		"contact details masked",
	);

	const second = await ProjectBackendService.apply(input, freelancer);
	assertEquals(second.status, 409);
	assertEquals(second.errors, { stageId: "duplicate" });
});

Deno.test("an invitee answers every invitation of a request together; a guest cannot", async () => {
	clearRequestStore();
	const answered = await ProjectBackendService.respondToInvitations(
		{ invitationIds: ["inv-a", "inv-b"], accept: false },
		actorOf("u-handshake-invitee"),
	);
	assert(answered.ok && answered.data, answered.message);
	assertEquals(answered.data.answered, [
		{ id: "inv-a", status: "declined" },
		{ id: "inv-b", status: "declined" },
	]);
	const guest = await ProjectBackendService.respondToInvitations(
		{ invitationIds: ["inv-a"], accept: true },
		actorOf(""),
	);
	assertEquals(guest.status, 401);
});

Deno.test("confirming an applicant's seat answers with where the seat is funded", async () => {
	clearRequestStore();
	const confirmed = await ProjectBackendService.acceptApplication(
		{ applicationId: "app-1" },
		CLIENT,
	);
	assert(confirmed.ok && confirmed.data, confirmed.message);
	assertEquals(confirmed.data, { id: "app-1", status: "accepted", fundHref: "/wallet#upcoming" });
});
// #endregion
