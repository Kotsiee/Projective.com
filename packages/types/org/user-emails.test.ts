import { assert, assertEquals } from "@std/assert";
import {
	AddUserEmailSchema,
	EMAIL_MAX_LENGTH,
	EmailRefusal,
	EmailVerifyOutcome,
	MakeSignInSchema,
	MAX_USER_EMAILS,
	REAUTH_PASSWORD_MAX_LENGTH,
	SIGN_IN_CHANGE_LIMIT,
} from "./user-emails.ts";

Deno.test("MakeSignIn — a password, an optional bot-check token, makePrimary off by default", () => {
	const parsed = MakeSignInSchema.safeParse({ password: "Correct-horse-1" });
	assert(parsed.success);
	assertEquals(parsed.data, { password: "Correct-horse-1", makePrimary: false });
	assert(
		MakeSignInSchema.safeParse({ password: "x", captchaToken: "tok", makePrimary: true }).success,
	);
});

Deno.test("MakeSignIn — refuses an empty or oversized password and any other key", () => {
	assertEquals(MakeSignInSchema.safeParse({ password: "" }).success, false);
	assertEquals(MakeSignInSchema.safeParse({}).success, false);
	assertEquals(
		MakeSignInSchema.safeParse({ password: "a".repeat(REAUTH_PASSWORD_MAX_LENGTH + 1) }).success,
		false,
	);
	assertEquals(
		MakeSignInSchema.safeParse({ password: "x", email: "someone@else.example" }).success,
		false,
	);
	assertEquals(MakeSignInSchema.safeParse({ password: "x", userId: "abc" }).success, false);
});

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
	assertEquals(EmailRefusal.options.length, 19);
	assertEquals(SIGN_IN_CHANGE_LIMIT, { max: 2, windowDays: 3 });
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
