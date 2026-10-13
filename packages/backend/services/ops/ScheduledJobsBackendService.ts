import { serverEnv } from "../../core/env.ts";
import { getServiceClient, isSupabaseConfigured } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { JobRunReport, ScheduledJob } from "@projective/types/ops";
import { JOB_NAME_PATTERN } from "@projective/types/ops";
import {
	planHttpRun,
	SCHEDULED_JOB_COLUMNS,
	type ScheduledJobRow,
	toScheduledJob,
} from "./job-run.ts";

const HTTP_TIMEOUT_MS = 120_000;

/** Seams a test (or a caller with its own transport) can replace. */
export interface JobRunOptions {
	readEnv?: (key: string) => string | undefined;
	fetchFn?: typeof fetch;
}

function readProcessEnv(key: string): string | undefined {
	try {
		return Deno.env.get(key);
	} catch {
		return undefined;
	}
}

/**
 * ScheduledJobsBackendService — manual runs of the job registry (`ops.scheduled_jobs`, Decision #203),
 * behind `deno task cron:run`. pg_cron runs the same jobs on their schedules; this is the by-hand path
 * for local development and for an environment where pg_cron or pg_net is missing.
 *
 * Service-role only: it reads the registry and calls `ops.run_job`, neither of which a user may reach.
 */
export class ScheduledJobsBackendService {
	/** Every registry row, by name. */
	static async listJobs(): Promise<ServiceResult<ScheduledJob[]>> {
		if (!isSupabaseConfigured()) return fail(503, { message: "Supabase is not configured." });
		const { data, error } = await getServiceClient()
			.schema("ops")
			.from("scheduled_jobs")
			.select(SCHEDULED_JOB_COLUMNS)
			.order("name");
		if (error) return fail(502, { message: `Could not read ops.scheduled_jobs: ${error.message}` });
		const rows = (data ?? []) as ScheduledJobRow[];
		const jobs = rows.map(toScheduledJob).filter((job): job is ScheduledJob => job !== null);
		if (jobs.length !== rows.length) {
			return fail(500, {
				message: "ops.scheduled_jobs holds a row the @projective/types/ops schema refuses.",
			});
		}
		return ok(jobs);
	}

	/**
	 * Run one job now, enabled or not. A `sql` job runs in the database through `ops.run_job` and
	 * reports its result. An `http` job is POSTed to `APP_URL` + its path with the bearer from this
	 * process's env (the key named by its `secretName`), exactly as the scheduler sends it, so the app
	 * must be running. A non-2xx answer is a failure carrying the status.
	 */
	static async runJob(
		name: string,
		opts: JobRunOptions = {},
	): Promise<ServiceResult<JobRunReport>> {
		if (!JOB_NAME_PATTERN.test(name)) return fail(422, { message: `"${name}" is not a job name.` });
		if (!isSupabaseConfigured()) return fail(503, { message: "Supabase is not configured." });

		const client = getServiceClient();
		const { data: row, error } = await client
			.schema("ops")
			.from("scheduled_jobs")
			.select(SCHEDULED_JOB_COLUMNS)
			.eq("name", name)
			.maybeSingle();
		if (error) return fail(502, { message: `Could not read ops.scheduled_jobs: ${error.message}` });
		if (!row) return fail(404, { message: `No scheduled job named "${name}".` });
		const job = toScheduledJob(row as ScheduledJobRow);
		if (!job) return fail(500, { message: `ops.scheduled_jobs row "${name}" breaks its schema.` });

		if (job.kind === "sql") {
			const { data, error: rpcError } = await client.schema("ops").rpc("run_job", { p_name: name });
			if (rpcError) return fail(502, { message: `${name} failed: ${rpcError.message}` });
			const result = (data as { result?: unknown } | null)?.result ?? null;
			return ok({ kind: "sql", job: name, result });
		}

		const plan = planHttpRun(job, serverEnv().appUrl, opts.readEnv ?? readProcessEnv);
		if (!plan.ok) return fail(422, { message: plan.message });

		let response: Response;
		try {
			response = await (opts.fetchFn ?? fetch)(plan.url, {
				method: "POST",
				headers: { Authorization: `Bearer ${plan.bearer}`, "Content-Type": "application/json" },
				body: "{}",
				signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
			});
		} catch (cause) {
			const reason = cause instanceof Error ? cause.message : String(cause);
			return fail(502, { message: `${plan.url} is unreachable (is the app running?): ${reason}` });
		}
		const text = await response.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
		const report: JobRunReport = {
			kind: "http",
			job: name,
			url: plan.url,
			status: response.status,
			body,
		};
		if (response.ok) return ok(report);
		return fail(502, {
			message: response.status === 404
				? `${plan.url} answered 404 — the route hides itself unless the app's ${job.secretName} matches.`
				: `${plan.url} answered ${response.status}.`,
			details: { status: response.status },
		});
	}
}
