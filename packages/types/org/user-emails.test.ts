import { assert, assertEquals } from "@std/assert";
import {
	AddUserEmailSchema,
	EMAIL_MAX_LENGTH,
	EmailRefusal,
	EmailVerifyOutcome,
	MAX_USER_EMAILS,
} from "./user-emails.ts";

Deno.test("AddUserEmail — trims and lower-cases, like org.add_user_email", () => {
	const parsed = AddUserEmailSchema.safeParse({ email: "  Name.Surname@Example.COM " });
	assert(parsed.success);
	assertEquals(parsed.data.email, "name.surname@example.com");
});

Deno.test("AddUserEmail — refuses junk the definer would refuse with email_invalid", () => {
	for (
		const email of [
			"",
			"   ",
			"no-at-sign",
			"two@@example.com",
			"a b@example.com",
			"name@nodot",
			"@example.com",
			"name@.",
		]
	) {
		assertEquals(AddUserEmailSchema.safeParse({ email }).success, false, email);
	}
});

Deno.test("AddUserEmail — the RFC 5321 length ceiling", () => {
	const local = "a".repeat(EMAIL_MAX_LENGTH - "@x.io".length);
	assert(AddUserEmailSchema.safeParse({ email: `${local}@x.io` }).success);
	assertEquals(AddUserEmailSchema.safeParse({ email: `a${local}@x.io` }).success, false);
});

Deno.test("AddUserEmail — strict: no other key rides along (verified, primary)", () => {
	assertEquals(
		AddUserEmailSchema.safeParse({ email: "a@example.com", verifiedAt: "2026-01-01" }).success,
		false,
	);
	assertEquals(
		AddUserEmailSchema.safeParse({ email: "a@example.com", isPrimary: true }).success,
		false,
	);
	assertEquals(AddUserEmailSchema.safeParse({ email: 42 }).success, false);
});

Deno.test("user-emails constants mirror the SQL", () => {
	assertEquals(MAX_USER_EMAILS, 5);
	assertEquals(EmailRefusal.options.length, 12);
	assertEquals(EmailVerifyOutcome.options, [
		"verified",
		"expired",
		"invalid",
		"used",
		"wrong-account",
		"in-use",
		// Not a token outcome: the verify route could not reach the database (not live, an outage).
		"unavailable",
	]);
});
