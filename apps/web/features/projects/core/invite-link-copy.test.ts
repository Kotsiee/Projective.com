import { assertEquals, assertStringIncludes } from "@std/assert";
import { InviteLinkState, type InviteLinkView } from "@projective/types/projects";
import { inviteLinkCopy } from "./invite-link-copy.ts";

const VIEW: InviteLinkView = {
	state: "open",
	projectSlug: "prj-xghufr2r5b",
	projectTitle: "Atlas analytics platform",
	stageSlug: "stg-wuxn7a9oce",
	stageName: "Data model",
	sharedByName: "Samuel Nkemelu",
	sharedByHandle: "samuelnkemelu",
};

Deno.test("only an open link offers Ask to join", () => {
	for (const state of InviteLinkState.options) {
		assertEquals(inviteLinkCopy({ ...VIEW, state }).canAsk, state === "open", state);
	}
});

Deno.test("the open state names the stage, the project and who shared it", () => {
	const copy = inviteLinkCopy(VIEW);
	assertStringIncludes(copy.title, "Data model");
	assertStringIncludes(copy.body, "Samuel Nkemelu");
	assertStringIncludes(copy.body, "Atlas analytics platform");
});

Deno.test("a member is sent to the stage, a manager to the Requests section", () => {
	assertEquals(
		inviteLinkCopy({ ...VIEW, state: "member" }).next?.href,
		"/projects/prj-xghufr2r5b/stg-wuxn7a9oce",
	);
	assertEquals(
		inviteLinkCopy({ ...VIEW, state: "manager" }).next?.href,
		"/projects/prj-xghufr2r5b/members?view=requests",
	);
});

Deno.test("an invalid link reads without any project detail", () => {
	const copy = inviteLinkCopy({
		state: "invalid",
		projectSlug: null,
		projectTitle: null,
		stageSlug: null,
		stageName: null,
		sharedByName: null,
		sharedByHandle: null,
	});
	assertEquals(copy.title, "This invite link doesn't work");
	assertEquals(copy.next?.href, "/projects");
});
