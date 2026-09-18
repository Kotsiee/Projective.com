import { assert, assertEquals } from "@std/assert";
import { identifierError, isEmailIdentifier, isIdentifier } from "./validate.ts";
import { LoginSchema } from "./schema.ts";

/**
 * The sign-in identifier is one field that accepts two vocabularies, checked in two places — the
 * form's instant validator and the route's Zod schema. Both read `isIdentifier`, and the last test
 * here is the cross-check that they still do: a value the form lets through and the route refuses is
 * a submit button that does nothing.
 */

// #region isIdentifier — email OR username
Deno.test("isIdentifier accepts a well-formed email", () => {
	for (const v of ["ada@example.com", "  ada.lovelace@sub.example.co.uk ", "A@B.CO"]) {
		assert(isIdentifier(v), `${JSON.stringify(v)} should be accepted as an email`);
	}
});

Deno.test("isIdentifier accepts a well-formed username", () => {
	for (
		const v of ["ada", "ada.lovelace", "Ada_L-1", "  kenji  ", "a12345678901234567890123456789"]
	) {
		assert(isIdentifier(v), `${JSON.stringify(v)} should be accepted as a username`);
	}
});

Deno.test("isIdentifier refuses what is neither", () => {
	for (
		const v of ["", "   ", "ab", "1ada", "ada lovelace", "ada@", "@ada", "ada@example", "-ada"]
	) {
		assertEquals(isIdentifier(v), false, `${JSON.stringify(v)} should be refused`);
	}
});
// #endregion

// #region identifierError — the message names the vocabulary the reader was using
Deno.test("identifierError is null for either vocabulary", () => {
	assertEquals(identifierError("ada@example.com"), null);
	assertEquals(identifierError("ada.lovelace"), null);
});

Deno.test("identifierError explains an empty field", () => {
	assertEquals(identifierError("   "), "Email or username is required.");
});

Deno.test("identifierError judges an `@` value as an email and anything else as a username", () => {
	assert(isEmailIdentifier("ada@"));
	assertEquals(identifierError("ada@"), "Enter a valid email address.");
	assertEquals(isEmailIdentifier("1ada"), false);
	assertEquals(
		identifierError("1ada"),
		"Enter a valid username: 3–30 characters, starting with a letter.",
	);
});
// #endregion

// #region LoginSchema — the route agrees with the form
Deno.test("LoginSchema accepts the same identifiers the form does, trimmed", () => {
	for (const identifier of ["ada@example.com", "ada.lovelace", "  Ada_L  "]) {
		const parsed = LoginSchema.safeParse({ identifier, password: "hunter22" });
		assert(parsed.success, `${JSON.stringify(identifier)} should parse`);
		assertEquals(parsed.data.identifier, identifier.trim());
		assertEquals(identifierError(identifier), null);
	}
});

Deno.test("LoginSchema refuses what the form refuses, on the identifier key", () => {
	for (const identifier of ["", "ada@", "1ada", "ada lovelace"]) {
		const parsed = LoginSchema.safeParse({ identifier, password: "hunter22" });
		assertEquals(parsed.success, false, `${JSON.stringify(identifier)} should be refused`);
		if (!parsed.success) {
			assertEquals(parsed.error.issues[0]?.path.join("."), "identifier");
		}
		assert(identifierError(identifier) !== null);
	}
});

Deno.test("LoginSchema no longer reads the retired `email` key", () => {
	const parsed = LoginSchema.safeParse({ email: "ada@example.com", password: "hunter22" });
	assertEquals(parsed.success, false);
});
// #endregion
