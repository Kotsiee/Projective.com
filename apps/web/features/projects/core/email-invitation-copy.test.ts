import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { EmailInvitationState, type EmailInvitationView } from "@projective/types/projects";
import { EMAIL_SETTINGS_HREF, emailInvitationCopy } from "./email-invitation-copy.ts";

const OPEN: EmailInvitationView = {
	state: "open",
	projectSlug: "prj-6ndtxa9u9x",
	projectTitle: "Brand refresh",
	stageName: "Discovery",
	inviterName: "Helia Moreno",
	role: "freelancer",
	addressHint: null,
	expiresAt: null,
};

Deno.test("emailInvitationCopy — only an open invitation can be answered", () => {
	for (const state of EmailInvitationState.options) {
		assertEquals(emailInvitationCopy({ ...OPEN, state }).canAnswer, state === "open", state);
	}
});

Deno.test("emailInvitationCopy — open names the inviter, the stage, the project and the role", () => {
	const copy = emailInvitationCopy(OPEN);
	assertEquals(copy.title, "Join Discovery");
	assertEquals(
		copy.body,
		"Helia Moreno invited you to Discovery on Brand refresh, as a freelancer.",
	);
});

Deno.test("emailInvitationCopy — accepted opens the project", () => {
	assertEquals(emailInvitationCopy({ ...OPEN, state: "accepted" }).next, {
		label: "Open the project",
		href: "/projects/prj-6ndtxa9u9x",
	});
});

Deno.test("emailInvitationCopy — not_yours names the masked address and where to add one", () => {
	const copy = emailInvitationCopy({
		...OPEN,
		state: "not_yours",
		projectSlug: null,
		addressHint: "n•••@example.com",
	});
	assertStringIncludes(copy.body, "n•••@example.com");
	assertEquals(copy.next?.href, EMAIL_SETTINGS_HREF);
});

Deno.test("emailInvitationCopy — an invalid link reads without any project fields", () => {
	const copy = emailInvitationCopy({
		state: "invalid",
		projectSlug: null,
		projectTitle: null,
		stageName: null,
		inviterName: null,
		role: null,
		addressHint: null,
		expiresAt: null,
	});
	assert(copy.title.length > 0 && copy.next?.href === "/projects");
});
