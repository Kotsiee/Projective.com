/** The intake form's model (Decision #276): which fields travel, the shared pre-check, the files. */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	attachmentsInFlight,
	checkSubmission,
	counterText,
	EMPTY_CONTACT_FORM,
	firstErrorField,
	readyAttachmentIds,
	submissionInput,
} from "./contact-model.ts";

const FILE = "00000000-0000-4000-8000-0000000000a1";
const filled = {
	...EMPTY_CONTACT_FORM,
	name: "Ada",
	email: "ada@example.com",
	company: "Analytical Ltd",
	message: "We'd like a walkthrough for a team of twelve.",
	reportType: "vulnerability",
};

Deno.test("the empty form opens every select on a real choice, so the no-JS form can be sent", () => {
	assertEquals(EMPTY_CONTACT_FORM.companySize, "not-say");
	assertEquals(EMPTY_CONTACT_FORM.budget, "not-sure");
	assertEquals(EMPTY_CONTACT_FORM.topic, "other");
	assertEquals(EMPTY_CONTACT_FORM.reportType, "", "the report type is chosen on purpose");
	assert(checkSubmission(submissionInput("sales", filled, [])).ok);
	assert(checkSubmission(submissionInput("support", filled, [])).ok);
});

Deno.test("submissionInput: only the intent's fields travel; sales never carries files", () => {
	const sales = submissionInput("sales", filled, [FILE]);
	assertFalse("attachmentIds" in sales);
	assertFalse("topic" in sales);
	const support = submissionInput("support", filled, [FILE]);
	assertEquals(support.attachmentIds, [FILE]);
	assertFalse("company" in support);
	const dispute = submissionInput("dispute", { ...filled, engagementSlug: "prj-a" }, [FILE]);
	assertEquals(dispute.engagementSlug, "prj-a");
});

Deno.test("submissionInput: an anonymous report drops name, address and files", () => {
	const anon = submissionInput("security", { ...filled, anonymous: true }, [FILE]);
	assertFalse("name" in anon);
	assertFalse("email" in anon);
	assertEquals(anon.attachmentIds, []);
	assert(checkSubmission(anon).ok);
	const named = submissionInput("security", filled, [FILE]);
	assertEquals(named.name, "Ada");
	assertEquals(named.attachmentIds, [FILE]);
});

Deno.test("checkSubmission: one person-readable message per field", () => {
	const res = checkSubmission(
		submissionInput("security", { ...filled, reportType: "", email: "nope", message: "hi" }, []),
	);
	assertFalse(res.ok);
	if (res.ok) return;
	assertEquals(res.errors.reportType, "Choose what you're reporting.");
	assert(res.errors.email);
	assert(res.errors.message);
	assertEquals(firstErrorField("security", res.errors), "reportType");
	assertEquals(firstErrorField("support", {}), null);
});

Deno.test("attachments: only admitted files are sent; files on their way hold the request", () => {
	const entries = {
		a: { phase: "ready" as const, attachmentId: FILE },
		b: { phase: "scanning" as const },
		c: { phase: "refused" as const, message: "Programs can't be attached." },
		d: { phase: "uploading" as const },
	};
	assertEquals(readyAttachmentIds(entries), [FILE]);
	assertEquals(attachmentsInFlight(entries), 2);
	assertEquals(attachmentsInFlight({}), 0);
});

Deno.test("counterText: grouped, tabular-friendly", () => {
	assertEquals(counterText(0, 5000), "0 / 5,000");
	assertEquals(counterText(1234, 5000), "1,234 / 5,000");
});
