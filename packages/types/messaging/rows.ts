import { z } from "zod";
import { MessageAttachmentMode } from "../projects/messages.ts";

/**
 * messaging rows — the Zod mirror of the message tables in `00000016_tables_comms.sql` that the app
 * reads row for row. Today that is `comms.message_attachments`, the polymorphic link between a
 * message (a stage-room post or a DM) and a `files.items` file, which since PROJECTS CH4 also holds a
 * voice memo's length and waveform (CAS M18).
 *
 * Row shapes assert only what the table asserts: a CHECK is spelled the same way on both sides.
 * `messaging-tables.contract.test.ts` holds each schema to the migration, column for key.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
// #endregion

// #region comms.message_attachments
/** `message_attachments.message_table`: the schema-qualified table the message lives in. */
export const MessageTableName = z.enum(["comms.project_messages", "comms.dm_messages"]);
export type MessageTableName = z.infer<typeof MessageTableName>;

/** The most envelope samples a memo stores (`message_attachments_audio_peaks`). */
export const MEMO_PEAKS_MAX = 512;

/**
 * One `comms.message_attachments` row. `audioDurationMs` and `audioPeaks` are set together, only on
 * a `copy` row, and only on the one row per message that is its voice memo
 * (`uq_message_attachments_one_memo`).
 */
export const MessageAttachmentRowSchema = z.object({
	id: uuid,
	messageTable: MessageTableName,
	messageId: uuid,
	attachmentId: uuid,
	mode: MessageAttachmentMode,
	createdAt: timestamp,
	audioDurationMs: z.number().int().min(0).nullable(),
	audioPeaks: z.array(z.number().min(0).max(1)).max(MEMO_PEAKS_MAX).nullable(),
}).refine((row) => (row.audioDurationMs === null) === (row.audioPeaks === null), {
	message: "A memo's length and waveform are stored together.",
	path: ["audioPeaks"],
}).refine((row) => row.audioDurationMs === null || row.mode === "copy", {
	message: "Only an uploaded copy can be a voice memo.",
	path: ["mode"],
});
export type MessageAttachmentRow = z.infer<typeof MessageAttachmentRowSchema>;
// #endregion
