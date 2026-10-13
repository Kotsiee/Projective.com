import { assertEquals } from "@std/assert";
import { planHttpRun, type ScheduledJobRow, toScheduledJob } from "./job-run.ts";

const BEARER = "b".repeat(40);

const httpRow: ScheduledJobRow = {
	name: "finance-recurring-deposits",
	kind: "http",
	schedule: "15 * * * *",
	command: null,
	path: "/api/finance/cron/deposits?limit=50",
	secret_name: "FINANCE_CRON_SECRET",
	description: "Charges due recurring deposits.",
	enabled: true,
	created_at: "2026-10-13T00:00:00Z",
	updated_at: "2026-10-13T00:00:00Z",
};

const sqlRow: ScheduledJobRow = {
	...httpRow,
	name: "finance-reconcile-wallets",
	kind: "sql",
	schedule: "40 3 * * *",
	command: "SELECT finance.fn_reconcile_wallets();",
	path: null,
	secret_name: null,
};

function httpJob() {
	const job = toScheduledJob(httpRow);
	if (job?.kind !== "http") throw new Error("fixture is not an http job");
	return job;
}

Deno.test("toScheduledJob — maps both kinds and refuses a row that breaks the table's CHECKs", () => {
	assertEquals(toScheduledJob(sqlRow)?.kind, "sql");
	assertEquals(httpJob().secretName, "FINANCE_CRON_SECRET");
	assertEquals(toScheduledJob({ ...sqlRow, path: "/api/x" }), null);
	assertEquals(toScheduledJob({ ...sqlRow, command: "DELETE FROM finance.wallets" }), null);
	assertEquals(toScheduledJob({ ...httpRow, path: "https://evil.example/api" }), null);
	assertEquals(toScheduledJob({ ...httpRow, name: "Bad_Name" }), null);
});

Deno.test("planHttpRun — POSTs to the app origin plus the row's path with the named bearer", () => {
	const plan = planHttpRun(httpJob(), "http://localhost:3000/ignored", (k) =>
		k === "FINANCE_CRON_SECRET" ? ` ${BEARER} ` : undefined);
	assertEquals(plan, {
		ok: true,
		url: "http://localhost:3000/api/finance/cron/deposits?limit=50",
		bearer: BEARER,
	});
});

Deno.test("planHttpRun — a missing, placeholder or short bearer is refused before any request", () => {
	for (const value of [undefined, "XXXX-XXXX", "short"]) {
		const plan = planHttpRun(httpJob(), "http://localhost:3000", () => value);
		assertEquals(plan.ok, false);
	}
	assertEquals(planHttpRun(httpJob(), "not a url", () => BEARER).ok, false);
});
