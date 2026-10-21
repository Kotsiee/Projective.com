import { assertEquals } from "@std/assert";
import {
	classifyInviteToken,
	INVITE_RECIPIENTS_MAX,
	parseInviteInput,
} from "@projective/types/invites";
import {
	applyOutcome,
	invalidInputMessage,
	removeRow,
	rowMeta,
	rowTitle,
	seatCaption,
	seatOverflow,
	sendLabel,
	setRowRole,
	stageRecipients,
	toRecipients,
} from "./invite-queue.ts";

Deno.test("classify: an email wins over a handle; a leading @ marks a handle", () => {
	assertEquals(classifyInviteToken("User@Company.com"), {
		type: "email",
		value: "user@company.com",
	});
	assertEquals(classifyInviteToken("@Ravi"), { type: "handle", value: "ravi" });
	assertEquals(classifyInviteToken("ravi"), { type: "handle", value: "ravi" });
	assertEquals(classifyInviteToken("ana.ruiz_2"), { type: "handle", value: "ana.ruiz_2" });
	assertEquals(classifyInviteToken("mailto:ana@x.io"), { type: "email", value: "ana@x.io" });
	assertEquals(classifyInviteToken("<ana@x.io>,"), { type: "email", value: "ana@x.io" });
	assertEquals(classifyInviteToken("a"), null);
	assertEquals(classifyInviteToken("not@valid"), null);
	assertEquals(classifyInviteToken("@@"), null);
});

Deno.test("parse: commas, semicolons, spaces and new lines split; repeats drop; leftovers return", () => {
	const parsed = parseInviteInput("ana@x.io, @ravi;  juno\nANA@x.io  ?? bob@y.co");
	assertEquals(parsed.recipients.map((r) => `${r.type}:${r.value}`), [
		"email:ana@x.io",
		"handle:ravi",
		"handle:juno",
		"email:bob@y.co",
	]);
	assertEquals(parsed.invalid, ["??"]);
});

Deno.test("parse: a mail client's mailboxes reduce to their addresses", () => {
	const parsed = parseInviteInput(`"Ana Ruiz" <ana@x.io>, Bob Lee <bob@y.co>`);
	assertEquals(parsed.recipients.map((r) => r.value), ["ana@x.io", "bob@y.co"]);
	assertEquals(parsed.invalid, []);
});

Deno.test("stage: dedupes silently, honours the surface's refusal, caps at the batch max", () => {
	const first = stageRecipients([], parseInviteInput("@ravi ana@x.io").recipients, "member");
	assertEquals(first.queue.map((r) => [r.key, r.roleId]), [
		["handle:ravi", "member"],
		["email:ana@x.io", "member"],
	]);
	const again = stageRecipients(
		first.queue,
		parseInviteInput("@ravi @owner").recipients,
		"admin",
		(r) => (r.value === "owner" ? "Already a member" : null),
	);
	assertEquals(again.queue.length, 2);
	assertEquals(again.skipped, [{ address: "@owner", reason: "Already a member" }]);

	const many = Array.from({ length: INVITE_RECIPIENTS_MAX + 2 }, (_, i) => `p${i}@x.io`).join(",");
	const capped = stageRecipients([], parseInviteInput(many).recipients, "member");
	assertEquals(capped.queue.length, INVITE_RECIPIENTS_MAX);
	assertEquals(capped.skipped.length, 2);
});

Deno.test("rows: a per-row role clears its refusal; remove unstages; the batch keeps each role", () => {
	let queue = stageRecipients([], parseInviteInput("@ravi ana@x.io").recipients, "member").queue;
	queue = queue.map((r) => ({ ...r, error: "nope" }));
	queue = setRowRole(queue, "handle:ravi", "admin");
	assertEquals(queue[0].error, null);
	assertEquals(queue[1].error, "nope");
	assertEquals(toRecipients(queue), [
		{ type: "handle", value: "ravi", roleId: "admin" },
		{ type: "email", value: "ana@x.io", roleId: "member" },
	]);
	assertEquals(removeRow(queue, "handle:ravi").map((r) => r.key), ["email:ana@x.io"]);
});

Deno.test("outcome: sent rows leave, refused rows stay with the sentence, a whole refusal keeps all", () => {
	const queue = stageRecipients([], parseInviteInput("@ravi ana@x.io bob@y.co").recipients, "m")
		.queue;
	const after = applyOutcome(queue, {
		refused: [{ address: "ana@x.io", message: "Already invited", code: "duplicate" }],
		error: null,
		message: null,
	});
	assertEquals(after.map((r) => [r.key, r.error]), [["email:ana@x.io", "Already invited"]]);
	const whole = applyOutcome(queue, { refused: [], error: "Sign in", message: null });
	assertEquals(whole.length, 3);
});

Deno.test("seats and copy", () => {
	assertEquals(seatCaption({ used: 1, limit: 4 }), "3 of 4 seats free");
	assertEquals(seatCaption({ used: 0, limit: 1 }), "1 of 1 seat free");
	assertEquals(seatCaption({ used: 3, limit: null }), null);
	assertEquals(seatCaption(null), null);
	assertEquals(seatOverflow({ used: 2, limit: 4 }, 3), 1);
	assertEquals(seatOverflow({ used: 2, limit: null }, 30), 0);
	assertEquals(sendLabel(1), "Send invite");
	assertEquals(sendLabel(3), "Send 3 invites");
	assertEquals(rowTitle({ type: "handle", value: "ravi", name: null }), "@ravi");
	assertEquals(rowMeta({ type: "email", value: "a@x.io", name: null }), "Invite by email");
	assertEquals(rowMeta({ type: "handle", value: "ravi", name: "Ravi Shah" }), "@ravi");
	assertEquals(invalidInputMessage(["??"]), `"??" isn't an email address or an @handle.`);
	assertEquals(invalidInputMessage([]), null);
});
