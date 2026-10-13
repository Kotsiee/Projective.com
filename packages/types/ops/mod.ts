/**
 * @projective/types/ops — the Zod SSOT for the job registry (`ops.scheduled_jobs`,
 * `ops.http_job_dispatches`; Decision #203).
 *
 * Every recurring job is one registry row: pg_cron runs a `sql` job's command in the database, and an
 * `http` job's POST to the app is dispatched by pg_net with a bearer read from Vault. The constraints
 * here mirror the table's CHECKs (00000013).
 */

import { z } from "zod";

// #region Registry
/** Kebab-case job name — the registry key and the pg_cron job name. */
export const JOB_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** UPPER_SNAKE name shared by the bearer's Vault secret and the app's env key. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** How a job runs: `sql` in the database, `http` as a pg_net POST to an app route. */
export const ScheduledJobKind = z.enum(["sql", "http"]);
export type ScheduledJobKind = z.infer<typeof ScheduledJobKind>;

const ScheduledJobBase = z.object({
	name: z.string().regex(JOB_NAME_PATTERN),
	/** Five-field cron expression, UTC. */
	schedule: z.string().min(9),
	description: z.string().min(1),
	enabled: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/** One `ops.scheduled_jobs` row. */
export const ScheduledJobSchema = z.discriminatedUnion("kind", [
	ScheduledJobBase.extend({
		kind: z.literal("sql"),
		/** A single SELECT. */
		command: z.string().regex(/^SELECT [^;]+;?$/),
		path: z.null(),
		secretName: z.null(),
	}),
	ScheduledJobBase.extend({
		kind: z.literal("http"),
		command: z.null(),
		/** App route, with its query (`/api/finance/cron/deposits?limit=50`). */
		path: z.string().regex(/^\/api\/\S*$/),
		secretName: z.string().regex(SECRET_NAME_PATTERN),
	}),
]);
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;
// #endregion

// #region Dispatches
/** One `ops.http_job_dispatches` row: a pg_net request and, once settled, its outcome. */
export const HttpJobDispatchSchema = z.object({
	id: z.string().uuid(),
	jobName: z.string().regex(JOB_NAME_PATTERN),
	/** pg_net request id (`net._http_response.id`). */
	requestId: z.number().int(),
	dispatchedAt: z.string(),
	settledAt: z.string().nullable(),
	statusCode: z.number().int().nullable(),
	error: z.string().nullable(),
});
export type HttpJobDispatch = z.infer<typeof HttpJobDispatchSchema>;
// #endregion

// #region Manual runs
/** What `deno task cron:run <job>` reports for one run. */
export const JobRunReportSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("sql"),
		job: z.string(),
		/** The job's SELECT result as returned by `ops.run_job`. */
		result: z.unknown(),
	}),
	z.object({
		kind: z.literal("http"),
		job: z.string(),
		url: z.string(),
		status: z.number().int(),
		/** The route's JSON body, or its text when it is not JSON. */
		body: z.unknown(),
	}),
]);
export type JobRunReport = z.infer<typeof JobRunReportSchema>;
// #endregion
