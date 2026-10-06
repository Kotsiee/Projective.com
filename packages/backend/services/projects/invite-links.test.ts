import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { ProjectParty } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { InviteLinkService } from "./InviteLinkService.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { clearInviteLinkStore } from "./invite-link-store.ts";

/**
 * invite-links_test — a stage's invite link on the STUB branch (Decision #145): only a managing viewer
 * shares it, a reset kills the old URL, a holder's ask files one request that lands in the stage's
 * Requests queue — never on the roster — and a turned-off link refuses.
 */

function actorOf(userId: string): ReadActor {
	return { userId, contextId: userId, contextType: "personal" };
}
const OWNER = actorOf("u-owner");
const HOLDER = actorOf("u-holder");
const HOLDER_PARTY: ProjectParty = { name: "@holder", avatar: null, handle: "holder" };

/** A pipeline the fixture corpus resolves with the viewer as its owner (see members-stage-probe). */
const PROJECT = "prj-eangynf67d";

async function firstStage(): Promise<string> {
	const read = await ProjectBackendService.members({ projectId: PROJECT }, OWNER);
	assert(read.ok && read.data);
	return read.data.page.stages[0].id;
}

Deno.test("a manager creates, reads, resets and turns off a stage's link", async () => {
	clearInviteLinkStore();
	const stageId = await firstStage();
	const none = await InviteLinkService.stageLink(PROJECT, stageId, OWNER);
	assertEquals(none.data?.link, null, "reading never mints a link");

	const made = await InviteLinkService.act(
		{ projectId: PROJECT, stageId, action: "ensure" },
		OWNER,
	);
	const link = made.data?.link;
	assert(link);
	assertEquals(link.path, `/invite/${link.token}`);
	const again = await InviteLinkService.act(
		{ projectId: PROJECT, stageId, action: "ensure" },
		OWNER,
	);
	assertEquals(again.data?.link?.token, link.token, "ensure is idempotent");

	const reset = await InviteLinkService.act(
		{ projectId: PROJECT, stageId, action: "reset" },
		OWNER,
	);
	assertNotEquals(reset.data?.link?.token, link.token);
	assertEquals((await InviteLinkService.resolve(link.token, HOLDER)).data?.state, "revoked");

	const off = await InviteLinkService.act({ projectId: PROJECT, stageId, action: "revoke" }, OWNER);
	assertEquals(off.data?.link, null);
	assertEquals((await InviteLinkService.stageLink(PROJECT, stageId, OWNER)).data?.link, null);
});

Deno.test("a stage outside the project is refused", async () => {
	clearInviteLinkStore();
	const res = await InviteLinkService.act(
		{ projectId: PROJECT, stageId: "not-a-stage", action: "ensure" },
		OWNER,
	);
	assertEquals(res.ok, false);
	assertEquals(res.status, 404);
});

Deno.test("a holder asks once; the request is queued for the stage, not seated", async () => {
	clearInviteLinkStore();
	const stageId = await firstStage();
	const made = await InviteLinkService.act(
		{ projectId: PROJECT, stageId, action: "ensure" },
		OWNER,
	);
	const token = made.data?.link?.token;
	assert(token);

	assertEquals((await InviteLinkService.resolve(token, OWNER)).data?.state, "manager");
	assertEquals((await InviteLinkService.resolve(token, HOLDER)).data?.state, "open");

	const asked = await InviteLinkService.redeem(
		{ token, message: "Keen to help" },
		HOLDER,
		HOLDER_PARTY,
	);
	assertEquals(asked.status, 201);
	assertEquals((await InviteLinkService.resolve(token, HOLDER)).data?.state, "requested");
	const twice = await InviteLinkService.redeem({ token, message: "" }, HOLDER, HOLDER_PARTY);
	assertEquals(twice.status, 409);

	const roster = await ProjectBackendService.members({ projectId: PROJECT }, OWNER);
	assert(roster.ok && roster.data);
	const request = roster.data.page.requests.find((r) => r.applicant.handle === "holder");
	assert(request, "the request is in the Requests queue");
	assertEquals(request.viaInviteLink, true);
	assertEquals(request.stageId, stageId);
	assertEquals(roster.data.page.members.some((m) => m.party.handle === "holder"), false);
});

Deno.test("an unknown token reads as invalid and cannot be redeemed", async () => {
	clearInviteLinkStore();
	const token = "AAAAAAAAAAAAAAAAAAAAAAAA";
	assertEquals((await InviteLinkService.resolve(token, HOLDER)).data?.state, "invalid");
	const res = await InviteLinkService.redeem({ token, message: "" }, HOLDER, HOLDER_PARTY);
	assertEquals(res.status, 404);
});
