import { assertEquals } from "@std/assert";
import { EnterpriseJoinSchema, IndividualJoinSchema } from "./join.ts";
import { passwordIssue, PasswordSchema } from "./password.ts";

const TOO_SHORT = "Use at least 8 characters.";
const TOO_LONG = "Use a shorter password: 72 characters at most, fewer with accents or emoji.";
const NEEDS_CLASSES = "Mix upper- and lower-case letters and a number.";

Deno.test("password: eight characters with a lower-case letter, a capital and a digit pass", () => {
	assertEquals(passwordIssue("Abcdefg1"), null);
	assertEquals(PasswordSchema.safeParse("Abcdefg1").success, true);
});

Deno.test("password: seven characters are too short, whatever their classes", () => {
	assertEquals(passwordIssue("Abcdef1"), TOO_SHORT);
	assertEquals(passwordIssue(""), TOO_SHORT);
});

Deno.test("password: a missing lower-case letter, capital or digit is refused", () => {
	for (const value of ["abcdefg1", "ABCDEFG1", "Abcdefgh", "Abcdefg١"]) {
		assertEquals(passwordIssue(value), NEEDS_CLASSES, value);
	}
});

Deno.test("password: the ceiling is 72 UTF-8 bytes, not 72 characters", () => {
	const ascii72 = "Aa1" + "x".repeat(69);
	assertEquals(passwordIssue(ascii72), null);
	assertEquals(passwordIssue(ascii72 + "x"), TOO_LONG);
	assertEquals(passwordIssue("Aa1" + "é".repeat(34)), null, "37 characters, 71 bytes");
	assertEquals(passwordIssue("Aa1" + "é".repeat(35)), TOO_LONG, "38 characters, 73 bytes");
});

Deno.test("password: the schema reports the rule's own copy", () => {
	const parsed = PasswordSchema.safeParse("Short1");
	assertEquals(parsed.success ? null : parsed.error.issues[0].message, TOO_SHORT);
});

const individual = {
	type: "individual",
	intent: "client",
	email: "ada@example.com",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "ada",
	dob: "1990-03-14",
	acceptTerms: true,
};

function individualPasswordIssue(body: Record<string, unknown>): string | undefined {
	const parsed = IndividualJoinSchema.safeParse({ ...individual, ...body });
	return parsed.success
		? undefined
		: parsed.error.issues.find((issue) => issue.path[0] === "password")?.message;
}

Deno.test("join: a password sign-up needs a password that passes the rule", () => {
	assertEquals(individualPasswordIssue({}), TOO_SHORT);
	assertEquals(individualPasswordIssue({ password: "correct horse" }), NEEDS_CLASSES);
	assertEquals(individualPasswordIssue({ password: "Correct horse 1" }), undefined);
});

Deno.test("join: an OAuth completion carries no password", () => {
	assertEquals(individualPasswordIssue({ oauth: true }), undefined);
});

Deno.test("join: an enterprise owner's password passes the same rule", () => {
	const parsed = EnterpriseJoinSchema.safeParse({
		type: "enterprise",
		legalName: "Acme Ltd",
		corporateEmail: "owner@acme.example",
		phone: "+44 20 7946 0000",
		address: { street: "1 Acme Way", city: "London", postcode: "EC1A 1AA", country: "GB" },
		employeeTier: "1-50",
		industry: "software",
		password: "acmeacme",
		ownerFirstName: "Grace",
		ownerLastName: "Hopper",
		dob: "1980-12-09",
		timeZone: "UTC",
		acceptTerms: true,
	});
	assertEquals(
		parsed.success
			? undefined
			: parsed.error.issues.find((issue) => issue.path[0] === "password")?.message,
		NEEDS_CLASSES,
	);
});
