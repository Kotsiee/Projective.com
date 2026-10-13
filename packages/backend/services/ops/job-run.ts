import { type ScheduledJob, ScheduledJobSchema } from "@projective/types/ops";

// #region Row mapping
/** An `ops.scheduled_jobs` row as PostgREST returns it. */
export interface ScheduledJobRow {
	name: string;
	kind: string;
	schedule: string;
	command: string | null;
	path: string | null;
	secret_name: string | null;
	description: string;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

/** The columns {@link ScheduledJobRow} reads. */
export const SCHEDULED_JOB_COLUMNS =
	"name, kind, schedule, command, path, secret_name, description, enabled, created_at, updated_at";

/** Map and validate a registry row; `null` when it breaks the SSOT (a schema drift, never user input). */
export function toScheduledJob(row: ScheduledJobRow): ScheduledJob | null {
	const parsed = ScheduledJobSchema.safeParse({
		name: row.name,
		kind: row.kind,
		schedule: row.schedule,
		command: row.command,
		path: row.path,
		secretName: row.secret_name,
		description: row.description,
		enabled: row.enabled,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
	return parsed.success ? parsed.data : null;
}
// #endregion

// #region HTTP plan
/** Where and how a manual run of an http job POSTs, or why it cannot. */
export type HttpRunPlan =
	| { ok: true; url: string; bearer: string }
	| { ok: false; message: string };

/**
 * Resolve a manual run of an http job exactly as the scheduler sends it: `POST <appUrl><path>` with the
 * bearer named by the row's `secretName`, read from the app's own environment (the route checks the
 * same key). The route ignores a bearer under 32 characters, so a short or placeholder one is refused
 * here rather than sent to collect a 404.
 */
export function planHttpRun(
	job: Extract<ScheduledJob, { kind: "http" }>,
	appUrl: string,
	readEnv: (key: string) => string | undefined,
): HttpRunPlan {
	let origin: URL;
	try {
		origin = new URL(appUrl);
	} catch {
		return { ok: false, message: `APP_URL is not a URL (${appUrl}).` };
	}
	const bearer = readEnv(job.secretName)?.trim();
	if (!bearer || bearer.length < 32) {
		return {
			ok: false,
			message: `${job.secretName} is not set to a value of at least 32 characters in .env.local.`,
		};
	}
	return { ok: true, url: `${origin.origin}${job.path}`, bearer };
}
// #endregion
