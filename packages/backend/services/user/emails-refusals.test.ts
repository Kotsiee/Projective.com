import { assert, assertEquals } from "@std/assert";
import { EmailRefusal } from "@projective/types/org";
import {
	emailFailure,
	emailRefusalCode,
	emailRefusalMessage,
	toUserEmails,
	verifyOutcomeFor,
} from "./emails-refusals.ts";

Deno.test("emailRefusalMessage — every refusal code has its own calm sentence", () => {
	const sentences = EmailRefusal.options.map((code) => emailRefusalMessage(code));
	for (const sentence of sentences) {
		assert(sentence.length > 10 && sentence.endsWith("."), sentence);
		assertEquals(/email_|token_|P0001/.test(sentence), false, sentence);
	}
	assertEquals(new Set(sentences).size, sentences.length);
});

Deno.test("emailRefusalCode — reads only P0001 + an exact code", () => {
	assertEquals(emailRefusalCode({ code: "P0001", message: "email_exists" }), "email_exists");
	assertEquals(emailRefusalCode({ code: "P0001", message: " token_used " }), "token_used");
	assertEquals(emailRefusalCode({ code: "P0001", message: "email exists" }), null);
	assertEquals(emailRefusalCode({ code: "42501", message: "email_exists" }), null);
	assertEquals(emailRefusalCode(null), null);
});

Deno.test("emailFailure — email_invalid is keyed to the field (422)", () => {
	const result = emailFailure({ code: "P0001", message: "email_invalid" });
	assertEquals(result.ok, false);
	assertEquals(result.status, 422);
	assertEquals(typeof result.errors?.email, "string");
});

Deno.test("emailFailure — refusals carry their status and code", () => {
	const cases: [string, number][] = [
		["email_exists", 409],
		["email_limit", 409],
		["email_not_found", 404],
		["email_unverified", 409],
		["email_is_primary", 409],
		["email_is_sign_in", 409],
		["email_in_use", 409],
		["token_invalid", 400],
		["token_expired", 410],
		["token_used", 409],
		["token_wrong_account", 403],
	];
	for (const [code, status] of cases) {
		const result = emailFailure({ code: "P0001", message: code });
		assertEquals(result.status, status, code);
		assertEquals(result.details?.refusal, code);
		assertEquals(result.message, emailRefusalMessage(code as EmailRefusal));
	}
	assertEquals(
		emailFailure({ code: "P0001", message: "email_limit" }).message?.includes("5"),
		true,
	);
});

Deno.test("emailFailure — session, onboarding and anything else", () => {
	assertEquals(emailFailure({ code: "28000", message: "not_authenticated" }).status, 401);
	assertEquals(emailFailure({ code: "PGRST301", message: "JWT expired" }).status, 401);
	assertEquals(emailFailure({ code: "42501", message: "profile_required" }).status, 403);
	assertEquals(emailFailure({ code: "P0001", message: "something else" }).status, 503);
	assertEquals(emailFailure({ code: "PGRST202" }).status, 503);
	assertEquals(emailFailure({}).ok, false);
});

Deno.test("verifyOutcomeFor — the five confirmation refusals, nothing else", () => {
	const at = (message: string) => verifyOutcomeFor({ code: "P0001", message });
	assertEquals(at("token_invalid"), "invalid");
	assertEquals(at("token_expired"), "expired");
	assertEquals(at("token_used"), "used");
	assertEquals(at("token_wrong_account"), "wrong-account");
	assertEquals(at("email_in_use"), "in-use");
	assertEquals(at("email_not_found"), null);
	assertEquals(verifyOutcomeFor({ code: "28000", message: "token_invalid" }), null);
	assertEquals(verifyOutcomeFor(undefined), null);
});

Deno.test("toUserEmails — maps snake_case rows, keeps order, drops a malformed row", () => {
	const emails = toUserEmails([
		{
			id: "a",
			email: "me@example.com",
			is_primary: true,
			verified_at: "2026-10-01T10:00:00+00:00",
			is_sign_in: true,
			created_at: "2026-01-01T00:00:00+00:00",
		},
		{
			id: "b",
			email: "other@example.com",
			is_primary: false,
			verified_at: null,
			is_sign_in: false,
			created_at: "2026-10-06T00:00:00+00:00",
		},
		{ id: "c" } as never,
	]);
	assertEquals(emails.map((email) => email.id), ["a", "b"]);
	assertEquals(emails[1], {
		id: "b",
		email: "other@example.com",
		isPrimary: false,
		verifiedAt: null,
		isSignIn: false,
		createdAt: "2026-10-06T00:00:00+00:00",
	});
	assertEquals(toUserEmails(null), []);
});
