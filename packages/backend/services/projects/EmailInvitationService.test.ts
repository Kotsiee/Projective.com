import { assert, assertEquals } from "@std/assert";
import type { MailMessage } from "../mail/transport.ts";
import type { InvitationMailRow } from "../mail/invitation-mailer.ts";
import { EmailInvitationService } from "./EmailInvitationService.ts";

const ROW: InvitationMailRow = {
	mail_id: "m1",
	email: "new.person@example.com",
	token: "b".repeat(64),
	project_title: "Brand refresh",
	stage_name: null,
	inviter_name: "Helia Moreno",
	role: "member",
	expires_at: null,
};

function sweep(rows: InvitationMailRow[], outcome: "sent" | "logged" | "unavailable") {
	const finished: Record<string, unknown>[] = [];
	const sent: MailMessage[] = [];
	const lines: string[] = [];
	const run = EmailInvitationService.sendDue(25, {
		appUrl: "https://projective.example",
		door: (name, args) => {
			if (name === "finish_invitation_mail") finished.push(args);
			return Promise.resolve({ data: name === "claim_invitation_mail" ? rows : null, error: null });
		},
		deliver: (message, _what, devLine) => {
			sent.push(message);
			lines.push(devLine);
			return Promise.resolve(outcome);
		},
	});
	return { run, finished, sent, lines };
}

Deno.test("sendDue — each claimed invitation is mailed to its address and finished as sent", async () => {
	const { run, finished, sent } = sweep([ROW], "sent");
	assertEquals((await run).data, { sent: 1, failed: 0 });
	assertEquals(finished, [{ p_mail: "m1", p_sent: true }]);
	assertEquals(sent[0].to, ROW.email);
});

Deno.test("sendDue — the development console counts as delivered and shows the link", async () => {
	const { run, lines } = sweep([ROW], "logged");
	await run;
	assert(lines[0].includes(`/invite/${ROW.token}`));
});

Deno.test("sendDue — what could not go is finished unsent, to be tried again", async () => {
	const { run, finished } = sweep([ROW], "unavailable");
	assertEquals((await run).data, { sent: 0, failed: 1 });
	assertEquals(finished, [{ p_mail: "m1", p_sent: false }]);
});

Deno.test("sendDue — nothing claimed, nothing sent", async () => {
	const { run, sent } = sweep([], "sent");
	assertEquals((await run).data, { sent: 0, failed: 0 });
	assertEquals(sent.length, 0);
});

Deno.test("resolve — a token of the wrong shape reads invalid before any read", async () => {
	const actor = { userId: "u1", accessToken: "t" } as Parameters<
		typeof EmailInvitationService.resolve
	>[1];
	assertEquals(
		(await EmailInvitationService.resolve("../../etc/passwd", actor)).data?.state,
		"invalid",
	);
	assertEquals(
		(await EmailInvitationService.resolve("A".repeat(64), actor)).data?.state,
		"invalid",
	);
});
