import { z } from "zod";

/**
 * org data export — the Zod SSOT for a person's request for a copy of their own data (Decision #450;
 * `org.data_export_requests`, migration 00001061). The archive's own contents are versioned
 * separately in {@link ./data-export-archive.ts}.
 *
 * The RULES live in SQL (`org.request_data_export`); this module carries their answers and mirrors
 * their constants, so a dev simulation substitutes an answer rather than re-deriving one.
 */

// #region Constants
/** The request policy — mirrored by the 00001061 definers. */
export const DATA_EXPORT_POLICY = Object.freeze({
	/** How long a ready archive can be downloaded, in days. */
	linkDays: 7,
	/** The least time between two requests that did not fail, in hours. */
	cooldownHours: 24,
	/** How recent the session's sign-in must be to file a request, in minutes. */
	recentSignInMinutes: 10,
	/** Build attempts before a request fails. */
	maxAttempts: 3,
});
// #endregion

// #region Vocabulary
/** `pending → building → ready → expired`, or `failed`. */
export const DataExportStatus = z.enum(["pending", "building", "ready", "expired", "failed"]);
export type DataExportStatus = z.infer<typeof DataExportStatus>;

/** Why a request failed: out of retries, over the bucket's size limit, or overtaken by an erasure. */
export const DataExportFailure = z.enum(["build_failed", "too_large", "account_erased"]);
export type DataExportFailure = z.infer<typeof DataExportFailure>;

/** Every refusal the 00001061 definers raise, as the exception message. */
export const DataExportRefusal = z.enum([
	"reauth_required",
	"already_pending",
	"rate_limited",
	"account_closing",
]);
export type DataExportRefusal = z.infer<typeof DataExportRefusal>;

/** Whether a raised message is one of the {@link DataExportRefusal} codes. */
export function isDataExportRefusal(value: unknown): value is DataExportRefusal {
	return DataExportRefusal.safeParse(value).success;
}
// #endregion

// #region Table row
/** `org.data_export_requests`, column for column. */
export const DataExportRequestRowSchema = z.object({
	id: z.string(),
	user_id: z.string(),
	status: DataExportStatus,
	requested_at: z.string(),
	started_at: z.string().nullable(),
	attempts: z.number().int().min(0),
	ready_at: z.string().nullable(),
	expires_at: z.string().nullable(),
	expired_at: z.string().nullable(),
	failed_at: z.string().nullable(),
	failure_reason: DataExportFailure.nullable(),
	storage_path: z.string().nullable(),
	byte_size: z.number().int().min(0).nullable(),
	manifest_version: z.number().int().min(1).nullable(),
});
export type DataExportRequestRow = z.infer<typeof DataExportRequestRowSchema>;
// #endregion

// #region The person's view
/** One request as Settings → Account draws it. A ready archive past its expiry reads `expired`. */
export const DataExportSchema = z.object({
	id: z.string(),
	status: DataExportStatus,
	requestedAt: z.string(),
	readyAt: z.string().nullable(),
	expiresAt: z.string().nullable(),
	byteSize: z.number().int().min(0).nullable(),
	failureReason: DataExportFailure.nullable(),
});
export type DataExport = z.infer<typeof DataExportSchema>;

/** Where the person stands: their latest request, when the next may be filed, and the sign-in gate. */
export const DataExportStateSchema = z.object({
	latest: DataExportSchema.nullable(),
	/** When a new request may be filed under the 24-hour limit; `null` = now (or one is open). */
	nextRequestAt: z.string().nullable(),
	/** Whether this session signed in recently enough to file a request now. */
	signInFresh: z.boolean(),
	/** An account erasure is scheduled, so no request can be filed. */
	accountClosing: z.boolean(),
});
export type DataExportState = z.infer<typeof DataExportStateSchema>;

const DataExportAnswerRowSchema = z
	.object({
		id: z.string(),
		status: DataExportStatus,
		requested_at: z.string(),
		ready_at: z.string().nullable(),
		expires_at: z.string().nullable(),
		byte_size: z.number().int().min(0).nullable(),
		failure_reason: DataExportFailure.nullable(),
	})
	.transform((row): DataExport => ({
		id: row.id,
		status: row.status,
		requestedAt: row.requested_at,
		readyAt: row.ready_at,
		expiresAt: row.expires_at,
		byteSize: row.byte_size,
		failureReason: row.failure_reason,
	}));

/** `org.get_data_export` / `org.request_data_export`'s snake_case answer. */
export const DataExportStateRowSchema = z
	.object({
		latest: DataExportAnswerRowSchema.nullable(),
		next_request_at: z.string().nullable(),
		sign_in_fresh: z.boolean(),
		account_closing: z.boolean(),
	})
	.transform((row): DataExportState => ({
		latest: row.latest,
		nextRequestAt: row.next_request_at,
		signInFresh: row.sign_in_fresh,
		accountClosing: row.account_closing,
	}));
// #endregion

// #region The job's view
/** One request the job claimed (`security.claim_data_exports`). */
export const DataExportClaimSchema = z.object({
	id: z.string(),
	user_id: z.string(),
	attempts: z.number().int().min(1),
	requested_at: z.string(),
});
export type DataExportClaim = z.infer<typeof DataExportClaimSchema>;

/** One ready archive past its expiry (`security.due_data_export_expiries`). */
export const DataExportExpirySchema = z.object({
	id: z.string(),
	storage_path: z.string(),
});
export type DataExportExpiry = z.infer<typeof DataExportExpirySchema>;

/** What one run of the data export job did. */
export interface DataExportSweep {
	built: number;
	retried: number;
	failed: number;
	expired: number;
}
// #endregion
