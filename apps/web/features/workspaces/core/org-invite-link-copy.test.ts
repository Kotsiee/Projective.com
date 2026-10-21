import { assert, assertEquals } from "@std/assert";
import { OrgInviteLinkState, type OrgInviteLinkView } from "@projective/types/workspace";
import { orgInviteLinkCopy } from "./org-invite-link-copy.ts";

const VIEW: OrgInviteLinkView = {
	state: "open",
	kind: "team",
	workspaceName: "Studio Fern",
	workspaceHandle: "studiofern",
	workspaceAvatar: null,
	roleName: "Lead",
	sharedByName: "Saoirse Byrne",
	sharedByHandle: "saoirsebyrne",
};

Deno.test("org invite copy: only `open` offers Ask to join", () => {
	for (const state of OrgInviteLinkState.options) {
		const copy = orgInviteLinkCopy({ ...VIEW, state });
		assertEquals(copy.canAsk, state === "open", state);
		assert(copy.title.length > 0 && copy.body.length > 0, state);
		if (state !== "open") assert(copy.next, `${state} leaves the reader somewhere to go`);
	}
});

Deno.test("org invite copy: names the role the link offers and who answers", () => {
	const open = orgInviteLinkCopy(VIEW);
	assert(open.body.includes("as Lead"));
	assert(open.body.includes("Saoirse Byrne"));
	assertEquals(
		orgInviteLinkCopy({ ...VIEW, state: "requested" }).body.startsWith("Studio Fern's admins"),
		true,
	);
});

Deno.test("org invite copy: a member is sent to the console, a business to /businesses", () => {
	assertEquals(orgInviteLinkCopy({ ...VIEW, state: "member" }).next?.href, "/teams/studiofern");
	const business = orgInviteLinkCopy({ ...VIEW, kind: "business", state: "revoked" });
	assertEquals(business.next, { label: "Back to your businesses", href: "/businesses" });
	assertEquals(
		orgInviteLinkCopy({ ...VIEW, state: "invited" }).next?.href,
		"/teams?view=invitations",
	);
});

Deno.test("org invite copy: an invalid view without names still reads", () => {
	const copy = orgInviteLinkCopy({
		...VIEW,
		state: "invalid",
		kind: null,
		workspaceName: null,
		workspaceHandle: null,
		roleName: null,
		sharedByName: null,
	});
	assertEquals(copy.title, "This invite link doesn't work");
	assertEquals(copy.next?.href, "/teams");
});
