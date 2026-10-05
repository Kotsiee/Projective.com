import { assert, assertEquals } from "@std/assert";
import { hireLimiter, ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { INVITE_BATCH_MAX, InviteProjectMemberInputSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";

/**
 * membership-writes_test — "Create stage", "Invite people" and "Change role" through the fat service's
 * STUB branch (a tokenless actor selects it). The property under test is the one the surfaces used to
 * lack: each write is visible to the NEXT read, so a reload shows what the action did.
 */

const CLIENT: ReadActor = {
	userId: "u-membership-client",
	contextId: "u-membership-client",
	contextType: "personal",
};

/** A pipeline the fixture corpus resolves with the viewer as its owner. */
const PROJECT = "prj-tm2bjk9mdq";
/** A pipeline whose setup stages and board stages are the same ids, so an appended stage sorts last. */
const STAGED = "prj-eangynf67d";

function reset(): void {
	resetWriteStore();
	hireLimiter.reset();
}

async function roster() {
	const res = await ProjectBackendService.members({ projectId: PROJECT }, CLIENT);
	if (!res.ok || !res.data) throw new Error(`roster read failed: ${res.message}`);
	return res.data.page;
}

Deno.test("a created stage is answered as the board projects it, and the next board read has it", async () => {
	reset();
	const res = await ProjectBackendService.createStage(
		STAGED,
		{ name: "Launch review", description: "Final checks" },
		CLIENT,
	);
	assertEquals(res.status, 201);
	assert(res.ok && res.data);
	assertEquals(res.data.stage.name, "Launch review");
	assertEquals(res.data.stage.description, "Final checks");

	const board = await ProjectBackendService.board({ projectId: STAGED, view: "stages" }, CLIENT);
	assert(board.ok && board.data);
	const stages = board.data.page.stages;
	assert(stages.some((s) => s.id === res.data!.stage.id), "the stage survives a re-read");
	assertEquals(stages.at(-1)?.id, res.data.stage.id, "appended after every existing stage");
});

Deno.test("a stage create needs an identity", async () => {
	reset();
	const res = await ProjectBackendService.createStage(
		PROJECT,
		{ name: "x", description: "" },
		{ userId: "", contextId: "", contextType: "personal" },
	);
	assertEquals(res.status, 401);
});

Deno.test("a role change persists across reads, and the viewer cannot change their own", async () => {
	reset();
	const page = await roster();
	const target = page.members.find((m) => !m.isViewer && m.role !== "owner" && m.role !== "client");
	assert(target, "the fixture roster has a member to edit");
	const next = target.role === "manager" ? "guest" : "manager";

	const res = await ProjectBackendService.updateMemberRole(PROJECT, target.id, next, CLIENT);
	assert(res.ok && res.data);
	assertEquals(res.data, { memberId: target.id, role: next, changed: true });
	assertEquals((await roster()).members.find((m) => m.id === target.id)?.role, next);

	const again = await ProjectBackendService.updateMemberRole(PROJECT, target.id, next, CLIENT);
	assertEquals(again.data?.changed, false);

	const self = page.members.find((m) => m.isViewer);
	if (self) {
		const refused = await ProjectBackendService.updateMemberRole(PROJECT, self.id, "guest", CLIENT);
		assertEquals(refused.ok, false);
	}
});

Deno.test("invitations land in the queue a re-read returns; a duplicate is refused per address", async () => {
	reset();
	const sent = await ProjectBackendService.inviteMember(
		PROJECT,
		{ addresses: ["ada@example.org", "@newcomer"], role: "member", stageId: null },
		CLIENT,
	);
	assertEquals(sent.status, 201);
	assert(sent.ok && sent.data);
	assertEquals(sent.data.invites.length, 2);
	assertEquals(sent.data.refused, []);
	const queue = (await roster()).invites.map((i) => i.email);
	assert(queue.includes("ada@example.org") && queue.includes("@newcomer"));

	const partial = await ProjectBackendService.inviteMember(
		PROJECT,
		{ addresses: ["ada@example.org", "grace@example.org"], role: "member", stageId: null },
		CLIENT,
	);
	assert(partial.ok && partial.data);
	assertEquals(partial.data.invites.map((i) => i.email), ["grace@example.org"]);
	assertEquals(partial.data.refused.map((r) => r.code), ["duplicate"]);
});

Deno.test("the outbound ceiling is shared with the Hire flow and answers 429 once spent", async () => {
	reset();
	const addresses = Array.from({ length: INVITE_BATCH_MAX }, (_, i) => `p${i}@example.org`);
	const first = await ProjectBackendService.inviteMember(
		PROJECT,
		{ addresses, role: "guest", stageId: null },
		CLIENT,
	);
	assertEquals(first.data?.invites.length, INVITE_BATCH_MAX);
	const over = await ProjectBackendService.inviteMember(
		PROJECT,
		{ addresses: ["one-more@example.org"], role: "guest", stageId: null },
		CLIENT,
	);
	assertEquals(over.status, 429);
});

Deno.test("the invite schema normalises case, drops repeats and refuses a non-address", () => {
	const parsed = InviteProjectMemberInputSchema.parse({
		addresses: ["Ada@Example.org", "ada@example.org", "@Juno"],
	});
	assertEquals(parsed.addresses, ["ada@example.org", "@juno"]);
	assertEquals(parsed.role, "freelancer");
	assertEquals(
		InviteProjectMemberInputSchema.safeParse({ addresses: ["not an address"] }).success,
		false,
	);
});
