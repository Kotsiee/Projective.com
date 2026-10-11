import { assertEquals } from "@std/assert";
import { billingPeriod } from "./business-billing.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

Deno.test("billingPeriod: before the billing day, the period started last month", () => {
	const p = billingPeriod(15, new Date("2026-10-10T12:00:00Z"));
	assertEquals([iso(p.start), iso(p.end)], ["2026-09-15", "2026-10-15"]);
});

Deno.test("billingPeriod: on the billing day itself, a new period starts", () => {
	const p = billingPeriod(15, new Date("2026-10-15T00:00:00Z"));
	assertEquals([iso(p.start), iso(p.end)], ["2026-10-15", "2026-11-15"]);
});

Deno.test("billingPeriod: no billing day is the 1st, and January wraps to December", () => {
	const p = billingPeriod(null, new Date("2027-01-01T00:00:00Z"));
	assertEquals([iso(p.start), iso(p.end)], ["2027-01-01", "2027-02-01"]);
	const q = billingPeriod(28, new Date("2027-01-03T00:00:00Z"));
	assertEquals([iso(q.start), iso(q.end)], ["2026-12-28", "2027-01-28"]);
});
