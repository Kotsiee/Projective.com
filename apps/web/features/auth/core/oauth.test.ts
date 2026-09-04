import { assertEquals } from "@std/assert";
import { oauthPrefillFromClaims } from "./oauth.ts";

const google = (user: Record<string, unknown>) => ({
	sub: "u1",
	app_metadata: { provider: "google", providers: ["google"] },
	user_metadata: user,
});

Deno.test("a non-federated identity gets no pre-fill", () => {
	assertEquals(oauthPrefillFromClaims(null), null);
	assertEquals(oauthPrefillFromClaims({ sub: "u1" }), null);
	assertEquals(
		oauthPrefillFromClaims({ sub: "u1", app_metadata: { provider: "email" } }),
		null,
	);
});

Deno.test("the provider is read from app_metadata, which a user cannot write", () => {
	// `user_metadata` IS user-writable, and the marker decides whether /join asks for a password. A
	// password account that could claim to be federated would reach the completion path instead of
	// signup.
	assertEquals(
		oauthPrefillFromClaims({
			sub: "u1",
			app_metadata: { provider: "email" },
			user_metadata: { provider: "google", email: "x@y.com" },
		}),
		null,
	);
});

Deno.test("a full name is split when Google sends no given/family name", () => {
	// The live token for this app's own Google identity carries `name`/`full_name` and neither
	// `given_name` nor `family_name`, so the split is the path that actually runs.
	const prefill = oauthPrefillFromClaims(google({ full_name: "Ada King Lovelace" }))!;
	assertEquals(prefill.firstName, "Ada");
	assertEquals(prefill.lastName, "King Lovelace");
});

Deno.test("given/family names win over the split when present", () => {
	const prefill = oauthPrefillFromClaims(
		google({ full_name: "Ada King Lovelace", given_name: "Ada", family_name: "Lovelace" }),
	)!;
	assertEquals(prefill.firstName, "Ada");
	assertEquals(prefill.lastName, "Lovelace");
});

Deno.test("a one-word name leaves the surname absent rather than repeating the first", () => {
	const prefill = oauthPrefillFromClaims(google({ name: "Ada" }))!;
	assertEquals(prefill.firstName, "Ada");
	assertEquals(prefill.lastName, undefined);
});

Deno.test("an avatar from an unlisted host is dropped, not pre-filled", () => {
	// Same allowlist the URL path applies: an unverified token is exactly as untrusted as a query
	// string, and this value ends up as an <img src>.
	assertEquals(
		oauthPrefillFromClaims(google({ picture: "https://evil.example/pic.png" }))!.avatar,
		undefined,
	);
	assertEquals(
		oauthPrefillFromClaims(google({ avatar_url: "https://lh3.googleusercontent.com/a/pic" }))!
			.avatar,
		"https://lh3.googleusercontent.com/a/pic",
	);
});

Deno.test("a non-string metadata value is ignored rather than coerced", () => {
	const prefill = oauthPrefillFromClaims(google({ full_name: 42, email: null }))!;
	assertEquals(prefill.firstName, undefined);
	assertEquals(prefill.email, undefined);
	assertEquals(prefill.provider, "google");
});
