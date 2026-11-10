import { assertEquals } from "@std/assert";
import {
	classifyInviteToken,
	INVITE_RECIPIENTS_MAX,
	parseInviteInput,
} from "@projective/types/invites";
import {
	applyOutcome,
	batchProblem,
	draftBatch,
	invalidInputMessage,
	leftoverDraft,
	seatCaption,
	seatOverflow,
	seatProblem,
	stageRecipients,
	toRecipients,
	typedFragment,
	withPicked,
} from "./invite-queue.ts";
import { type AccessPerson, rowRoleOptions, sortAccess } from "./access-people.ts";

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

Deno.test("bar: the field is one batch at the bar's role; its problem is the first that blocks", () => {
	const batch = draftBatch(
		"@ravi, ana@x.io ?? @owner",
		"member",
		(r) => r.value === "owner" ? "Already a member" : null,
	);
	assertEquals(toRecipients(batch.queue), [
		{ type: "handle", value: "ravi", roleId: "member" },
		{ type: "email", value: "ana@x.io", roleId: "member" },
	]);
	assertEquals(batch.skipped, [{ address: "@owner", reason: "Already a member" }]);
	assertEquals(batch.invalid, ["??"]);
	assertEquals(batchProblem(batch), `"??" isn't an email address or an @handle.`);
	assertEquals(batchProblem({ ...batch, invalid: [] }), "@owner: Already a member");
	assertEquals(batchProblem(draftBatch("@ravi", "member")), null);
});

Deno.test("bar: what is left to fix goes back into the field, refused rows first", () => {
	const batch = draftBatch(
		"@ravi ana@x.io ?? @owner",
		"m",
		(r) => r.value === "owner" ? "Already a member" : null,
	);
	const refused = applyOutcome(batch.queue, {
		refused: [{ address: "ana@x.io", message: "Already invited", code: "duplicate" }],
		error: null,
		message: null,
	});
	assertEquals(leftoverDraft(refused, batch), "ana@x.io, @owner, ??");
	assertEquals(leftoverDraft([], { skipped: [], invalid: [] }), "");
});

Deno.test("bar: a picked suggestion replaces the fragment being typed", () => {
	assertEquals(withPicked("ana@x.io, @ra", "ravi"), "ana@x.io, @ravi, ");
	assertEquals(withPicked("ra", "ravi"), "@ravi, ");
	assertEquals(typedFragment("ana@x.io, @ra"), "ra");
	assertEquals(typedFragment("ana@x.io, "), "");
});

Deno.test("access: owner, then the viewer, then by name; a row keeps its own role on offer", () => {
	const person = (key: string, name: string, extra: Partial<AccessPerson> = {}): AccessPerson => ({
		key,
		name,
		handle: key,
		avatar: null,
		roleId: "member",
		roleLabel: "Member",
		roles: null,
		removable: false,
		self: false,
		owner: false,
		...extra,
	});
	const sorted = sortAccess([
		person("zed", "Zed"),
		person("me", "Me", { self: true }),
		person("amy", "amy"),
		person("own", "Owner", { owner: true }),
	]);
	assertEquals(sorted.map((p) => p.key), ["own", "me", "amy", "zed"]);
	const offered = [{ id: "member", name: "Member" }];
	assertEquals(rowRoleOptions({ roleId: "member", roleLabel: "Member" }, offered), offered);
	assertEquals(
		rowRoleOptions({ roleId: "lead", roleLabel: "Lead" }, offered).map((r) => r.id),
		["lead", "member"],
	);
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
	assertEquals(seatCaption({ used: 1, limit: 4 }), "3 of 4 seats available");
	assertEquals(seatCaption({ used: 0, limit: 1 }), "1 of 1 seat available");
	assertEquals(seatCaption({ used: 3, limit: null }), null);
	assertEquals(seatCaption(null), null);
	assertEquals(seatOverflow({ used: 2, limit: 4 }, 3), 1);
	assertEquals(seatOverflow({ used: 2, limit: null }, 30), 0);
	assertEquals(seatProblem({ used: 2, limit: 4 }, 3), "Only 2 seats are free.");
	assertEquals(seatProblem({ used: 3, limit: 4 }, 2), "Only 1 seat is free.");
	assertEquals(seatProblem({ used: 4, limit: 4 }, 1), "No seats are free.");
	assertEquals(seatProblem({ used: 1, limit: 4 }, 3), null);
	assertEquals(invalidInputMessage(["??"]), `"??" isn't an email address or an @handle.`);
	assertEquals(invalidInputMessage([]), null);
});
