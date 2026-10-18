/** A signed-in reader's form opens with their own name and address (Decision #276). */
import { assertEquals } from "@std/assert";
import { contactPrefillFromClaims, NO_PREFILL } from "./contact-prefill.ts";

Deno.test("contactPrefillFromClaims: full name, then name, then first + last; metadata email, then the claim", () => {
	assertEquals(
		contactPrefillFromClaims({
			sub: "u",
			email: "Noor@Projective.dev",
			user_metadata: { full_name: "  Noor   Haddad ", name: "ignored" },
		}),
		{ name: "Noor Haddad", email: "noor@projective.dev" },
	);
	assertEquals(
		contactPrefillFromClaims({
			sub: "u",
			user_metadata: { name: "Ada", email: "ada@example.com" },
		}),
		{ name: "Ada", email: "ada@example.com" },
	);
	assertEquals(
		contactPrefillFromClaims({
			sub: "u",
			email: "grace@example.com",
			user_metadata: { first_name: "Grace", last_name: "Hopper" },
		}),
		{ name: "Grace Hopper", email: "grace@example.com" },
	);
	assertEquals(
		contactPrefillFromClaims({ sub: "u", user_metadata: { given_name: "Alan" } }).name,
		"Alan",
	);
});

Deno.test("contactPrefillFromClaims: a guest, an unusable name or a malformed address leaves the field empty", () => {
	assertEquals(contactPrefillFromClaims(null), { ...NO_PREFILL });
	assertEquals(contactPrefillFromClaims(undefined), { ...NO_PREFILL });
	assertEquals(
		contactPrefillFromClaims({
			sub: "u",
			email: "not-an-address",
			user_metadata: { full_name: "x".repeat(121), name: 42 },
		}),
		{ name: "", email: "" },
	);
	assertEquals(
		contactPrefillFromClaims({ sub: "u", email: `${"a".repeat(250)}@example.com` }).email,
		"",
	);
});
