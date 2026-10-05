import { assert, assertEquals, assertFalse } from "@std/assert";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import { clearRequestStore } from "./request-store.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import type { MemberRosterParams } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";

/**
 * member-requests_test — the Members tab's Requests section and session seat picture, through the fat
 * service's STUB branch (a tokenless actor selects it regardless of the environment's gate). Each rule
 * is one the tab renders a control or a figure for: who sees the queue, which stage page lists which
 * request, what Accept and Reject leave behind, and which engagements state a seat picture.
 */

const CLIENT: ReadActor = {
	userId: "u-requests-client",
	contextId: "u-requests-client",
	contextType: "personal",
};

/** A pipeline the fixture corpus resolves with the viewer as its owner and more than one stage. */
const PROJECT = "prj-tm2bjk9mdq";

async function roster(params: Partial<MemberRosterParams> = {}) {
	const res = await ProjectBackendService.members({ projectId: PROJECT, ...params }, CLIENT);
	if (!res.ok || !res.data) throw new Error(`roster read failed: ${res.message}`);
	return res.data.page;
}

function reset(): void {
	resetWriteStore();
	clearRequestStore();
}

Deno.test("a managing viewer gets the open requests; each names the stage it applied to", async () => {
	reset();
	const page = await roster();
	assert(page.requests.length > 0, "the fixture project carries open requests");
	for (const request of page.requests) {
		assert(request.stageId, "every fixture request targets a stage");
		assert(page.stages.some((stage) => stage.id === request.stageId));
	}
});

Deno.test("a stage page lists only the requests addressed to that stage", async () => {
	reset();
	const all = await roster();
	const target = all.requests[0];
	const detail = findProjectDetail(PROJECT);
	const channel = detail?.channels.stages.find((stage) => stage.id === target.stageId);
	assert(channel, "the request's stage has a channel");
	const stagePage = await roster({ channelId: channel.slug });
	assert(stagePage.requests.every((request) => request.stageId === stagePage.stageId));
	assert(stagePage.requests.some((request) => request.id === target.id));
});

Deno.test("the queue is withheld from a non-managing viewer and when the dev toggle is off", async () => {
	reset();
	assertEquals((await roster({ simViewer: "freelancer_assigned" })).requests, []);
	assertEquals((await roster({ simPendingRequests: false })).requests, []);
});

Deno.test("reject drops the request, and a second answer to it is refused", async () => {
	reset();
	const [target] = (await roster()).requests;
	const first = await ProjectBackendService.rejectApplication({ applicationId: target.id }, CLIENT);
	assert(first.ok, first.message);
	assertEquals(first.data?.status, "rejected");
	assertFalse((await roster()).requests.some((request) => request.id === target.id));
	const again = await ProjectBackendService.rejectApplication({ applicationId: target.id }, CLIENT);
	assertFalse(again.ok);
	assertEquals(again.status, 409);
});

Deno.test("accept seats the applicant on the roster and drops the request", async () => {
	reset();
	const [target] = (await roster()).requests;
	const res = await ProjectBackendService.acceptApplication({ applicationId: target.id }, CLIENT);
	assert(res.ok, res.message);
	const page = await roster();
	assertFalse(page.requests.some((request) => request.id === target.id));
	const seated = page.members.find((member) => member.party.handle === target.applicant.handle);
	assert(seated, "the applicant is on the roster");
	assertEquals(seated.role, "freelancer");
	assertEquals(seated.assignedStages, target.stageName ? [target.stageName] : []);
});

Deno.test("only a session engagement states a seat picture, with each attendee's standing", async () => {
	reset();
	assertEquals((await roster()).session, null);
	const session = await roster({ simProjectType: "session" });
	assert(session.session, "a session roster carries its seat picture");
	assert(session.session.seatsTaken >= 1);
	assert(session.members.some((member) => member.attendance), "attendees carry their standing");
	assertEquals(session.requests, [], "a session has no stages to apply to");
});
