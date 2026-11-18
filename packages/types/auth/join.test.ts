import { assert, assertEquals } from "@std/assert";
import { bracketFromDob, computeAge, todayIn, UNDER_MINIMUM_REFUSAL } from "./age.ts";
import {
	ENTERPRISE_OWNER_MINOR_REFUSAL,
	EnterpriseJoinSchema,
	IndividualJoinSchema,
	JoinSchema,
	LEGAL_ACCEPTANCE_REQUIRED,
	OwnerCompletionSchema,
	TermsReacceptSchema,
	USERNAME_RESERVED,
} from "./join.ts";

/** The date `years` years (and `days` days) before today in `zone`, as an ISO date. */
function isoYearsAgo(years: number, days = 0, zone = "UTC"): string {
	const [y, m, d] = todayIn(zone).split("-").map(Number);
	const date = new Date(Date.UTC(y - years, m - 1, d + days));
	return date.toISOString().slice(0, 10);
}

const individual = {
	type: "individual",
	intent: "client",
	email: "ada@example.com",
	password: "Correct horse 1",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "ada",
	timeZone: "UTC",
	acceptTerms: true,
};

function dobIssue(dob: string, timeZone = "UTC"): string | undefined {
	const parsed = IndividualJoinSchema.safeParse({ ...individual, dob, timeZone });
	return parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === "dob")?.message;
}

Deno.test("join: a 12-year-old is refused with the minimum-age copy", () => {
	assertEquals(dobIssue(isoYearsAgo(12)), UNDER_MINIMUM_REFUSAL);
});

Deno.test("join: a 13-year-old and a 16-year-old are accepted (restricted is the database's call)", () => {
	assertEquals(dobIssue(isoYearsAgo(13)), undefined);
	assertEquals(dobIssue(isoYearsAgo(16)), undefined);
});

Deno.test("join: a reserved route word is refused as a username, however it is typed", () => {
	const usernameIssue = (username: string) => {
		const parsed = IndividualJoinSchema.safeParse({
			...individual,
			dob: isoYearsAgo(30),
			username,
		});
		return parsed.success
			? undefined
			: parsed.error.issues.find((i) => i.path[0] === "username")?.message;
	};
	for (const username of ["analytics", "Disputes", " connections ", "share", "projective"]) {
		assertEquals(usernameIssue(username), USERNAME_RESERVED, username);
	}
	for (const username of ["ada", "analytics.lab", "my-disputes"]) {
		assertEquals(usernameIssue(username), undefined, username);
	}
});

Deno.test("join: a future, malformed, impossible or pre-1900 date of birth is not a real one", () => {
	assertEquals(dobIssue(isoYearsAgo(0, 1)), "Enter a real date of birth.");
	assertEquals(dobIssue("14/03/1989"), "Enter a real date of birth.");
	assertEquals(dobIssue("2001-02-30"), "Enter a real date of birth.");
	assertEquals(dobIssue("1899-12-31"), "Enter a real date of birth.");
});

Deno.test("join: a client-sent restricted flag is stripped, never carried", () => {
	const parsed = JoinSchema.parse({ ...individual, dob: isoYearsAgo(16), restricted: false });
	assert(!("restricted" in parsed));
});

const enterprise = {
	type: "enterprise",
	legalName: "Acme Ltd",
	corporateEmail: "owner@acme.example",
	phone: "+44 20 7946 0000",
	address: { street: "1 Acme Way", city: "London", postcode: "EC1A 1AA", country: "GB" },
	employeeTier: "1-50",
	industry: "software",
	password: "Correct horse 1",
	ownerFirstName: "Grace",
	ownerLastName: "Hopper",
	timeZone: "UTC",
	acceptTerms: true,
};

function ownerDobIssue(dob: string | undefined): string | undefined {
	const parsed = EnterpriseJoinSchema.safeParse({ ...enterprise, dob });
	return parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === "dob")?.message;
}

Deno.test("join: an enterprise owner's date of birth is required and gets the minimum-age copy", () => {
	assert(ownerDobIssue(undefined) !== undefined);
	assertEquals(ownerDobIssue(isoYearsAgo(12)), UNDER_MINIMUM_REFUSAL);
	assertEquals(ownerDobIssue("2001-02-30"), "Enter a real date of birth.");
});

Deno.test("join: an enterprise owner must be 18 or over", () => {
	assertEquals(ownerDobIssue(isoYearsAgo(18, 1)), ENTERPRISE_OWNER_MINOR_REFUSAL);
	assertEquals(ownerDobIssue(isoYearsAgo(15)), ENTERPRISE_OWNER_MINOR_REFUSAL);
	assertEquals(ownerDobIssue(isoYearsAgo(18)), undefined);
});

const owner = {
	type: "owner",
	firstName: "Grace",
	lastName: "Hopper",
	timeZone: "UTC",
	acceptTerms: true,
};

function completionIssue(value: Record<string, unknown>, field: string): string | undefined {
	const parsed = OwnerCompletionSchema.safeParse(value);
	return parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === field)?.message;
}

Deno.test("join: a profile-less owner's completion needs a name and a real date of birth", () => {
	const parsed = OwnerCompletionSchema.parse({ ...owner, dob: isoYearsAgo(40) });
	assertEquals(parsed.firstName, "Grace");
	assertEquals(parsed.redirectTo, "/home");
	assertEquals(
		completionIssue({ ...owner, dob: "2001-02-30" }, "dob"),
		"Enter a real date of birth.",
	);
	assert(completionIssue({ ...owner, dob: "" }, "dob") !== undefined);
	assert(
		completionIssue({ ...owner, firstName: " ", dob: isoYearsAgo(40) }, "firstName") !== undefined,
	);
});

Deno.test("join: an owner's completion leaves the age rule to the service", () => {
	// A refused owner keeps the account (it holds the enterprise) and is flagged for a person to
	// follow up, so the refusal belongs to `completeOwnerProfile`, not to the schema.
	assert(OwnerCompletionSchema.safeParse({ ...owner, dob: isoYearsAgo(15) }).success);
	assert(OwnerCompletionSchema.safeParse({ ...owner, dob: isoYearsAgo(11) }).success);
});

Deno.test("join: the one endpoint schema routes an owner's completion by its type", () => {
	const parsed = JoinSchema.parse({ ...owner, dob: isoYearsAgo(40), email: "x@acme.example" });
	assertEquals(parsed.type, "owner");
	assert(!("email" in parsed), "the account's email is GoTrue's, never the body's");
});

Deno.test("join: every path refuses a final step without the consent box ticked (Decision #446)", () => {
	const cases = [
		[IndividualJoinSchema, { ...individual, dob: isoYearsAgo(30) }],
		[IndividualJoinSchema, {
			...individual,
			oauth: true,
			password: undefined,
			dob: isoYearsAgo(30),
		}],
		[EnterpriseJoinSchema, { ...enterprise, dob: isoYearsAgo(40) }],
		[OwnerCompletionSchema, { ...owner, dob: isoYearsAgo(40) }],
		[TermsReacceptSchema, { type: "terms", acceptTerms: true }],
	] as const;
	for (const [schema, body] of cases) {
		assert(schema.safeParse(body).success, `${body.type} with the box ticked`);
		for (const acceptTerms of [undefined, false, "true", 1]) {
			const parsed = schema.safeParse({ ...body, acceptTerms });
			assert(!parsed.success, `${body.type} with acceptTerms ${String(acceptTerms)}`);
			assertEquals(
				parsed.error.issues.find((i) => i.path[0] === "acceptTerms")?.message,
				LEGAL_ACCEPTANCE_REQUIRED,
			);
		}
	}
});

Deno.test("join: a client cannot name the versions it accepts", () => {
	const parsed = JoinSchema.parse({
		...individual,
		dob: isoYearsAgo(30),
		legalAcceptance: { terms: "1.0" },
		legal_acceptance: { terms: "1.0" },
	});
	assert(!("legalAcceptance" in parsed) && !("legal_acceptance" in parsed));
});

Deno.test("join: the one endpoint schema routes a re-acceptance by its type", () => {
	const parsed = JoinSchema.parse({ type: "terms", acceptTerms: true });
	assertEquals(parsed, { type: "terms", acceptTerms: true, redirectTo: "/home" });
});

Deno.test("join: an unknown time zone is dropped, so the age counts in UTC", () => {
	const parsed = IndividualJoinSchema.parse({
		...individual,
		dob: isoYearsAgo(20),
		timeZone: "Mars/Olympus",
	});
	assertEquals(parsed.timeZone, undefined);
});

Deno.test("age: the 18th birthday is the boundary", () => {
	assertEquals(bracketFromDob(isoYearsAgo(18, 1), "UTC"), "restricted");
	assertEquals(bracketFromDob(isoYearsAgo(18), "UTC"), "full");
	assertEquals(bracketFromDob("1900-01-01", "UTC"), "full");
	assertEquals(bracketFromDob("1899-12-31", "UTC"), "unknown");
});

Deno.test("age: the person's own zone decides which day the birthday falls on", () => {
	// 2026-03-14T12:00Z is already the 15th in Kiritimati (UTC+14) and still the 14th in Pago Pago
	// (UTC−11), so a 2008-03-15 birthday has turned 18 in the one and not in the other.
	const instant = new Date("2026-03-14T12:00:00Z");
	assertEquals(computeAge("2008-03-15", "Pacific/Kiritimati", instant), 18);
	assertEquals(computeAge("2008-03-15", "Pacific/Pago_Pago", instant), 17);
	assertEquals(computeAge("2008-03-15", "UTC", instant), 17);
	assertEquals(computeAge("2008-03-15", undefined, instant), 17, "no zone counts in UTC");
	assertEquals(computeAge("2008-03-15", "Not/AZone", instant), 17, "an unknown zone counts in UTC");
});

Deno.test("age: a 29 February birthday turns over on 1 March in a common year, as Postgres age() does", () => {
	assertEquals(computeAge("2008-02-29", "UTC", new Date("2026-02-28T12:00:00Z")), 17);
	assertEquals(computeAge("2008-02-29", "UTC", new Date("2026-03-01T12:00:00Z")), 18);
});
