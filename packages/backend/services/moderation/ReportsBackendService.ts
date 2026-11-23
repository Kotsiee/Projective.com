import {
	type AutomatedFindingInput,
	AutomatedFindingInputSchema,
	type FiledReport,
	type FileReportInput,
	FileReportInputSchema,
	REPORT_SUBJECT_ROWS,
	type ReportSnapshot,
	type ReportSubjectType,
} from "@projective/types/ops";
import { evidenceLocation } from "@projective/types/files";
import { fail, type FieldErrors, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient, mocksForcedResult } from "../../core/supabase.ts";
import { copyObject } from "../../core/storage-signed.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

// #region Subjects
/**
 * Where each subject type lives and whose it is. The columns read are the keys of its
 * {@link REPORT_SUBJECT_ROWS} schema, so the read and the snapshot's type cannot drift apart.
 */
const SUBJECT_TABLES: Readonly<
	Record<ReportSubjectType, { schema: string; table: string; key: string; author: string }>
> = {
	project_message: {
		schema: "comms",
		table: "project_messages",
		key: "id",
		author: "sender_user_id",
	},
	dm_message: { schema: "comms", table: "dm_messages", key: "id", author: "sender_user_id" },
	stage_submission: {
		schema: "projects",
		table: "stage_submissions",
		key: "id",
		author: "submitted_by",
	},
	file: { schema: "files", table: "items", key: "id", author: "owner_user_id" },
	profile: { schema: "org", table: "users_public", key: "user_id", author: "user_id" },
	listing: { schema: "catalogue", table: "listings", key: "id", author: "owner_user_id" },
	service: {
		schema: "marketplace",
		table: "service_blueprints",
		key: "id",
		author: "freelancer_profile_id",
	},
	project: { schema: "projects", table: "projects", key: "id", author: "owner_user_id" },
	review: { schema: "reviews", table: "entity_reviews", key: "id", author: "reviewer_user_id" },
	workload_report: {
		schema: "projects",
		table: "ticket_workload_reports",
		key: "id",
		author: "reporter_user_id",
	},
};
// #endregion

// #region Dependencies
/** A PostgREST-shaped answer: the doors and the read all reply this way. */
export interface DbAnswer<T> {
	data: T | null;
	error: { code?: string; message?: string } | null;
}

/** The live edges, swapped out by the unit tests. */
export interface ReportsDeps {
	/** Read one subject row under the reporter's own JWT: `data: null` when RLS hides it. */
	readSubject(
		accessToken: string,
		subjectType: ReportSubjectType,
		subjectId: string,
	): Promise<DbAnswer<Record<string, unknown>>>;
	/** Call a filing door as the service role. */
	callDoor(
		fn: "file_report" | "file_automated_finding",
		args: Record<string, unknown>,
	): Promise<DbAnswer<{ id: string; status: string; created_at: string }>>;
	/** Freeze a reported file's bytes at `evidence/{reportId}/{fileId}`. */
	copyEvidence(bucket: string, path: string, reportId: string, fileId: string): Promise<boolean>;
	now(): Date;
}

const LIVE: ReportsDeps = {
	async readSubject(accessToken, subjectType, subjectId) {
		const t = SUBJECT_TABLES[subjectType];
		const columns = Object.keys(REPORT_SUBJECT_ROWS[subjectType].shape).join(", ");
		const { data, error } = await getUserClient(accessToken).schema(t.schema).from(t.table)
			.select(columns).eq(t.key, subjectId).maybeSingle();
		return { data: data as Record<string, unknown> | null, error };
	},
	async callDoor(fn, args) {
		const { data, error } = await getServiceClient().schema("ops").rpc(fn, args);
		return { data, error };
	},
	copyEvidence(bucket, path, reportId, fileId) {
		const to = evidenceLocation(reportId, fileId);
		return copyObject(bucket, path, to.bucket, to.path);
	},
	now: () => new Date(),
};
// #endregion

// #region Helpers
function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
	const errors: FieldErrors = {};
	for (const issue of issues) errors[String(issue.path[0] ?? "input")] ??= issue.message;
	return errors;
}

/** A door's refusal as a status: the codes `00001665` raises. */
function doorRefusal(error: { code?: string; message?: string }): ServiceResult<never> {
	switch (error.code) {
		case "23505":
			return fail(409, { message: "You've already reported this. A reviewer will look at it." });
		case "PR429":
			return fail(429, { message: "You've sent a lot of reports today. Try again tomorrow." });
		case "22023":
		case "23514":
			return fail(422, { message: error.message ?? "The report could not be filed." });
		default:
			console.error("[reports] door failed", error.code);
			return fail(503, { message: "Reports can't be filed right now. Try again in a moment." });
	}
}

function filed(data: { id: string; status: string; created_at: string }): FiledReport {
	return { id: data.id, status: data.status as FiledReport["status"], createdAt: data.created_at };
}
// #endregion

/**
 * ReportsBackendService — the FAT filing side of `ops.reports`, the one review sink (T&S R1;
 * Decisions #148, #340 ruling T4, #533).
 *
 * **A person's report** ({@link ReportsBackendService.fileReport}). The subject is read with the
 * REPORTER's own client, so RLS decides: a subject they cannot read answers 404 and nothing is filed
 * (a report is never a way to read something, SA §Content moderation). The snapshot is built from
 * that stored row, never from client text, then `ops.file_report` files it as the service role. A
 * reported file's bytes are copied to `evidence/{report_id}/{file_id}`, so deleting the original
 * changes nothing a reviewer sees.
 *
 * **A detector's finding** ({@link ReportsBackendService.fileAutomatedFinding}): ids, categories and
 * scores only, through `ops.file_automated_finding`. No finding penalises anyone until a reviewer
 * actions it (R3).
 *
 * Nothing here logs or returns a subject's text. Thin routes (R2's `/api/reports`) call it.
 */
export class ReportsBackendService {
	/** File one person's report. 201 on success; 404 when the reporter cannot read the subject. */
	static async fileReport(
		actor: ReadActor,
		input: unknown,
		deps: ReportsDeps = LIVE,
	): Promise<ServiceResult<FiledReport>> {
		const parsed = FileReportInputSchema.safeParse(input);
		if (!parsed.success) {
			return fail(422, { message: "Check the report.", errors: fieldErrors(parsed.error.issues) });
		}
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to report something." });
		const { subjectType, subjectId, reason }: FileReportInput = parsed.data;

		try {
			const read = await deps.readSubject(actor.accessToken, subjectType, subjectId);
			if (read.error) {
				console.error("[reports] subject read failed", subjectType, read.error.code);
				return fail(503, { message: "Reports can't be filed right now. Try again in a moment." });
			}
			if (!read.data) return fail(404, { message: "We couldn't find that." });

			const row = REPORT_SUBJECT_ROWS[subjectType].safeParse(read.data);
			if (!row.success) {
				console.error("[reports] subject row did not match its snapshot schema", subjectType);
				return fail(503, { message: "Reports can't be filed right now. Try again in a moment." });
			}
			const snapshot = {
				subjectType,
				capturedAt: deps.now().toISOString(),
				row: row.data,
			} as ReportSnapshot;
			const author = read.data[SUBJECT_TABLES[subjectType].author];

			const door = await deps.callDoor("file_report", {
				p_reporter: actor.userId,
				p_subject_type: subjectType,
				p_subject_id: subjectId,
				p_reason: reason,
				p_reported_user: typeof author === "string" ? author : null,
				p_snapshot: snapshot,
			});
			if (door.error || !door.data) return doorRefusal(door.error ?? {});

			if (snapshot.subjectType === "file") {
				const f = snapshot.row;
				// A link or connector row has no bytes of ours to copy.
				if (!f.link_url && f.bucket_id && f.storage_path) {
					const copied = await deps.copyEvidence(f.bucket_id, f.storage_path, door.data.id, f.id);
					if (!copied) console.error("[reports] evidence copy failed", door.data.id);
				}
			}
			return ok(filed(door.data), { status: 201 });
		} catch (error) {
			return mocksForcedResult(error) ?? doorRefusal({});
		}
	}

	/** File one detector finding (SN3, SN4, SN6). 201 on success. */
	static async fileAutomatedFinding(
		input: unknown,
		deps: ReportsDeps = LIVE,
	): Promise<ServiceResult<FiledReport>> {
		const parsed = AutomatedFindingInputSchema.safeParse(input);
		if (!parsed.success) {
			return fail(422, { message: "Check the finding.", errors: fieldErrors(parsed.error.issues) });
		}
		const f: AutomatedFindingInput = parsed.data;
		try {
			const door = await deps.callDoor("file_automated_finding", {
				p_detector: f.detector,
				p_subject_type: f.subjectType,
				p_subject_id: f.subjectId,
				p_reported_user: f.reportedUserId,
				p_reason: f.reason,
				p_evidence: f.evidence,
			});
			if (door.error || !door.data) return doorRefusal(door.error ?? {});
			return ok(filed(door.data), { status: 201 });
		} catch (error) {
			return mocksForcedResult(error) ?? doorRefusal({});
		}
	}
}
