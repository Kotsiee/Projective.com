/**
 * `deno task cron:run <job>` — run one job from the registry (`ops.scheduled_jobs`, Decision #203) now.
 * `deno task cron:run --list` prints every job with its cadence.
 *
 * pg_cron runs these on their schedules; this is the by-hand path for local development, for a test
 * that needs a sweep to have run, and for a database where pg_cron or pg_net is missing.
 *
 *   sql job   runs in the database through `ops.run_job` (service role) and prints its result.
 *   http job  POSTs to APP_URL + the job's path with the bearer from .env.local, exactly as the
 *             scheduler sends it — so the app must be running (`deno task dev`).
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Exits non-zero when the run fails.
 */
import { load } from "@std/dotenv";
import { ScheduledJobsBackendService } from "@server/services/ops/ScheduledJobsBackendService.ts";

await load({ envPath: ".env.local", export: true });
await load({ export: true });

const [arg, ...rest] = Deno.args;
if (!arg || rest.length > 0) {
	console.error("Usage: deno task cron:run <job> | --list");
	Deno.exit(2);
}

if (arg === "--list") {
	const listed = await ScheduledJobsBackendService.listJobs();
	if (!listed.ok || !listed.data) {
		console.error(listed.message);
		Deno.exit(1);
	}
	for (const job of listed.data) {
		const target = job.kind === "sql" ? job.command : `POST ${job.path} (${job.secretName})`;
		console.log(
			`${job.name.padEnd(34)} ${job.schedule.padEnd(14)} ${job.enabled ? "on " : "off"}  ${target}`,
		);
	}
	Deno.exit(0);
}

const started = performance.now();
const run = await ScheduledJobsBackendService.runJob(arg);
const ms = Math.round(performance.now() - started);
if (!run.ok || !run.data) {
	console.error(`${arg} failed (${run.status}, ${ms}ms): ${run.message}`);
	Deno.exit(1);
}
const report = run.data;
if (report.kind === "sql") {
	console.log(`${arg} ran in the database in ${ms}ms.`);
	console.log(JSON.stringify(report.result, null, 2));
} else {
	console.log(`${arg}: POST ${report.url} answered ${report.status} in ${ms}ms.`);
	console.log(JSON.stringify(report.body, null, 2));
}
