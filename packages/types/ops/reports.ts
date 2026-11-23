/**
 * @projective/types/ops/reports — the Zod SSOT for `ops.reports`, the one review sink (T&S R1;
 * Decisions #148, #340 ruling T4, #496 (A), #533).
 *
 * People's reports, detector findings and copyright notices land in one table for a reviewer to
 * resolve. Every list here mirrors a CHECK in `00000013_tables_ops.sql` or a literal in
 * `00001665_functions_ops_moderation.sql`, value for value.
 */

import { z } from "zod";

// #region Vocabulary
/** Where a report came from: a person, a detector, or a rights-holder's notice (#496 (A)). */
export const REPORT_SOURCES = ["user", "automated", "notice"] as const;
export const ReportSource = z.enum(REPORT_SOURCES);
export type ReportSource = z.infer<typeof ReportSource>;

/** The detectors that file automated findings (SN3 · SN4 · SN6). */
export const REPORT_DETECTORS = [
	"nudenet",
	"ocr",
	"sightengine",
	"presidio",
	"fragmentation",
] as const;
export const ReportDetector = z.enum(REPORT_DETECTORS);
export type ReportDetector = z.infer<typeof ReportDetector>;

/** What can be reported. `review` since RV1 (#487 (d)); `workload_report` for PROJECTS EX4's appeal. */
export const REPORT_SUBJECT_TYPES = [
	"project_message",
	"dm_message",
	"stage_submission",
	"file",
	"profile",
	"listing",
	"service",
	"project",
	"review",
	"workload_report",
] as const;
export const ReportSubjectType = z.enum(REPORT_SUBJECT_TYPES);
export type ReportSubjectType = z.infer<typeof ReportSubjectType>;

/** The closed reason vocabulary (Decision #533, ruling the #148 (g) reason half). */
export const REPORT_REASONS = [
	"contact_leakage",
	"evasion_fragmentation",
	"harassment",
	"hate",
	"sexual_content",
	"child_safety",
	"violence",
	"illegal_content",
	"spam_or_scam",
	"impersonation",
	"intellectual_property",
	"other",
] as const;
export const ReportReason = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReason>;

/** The person-readable label R2's form shows for each reason. */
export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = {
	contact_leakage: "Asking to move contact or payment off Projective",
	evasion_fragmentation: "Contact details split across messages",
	harassment: "Harassment, threats or sharing someone's private details",
	hate: "Hate speech or symbols",
	sexual_content: "Sexual or explicit content",
	child_safety: "Content that sexualises or endangers a minor",
	violence: "Violence or graphic content",
	illegal_content: "Other illegal content or activity",
	spam_or_scam: "Spam, a scam or fake activity",
	impersonation: "Pretending to be someone else",
	intellectual_property: "Uses someone's work without permission",
	other: "Something else",
};

/** The reasons a person may choose: all but the fragmentation detector's own (Decision #533 (B)). */
export const PERSON_REPORT_REASONS = REPORT_REASONS.filter((r) => r !== "evasion_fragmentation");
export const PersonReportReason = ReportReason.exclude(["evasion_fragmentation"]);
export type PersonReportReason = z.infer<typeof PersonReportReason>;

/** A report's lifecycle (PRODUCT_MANAGEMENT): `pending` → `dismissed` | `actioned`, final. */
export const REPORT_STATUSES = ["pending", "dismissed", "actioned"] as const;
export const ReportStatus = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** Reports one person may file per rolling 24 hours (`ops.file_report`, PR429). */
export const REPORT_DAILY_CAP = 20;
// #endregion

// #region Evidence snapshots
const id = z.string().uuid();
const text = z.string().nullable();
const at = z.string().nullable();

/**
 * The stored columns frozen for each subject type, read under the REPORTER's JWT. The keys are the
 * column names the reports service selects, so these objects are also the read's column lists (only
 * columns `authenticated` may select: `org.users_public` withholds dob, city, country, timezone).
 */
export const REPORT_SUBJECT_ROWS = {
	project_message: z.object({
		id,
		sender_user_id: id.nullable(),
		body: text,
		channel_id: id.nullable(),
		reply_to_id: id.nullable(),
		created_at: at,
		edited_at: at,
		deleted_at: at,
	}),
	dm_message: z.object({
		id,
		sender_user_id: id.nullable(),
		body: text,
		thread_id: id.nullable(),
		project_id: id.nullable(),
		reply_to_id: id.nullable(),
		created_at: at,
		deleted_at: at,
	}),
	stage_submission: z.object({
		id,
		submitted_by: id.nullable(),
		title: text,
		notes: text,
		project_stage_id: id.nullable(),
		ticket_id: id.nullable(),
		number: z.number().int().nullable(),
		status: text,
		created_at: at,
		updated_at: at,
	}),
	file: z.object({
		id,
		owner_user_id: id.nullable(),
		display_name: text,
		mime_type: text,
		content_hash: text,
		bucket_id: text,
		storage_path: text,
		link_url: text,
		created_at: at,
		updated_at: at,
	}),
	profile: z.object({
		user_id: id,
		username: text,
		first_name: text,
		last_name: text,
		headline: text,
		bio: z.unknown(),
		created_at: at,
		updated_at: at,
	}),
	listing: z.object({
		id,
		owner_user_id: id.nullable(),
		owner_team_id: id.nullable(),
		title: text,
		description_text: text,
		kind: text,
		status: text,
		created_at: at,
		updated_at: at,
	}),
	service: z.object({
		id,
		freelancer_profile_id: id.nullable(),
		title: text,
		description_text: text,
		created_at: at,
		updated_at: at,
	}),
	project: z.object({
		id,
		owner_user_id: id.nullable(),
		title: text,
		description_text: text,
		status: text,
		created_at: at,
		updated_at: at,
	}),
	review: z.object({
		id,
		reviewer_user_id: id.nullable(),
		title: text,
		comment: text,
		reply_user_id: id.nullable(),
		reply_comment: text,
		target_entity_type: text,
		target_entity_id: id.nullable(),
		created_at: at,
		edited_at: at,
	}),
	workload_report: z.object({
		id,
		reporter_user_id: id.nullable(),
		ticket_id: id.nullable(),
		reason: text,
		claimed_intensity: z.number().nullable(),
		reported_intensity: z.number().nullable(),
		status: text,
		created_at: at,
	}),
} as const satisfies Record<ReportSubjectType, z.ZodObject>;

/** One subject type's snapshot: the frozen row and when it was read. */
const snapshotOf = <T extends ReportSubjectType>(subjectType: T) =>
	z.object({
		subjectType: z.literal(subjectType),
		capturedAt: z.string(),
		row: REPORT_SUBJECT_ROWS[subjectType],
	});

/** `ops.reports.evidence_snapshot` on a `user` row, one schema per subject type. */
export const ReportSnapshotSchema = z.discriminatedUnion("subjectType", [
	snapshotOf("project_message"),
	snapshotOf("dm_message"),
	snapshotOf("stage_submission"),
	snapshotOf("file"),
	snapshotOf("profile"),
	snapshotOf("listing"),
	snapshotOf("service"),
	snapshotOf("project"),
	snapshotOf("review"),
	snapshotOf("workload_report"),
]);
export type ReportSnapshot = z.infer<typeof ReportSnapshotSchema>;

/**
 * `ops.reports.evidence_snapshot` on an `automated` row: ids, categories and scores only. Strict, so
 * no text, image or file bytes can ride along (the T&S standard header's "no payload is kept").
 */
export const AutomatedEvidenceSchema = z.object({
	/** The rows the finding cites: message ids for a fragmentation window, the file id for a screen. */
	ids: z.array(id).min(1).max(200),
	categories: z.array(z.string().min(1).max(64)).max(32),
	scores: z.record(z.string().min(1).max(64), z.number()),
	model: z.string().max(64).optional(),
	version: z.string().max(64).optional(),
}).strict();
export type AutomatedEvidence = z.infer<typeof AutomatedEvidenceSchema>;

/**
 * `ops.reports.notice` — a copyright notice's block, as immutable as the snapshot (#496 (A)). The
 * shell only: the fields a valid notice needs are counsel's (#496 (C)), and MARKETPLACE SC8 fills
 * it. Strict and empty until then, so nothing can be filed into it by accident.
 */
export const ReportNoticeSchema = z.object({}).strict();
export type ReportNotice = z.infer<typeof ReportNoticeSchema>;
// #endregion

// #region Rows and contracts
const ReportRowBase = z.object({
	id,
	subjectType: ReportSubjectType,
	subjectId: id,
	reportedUserId: id.nullable(),
	reason: ReportReason,
	status: ReportStatus,
	resolutionNotes: z.string().nullable(),
	resolvedBy: id.nullable(),
	resolvedAt: z.string().nullable(),
	createdAt: z.string(),
});

/** One `ops.reports` row, by source. `reporterUserId` is NULL on a user row only after erasure. */
export const ReportRowSchema = z.discriminatedUnion("source", [
	ReportRowBase.extend({
		source: z.literal("user"),
		reporterUserId: id.nullable(),
		detector: z.null(),
		evidenceSnapshot: ReportSnapshotSchema,
		notice: z.null(),
	}),
	ReportRowBase.extend({
		source: z.literal("automated"),
		reporterUserId: z.null(),
		detector: ReportDetector,
		evidenceSnapshot: AutomatedEvidenceSchema,
		notice: z.null(),
	}),
	ReportRowBase.extend({
		source: z.literal("notice"),
		reporterUserId: z.null(),
		detector: z.null(),
		evidenceSnapshot: z.record(z.string(), z.unknown()),
		notice: ReportNoticeSchema,
	}),
]);
export type ReportRow = z.infer<typeof ReportRowSchema>;

/** What a person sends to file a report (R2's `POST /api/reports`). */
export const FileReportInputSchema = z.object({
	subjectType: ReportSubjectType,
	subjectId: id,
	reason: PersonReportReason,
});
export type FileReportInput = z.infer<typeof FileReportInputSchema>;

/** What a detector sends to file a finding. */
export const AutomatedFindingInputSchema = z.object({
	detector: ReportDetector,
	subjectType: ReportSubjectType,
	subjectId: id,
	reportedUserId: id.nullable(),
	reason: ReportReason,
	evidence: AutomatedEvidenceSchema,
});
export type AutomatedFindingInput = z.infer<typeof AutomatedFindingInputSchema>;

/** What a filing door answers. */
export const FiledReportSchema = z.object({
	id,
	status: ReportStatus,
	createdAt: z.string(),
});
export type FiledReport = z.infer<typeof FiledReportSchema>;
// #endregion
