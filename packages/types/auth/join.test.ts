import { assert, assertEquals } from "@std/assert";
import { bracketFromDob, computeAge, todayIn, UNDER_MINIMUM_REFUSAL } from "./age.ts";
import { IndividualJoinSchema, JoinSchema } from "./join.ts";

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
	password: "correct horse",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "ada",
	timeZone: "UTC",
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
