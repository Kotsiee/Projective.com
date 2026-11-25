import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { invitationLink, type InvitationMailRow, invitationMessage } from "./invitation-mailer.ts";

const ROW: InvitationMailRow = {
	mail_id: "m1",
	email: "new.person@example.com",
	token: "a".repeat(64),
	project_title: "Brand refresh",
	stage_name: "Discovery",
	inviter_name: "Helia Moreno",
	role: "freelancer",
	expires_at: "2026-12-09T10:00:00Z",
};

Deno.test("invitationLink — the invitation's own /invite/<token> on the app's origin", () => {
	assertEquals(
		invitationLink("https://projective.example/", ROW.token),
		`https://projective.example/invite/${ROW.token}`,
	);
});

Deno.test("invitationMessage — names the inviter, the stage and the project, and carries the link", () => {
	const message = invitationMessage(ROW, "https://projective.example");
	assertEquals(message.to, ROW.email);
	assertEquals(message.subject, "Helia Moreno invited you to Discovery on Projective");
	assertStringIncludes(message.text, "Brand refresh · Discovery");
	assertStringIncludes(message.text, "as a freelancer");
	assertStringIncludes(message.text, `https://projective.example/invite/${ROW.token}`);
	assertStringIncludes(message.text, "9 December 2026");
});

Deno.test("invitationMessage — says which address opens it, and that ignoring it is safe", () => {
	const { text } = invitationMessage(ROW, "https://projective.example");
	assertStringIncludes(text, `sign up with ${ROW.email}`);
	assertStringIncludes(text, "you can ignore it");
	assert(!/remind/i.test(text), "one transactional mail: it promises no reminder");
});

Deno.test("invitationMessage — a whole-project invitation with no inviter name still reads", () => {
	const { subject, text } = invitationMessage(
		{ ...ROW, stage_name: null, inviter_name: null, role: "admin", expires_at: null },
		"https://projective.example",
	);
	assertEquals(subject, "Someone invited you to Brand refresh on Projective");
	assertStringIncludes(text, "as an admin");
	assert(!text.includes("expires"), "no expiry, no expiry line");
});
