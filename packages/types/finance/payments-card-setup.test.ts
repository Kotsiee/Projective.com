import { assert, assertEquals } from "@std/assert";
import { CARD_SETUP_PAYMENT_METHOD_TYPES, CardSetupConfigSchema } from "./payments.ts";

Deno.test("a card is saved card-only — the one list both halves of the deferred setup read", () => {
	assertEquals([...CARD_SETUP_PAYMENT_METHOD_TYPES], ["card"]);
});

Deno.test("the card-setup config carries a publishable key (or none) and the mode, nothing else", () => {
	const parsed = CardSetupConfigSchema.safeParse({ publishableKey: "pk_test_XXXX", mode: "test" });
	assert(parsed.success);
	assertEquals(parsed.data, { publishableKey: "pk_test_XXXX", mode: "test" });
	assert(CardSetupConfigSchema.safeParse({ publishableKey: null, mode: "live" }).success);
	assert(
		!CardSetupConfigSchema.safeParse({ publishableKey: "pk_test_XXXX", mode: "sandbox" }).success,
	);
	// No client secret, no owner: the form mounts before any intent exists.
	const extra = CardSetupConfigSchema.safeParse({
		publishableKey: null,
		mode: "test",
		clientSecret: "seti_1_secret_x",
	});
	assert(extra.success);
	assert(!("clientSecret" in extra.data));
});
