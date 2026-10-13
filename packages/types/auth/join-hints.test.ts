import { assertEquals } from "@std/assert";
import { IndividualJoinSchema, OrganizationJoinSchema } from "./join.ts";

const individual = {
	type: "individual",
	intent: "client",
	email: "ada@example.com",
	password: "correct horse",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "ada",
	dob: "1990-03-14",
};

const organization = {
	type: "organization",
	legalName: "Acme Ltd",
	corporateEmail: "owner@acme.example",
	phone: "+44 20 7946 0000",
	address: { street: "1 Acme Way", city: "London", postcode: "EC1A 1AA", country: "GB" },
	employeeTier: "1-50",
	industry: "software",
	password: "correct horse",
};

Deno.test("join hints: a supported locale and display currency are kept, canonical", () => {
	const parsed = IndividualJoinSchema.parse({
		...individual,
		locale: "fr_fr",
		displayCurrency: "eur",
	});
	assertEquals(parsed.locale, "fr-FR");
	assertEquals(parsed.displayCurrency, "EUR");
});

Deno.test("join hints: unsupported values are dropped, never refused", () => {
	const parsed = IndividualJoinSchema.safeParse({
		...individual,
		locale: "xx-YY",
		displayCurrency: "XYZ",
	});
	assertEquals(parsed.success, true);
	assertEquals(parsed.data?.locale, undefined);
	assertEquals(parsed.data?.displayCurrency, undefined);
});

Deno.test("join hints: absent hints leave the account on the defaults", () => {
	const parsed = IndividualJoinSchema.parse(individual);
	assertEquals(parsed.locale, undefined);
	assertEquals(parsed.displayCurrency, undefined);
});

Deno.test("join hints: an organisation owner's hints are read too", () => {
	const parsed = OrganizationJoinSchema.parse({
		...organization,
		locale: "ja-JP",
		displayCurrency: "JPY",
	});
	assertEquals(parsed.locale, "ja-JP");
	assertEquals(parsed.displayCurrency, "JPY");
});
