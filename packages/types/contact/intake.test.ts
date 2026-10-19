/**
 * The contact intake's SSOT (Decision #276): what each intent accepts, what it stores, the reference
 * format and the lifecycle. These are the rules the island pre-checks with, the route and the service
 * re-check with, and the writer mirrors — pinned without a database.
 */
import { assert, assertEquals, assertFalse, assertMatch, assertThrows } from "@std/assert";
import {
	canMoveContactRequest,
	CONTACT_OTHER_TOPIC,
	CONTACT_PAYLOAD_KEYS,
	CONTACT_REFERENCE_ALPHABET,
	CONTACT_STATUS_TRANSITIONS,
	ContactReceiptSchema,
	type ContactSubmission,
	ContactSubmissionSchema,
	ContactSupportTopic,
	contactSupportTopics,
	DEFAULT_CONTACT_INTENT,
	engagementHref,
	formatContactReference,
	intentTakesAttachments,
	isAnonymousSubmission,
	isContactReference,
	parseContactIntent,
	replyAddressOf,
	toStoredPayload,
} from "./intake.ts";
import { HELP_CENTRE_CATEGORY_SLUGS } from "../editorial/help-categories.ts";

const MESSAGE = "My payout has not arrived seven days after the stage was approved.";
const FILE = "00000000-0000-4000-8000-0000000000a1";

function parse(input: Record<string, unknown>): ContactSubmission {
	const parsed = ContactSubmissionSchema.safeParse(input);
	if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
	return parsed.data;
}

function issues(input: Record<string, unknown>): string[] {
	const parsed = ContactSubmissionSchema.safeParse(input);
	assertFalse(parsed.success, "expected a refusal");
	return parsed.error.issues.map((i) => String(i.path[0]));
}

// #region Intents
Deno.test("parseContactIntent: the four intents, anything else is support", () => {
	assertEquals(parseContactIntent("sales"), "sales");
	assertEquals(parseContactIntent("security"), "security");
	assertEquals(parseContactIntent("SALES"), DEFAULT_CONTACT_INTENT);
	assertEquals(parseContactIntent(""), "support");
	assertEquals(parseContactIntent(null), "support");
	assertEquals(parseContactIntent(undefined), "support");
	assertEquals(parseContactIntent("press"), "support");
});

Deno.test("intentTakesAttachments: every intent but sales", () => {
	assertFalse(intentTakesAttachments("sales"));
	assert(intentTakesAttachments("support"));
	assert(intentTakesAttachments("dispute"));
	assert(intentTakesAttachments("security"));
});
// #endregion

// #region Submissions
Deno.test("sales: company, size and budget are required choices", () => {
	const s = parse({
		intent: "sales",
		name: " Ada ",
		email: "ada@example.com",
		company: "Analytical Ltd",
		companySize: "11-50",
		budget: "5k-25k",
		message: MESSAGE,
	});
	assertEquals(s.intent, "sales");
	if (s.intent !== "sales") return;
	assertEquals(s.name, "Ada");
	assertEquals(s.ctc_hp, "");
	assertEquals(
		issues({
			intent: "sales",
			name: "Ada",
			email: "ada@example.com",
			companySize: "huge",
			budget: "x",
			message: MESSAGE,
		})
			.sort(),
		["budget", "company", "companySize"],
	);
});

Deno.test("support: account email optional but well formed; topic required; attachments defaulted", () => {
	const s = parse({
		intent: "support",
		name: "Ada",
		email: "ada@example.com",
		topic: "escrow-and-payments",
		message: MESSAGE,
	});
	if (s.intent !== "support") throw new Error("intent");
	assertEquals(s.accountEmail, "");
	assertEquals(s.attachmentIds, []);
	assertEquals(
		issues({
			intent: "support",
			name: "Ada",
			email: "ada@example.com",
			accountEmail: "nope",
			topic: "escrow-and-payments",
			message: MESSAGE,
		}),
		["accountEmail"],
	);
	assertEquals(
		issues({ intent: "support", name: "Ada", email: "ada@example.com", message: MESSAGE }),
		["topic"],
	);
});

Deno.test("message: 20 to 5,000 characters after trimming", () => {
	const base = { intent: "support", name: "Ada", email: "ada@example.com", topic: "other" };
	assertEquals(issues({ ...base, message: "   too short     " }), ["message"]);
	assertEquals(issues({ ...base, message: "x".repeat(5001) }), ["message"]);
	parse({ ...base, message: "x".repeat(5000) });
	parse({ ...base, message: "x".repeat(20) });
});

Deno.test("storable text: a NUL or a lone surrogate is the field's 422, never the writer's 503", () => {
	const base = { intent: "support", name: "Ada", email: "ada@example.com", topic: "other" };
	assertEquals(issues({ ...base, message: `${MESSAGE} \u0000` }), ["message"]);
	assertEquals(issues({ ...base, message: `${MESSAGE} \ud800` }), ["message"]);
	assertEquals(issues({ ...base, message: MESSAGE, name: "A\u0000da" }), ["name"]);
	assertEquals(issues({ ...base, message: MESSAGE, email: "a\u0000da@example.com" }), ["email"]);
	assertEquals(
		issues({
			intent: "dispute",
			name: "Ada",
			email: "a@b.co",
			message: MESSAGE,
			referenceId: "\udc00",
		}),
		["referenceId"],
	);
	parse({ ...base, message: `${MESSAGE}\r\nSecond line.\tTabbed.` });
});

Deno.test("email: a malformed or over-long reply address is refused", () => {
	const base = { intent: "support", name: "Ada", topic: "other", message: MESSAGE };
	assertEquals(issues({ ...base, email: "ada@example" }), ["email"]);
	assertEquals(issues({ ...base, email: `${"a".repeat(250)}@x.io` }), ["email"]);
	assertEquals(issues({ ...base, email: "" }), ["email"]);
});

Deno.test("attachments: at most five, each a uuid", () => {
	const base = {
		intent: "support",
		name: "Ada",
		email: "ada@example.com",
		topic: "other",
		message: MESSAGE,
	};
	assertEquals(issues({ ...base, attachmentIds: ["not-a-uuid"] }), ["attachmentIds"]);
	assertEquals(issues({ ...base, attachmentIds: Array(6).fill(FILE) }), ["attachmentIds"]);
	parse({ ...base, attachmentIds: Array(5).fill(FILE) });
});

Deno.test("security: anonymous drops identity and refuses files; otherwise name and email are required", () => {
	const anon = parse({
		intent: "security",
		anonymous: true,
		reportType: "abuse",
		message: MESSAGE,
	});
	assert(isAnonymousSubmission(anon));
	assertEquals(replyAddressOf(anon), null);
	assertEquals(
		issues({
			intent: "security",
			anonymous: true,
			reportType: "abuse",
			message: MESSAGE,
			attachmentIds: [FILE],
		}),
		["attachmentIds"],
	);
	assertEquals(issues({ intent: "security", reportType: "abuse", message: MESSAGE }).sort(), [
		"email",
		"name",
	]);
	assertEquals(
		issues({ intent: "security", name: "Ada", email: "ada@example.com", message: MESSAGE }),
		["reportType"],
	);
	const named = parse({
		intent: "security",
		name: "Ada",
		email: "Ada@Example.com",
		reportType: "vulnerability",
		message: MESSAGE,
	});
	assertFalse(isAnonymousSubmission(named));
	assertEquals(replyAddressOf(named), "ada@example.com");
	assertEquals(
		issues({
			intent: "security",
			name: "x".repeat(121),
			email: "not-an-address",
			reportType: "abuse",
			message: MESSAGE,
		}).sort(),
		["email", "name"],
		"a named report's name and address are held to the shared rules",
	);
});

Deno.test("an unknown intent is refused", () => {
	assertEquals(
		issues({ intent: "press", name: "Ada", email: "ada@example.com", message: MESSAGE }),
		["intent"],
	);
});

Deno.test("the honeypot parses (the service, not the schema, decides what a filled one means)", () => {
	const s = parse({
		intent: "support",
		name: "Ada",
		email: "ada@example.com",
		topic: "other",
		message: MESSAGE,
		ctc_hp: "spam.example",
	});
	assertEquals(s.ctc_hp, "spam.example");
});
// #endregion

// #region Stored payload
Deno.test("toStoredPayload: only the intent's keys, no address, no files, no empty strings", () => {
	const cases: ContactSubmission[] = [
		parse({
			intent: "sales",
			name: "Ada",
			email: "a@b.co",
			company: "A",
			companySize: "1-10",
			budget: "not-sure",
			message: MESSAGE,
		}),
		parse({
			intent: "support",
			name: "Ada",
			email: "a@b.co",
			accountEmail: "Old@B.co",
			topic: "account-and-security",
			message: MESSAGE,
			attachmentIds: [FILE],
		}),
		parse({
			intent: "dispute",
			name: "Ada",
			email: "a@b.co",
			referenceId: "INV-42",
			message: MESSAGE,
		}),
		parse({ intent: "security", anonymous: true, reportType: "whistleblower", message: MESSAGE }),
	];
	for (const s of cases) {
		const payload = toStoredPayload(s);
		for (const key of Object.keys(payload)) {
			assert(CONTACT_PAYLOAD_KEYS[s.intent].includes(key), `${s.intent} stored ${key}`);
		}
		assertFalse("email" in payload);
		assertFalse("attachmentIds" in payload);
		assertFalse("ctc_hp" in payload);
		assertEquals(payload.message, MESSAGE);
	}
	assertEquals(toStoredPayload(cases[1]).accountEmail, "old@b.co");
	assertFalse("name" in toStoredPayload(cases[3]), "an anonymous report stores no name");
	const dispute = parse({
		intent: "dispute",
		name: "Ada",
		email: "a@b.co",
		engagementSlug: "prj-abc",
		message: MESSAGE,
	});
	assertFalse("engagementSlug" in toStoredPayload(dispute), "the client's slug is never stored");
	assertEquals(
		toStoredPayload(dispute, { slug: "prj-abc", title: "Brand refresh", format: "pipeline" })
			.engagement,
		{
			slug: "prj-abc",
			title: "Brand refresh",
			format: "pipeline",
		},
	);
});

Deno.test("engagementHref: the engagement's own workspace", () => {
	assertEquals(engagementHref("prj-abc"), "/projects/prj-abc");
	assertEquals(engagementHref("a b"), "/projects/a%20b");
});
// #endregion

// #region Reference
Deno.test("formatContactReference: CT-XXXX-XXXX over Crockford base32, every symbol reachable", () => {
	assertEquals(CONTACT_REFERENCE_ALPHABET.length, 32);
	assertFalse(/[ILOU]/.test(CONTACT_REFERENCE_ALPHABET));
	assertEquals(formatContactReference(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), "CT-0123-4567");
	assertEquals(
		formatContactReference(new Uint8Array([31, 255, 32, 63, 0, 0, 0, 0])),
		"CT-ZZ0Z-0000",
	);
	const seen = new Set<string>();
	for (let i = 0; i < 256; i++) {
		const ref = formatContactReference(new Uint8Array([i, i, i, i, i, i, i, i]));
		assertMatch(ref, /^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
		seen.add(ref[3]);
	}
	assertEquals(seen.size, 32);
	assertThrows(() => formatContactReference(new Uint8Array(7)), RangeError);
});

Deno.test("isContactReference: shape only, upper case, no ambiguous letters", () => {
	assert(isContactReference("CT-7K4Q-2M9X"));
	assertFalse(isContactReference("ct-7k4q-2m9x"));
	assertFalse(isContactReference("CT-7K4Q-2M9"));
	assertFalse(isContactReference("CT-IL0U-2M9X"));
	assertFalse(isContactReference("PJ-7K4Q-2M9X"));
	assertFalse(
		ContactReceiptSchema.safeParse({
			reference: "CT-0000",
			intent: "sales",
			status: "backlog",
			receivedAt: "x",
		}).success,
	);
});
// #endregion

// #region Lifecycle
Deno.test("the machine: backlog → in_progress | archived → complete → archived; archived is terminal", () => {
	assert(canMoveContactRequest("backlog", "in_progress"));
	assert(canMoveContactRequest("backlog", "archived"));
	assert(canMoveContactRequest("in_progress", "complete"));
	assert(canMoveContactRequest("in_progress", "archived"));
	assert(canMoveContactRequest("complete", "archived"));
	assertFalse(canMoveContactRequest("backlog", "complete"));
	assertFalse(canMoveContactRequest("in_progress", "backlog"));
	assertFalse(canMoveContactRequest("complete", "in_progress"));
	assertEquals(CONTACT_STATUS_TRANSITIONS.archived, []);
});
// #endregion

// #region Support topics
Deno.test("support topics: one per help-centre category, then Something else (Decision #279)", () => {
	assertEquals([...ContactSupportTopic.options], [...HELP_CENTRE_CATEGORY_SLUGS, "other"]);
	assertFalse(ContactSupportTopic.safeParse("payments").success, "the old local list is gone");
	assertEquals(
		contactSupportTopics([
			{ slug: "escrow-and-payments", title: "Escrow & payments" },
			{ slug: "a-category-added-later", title: "Not a topic yet" },
			{ slug: "getting-started", title: "Getting started" },
		]),
		[
			{ value: "escrow-and-payments", label: "Escrow & payments" },
			{ value: "getting-started", label: "Getting started" },
			CONTACT_OTHER_TOPIC,
		],
	);
	assertEquals(
		contactSupportTopics([]),
		[CONTACT_OTHER_TOPIC],
		"an unreadable help centre still sends",
	);
});
// #endregion
