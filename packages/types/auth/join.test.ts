import { assert, assertEquals } from "@std/assert";
import { bracketFromDob, UNDER_MINIMUM_REFUSAL } from "./age.ts";
import { IndividualJoinSchema, JoinSchema } from "./join.ts";

function isoYearsAgo(years: number, plusDays = 0): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() - years);
	d.setDate(d.getDate() + plusDays);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const individual = {
	type: "individual",
	intent: "client",
	email: "ada@example.com",
	password: "correct horse",
	firstName: "Ada",
	lastName: "Lovelace",
	username: "ada",
};

function dobIssue(dob: string): string | undefined {
	const parsed = IndividualJoinSchema.safeParse({ ...individual, dob });
	return parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === "dob")?.message;
}

Deno.test("join: a 12-year-old is refused with the minimum-age copy", () => {
	assertEquals(dobIssue(isoYearsAgo(12)), UNDER_MINIMUM_REFUSAL);
});

Deno.test("join: a 13-year-old and a 16-year-old are accepted (restricted is the database's call)", () => {
	assertEquals(dobIssue(isoYearsAgo(13)), undefined);
	assertEquals(dobIssue(isoYearsAgo(16)), undefined);
});

Deno.test("join: a future, malformed or pre-1900 date of birth is not a real one", () => {
	assertEquals(dobIssue(isoYearsAgo(0, 1)), "Enter a real date of birth.");
	assertEquals(dobIssue("14/03/1989"), "Enter a real date of birth.");
	assertEquals(dobIssue("1899-12-31"), "Enter a real date of birth.");
});

Deno.test("join: a client-sent restricted flag is stripped, never carried", () => {
	const parsed = JoinSchema.parse({ ...individual, dob: isoYearsAgo(16), restricted: false });
	assert(!("restricted" in parsed));
});

Deno.test("age: the 18th birthday is the boundary", () => {
	assertEquals(bracketFromDob(isoYearsAgo(18, 1)), "restricted");
	assertEquals(bracketFromDob(isoYearsAgo(18)), "full");
	assertEquals(bracketFromDob("1900-01-01"), "full");
	assertEquals(bracketFromDob("1899-12-31"), "unknown");
});
