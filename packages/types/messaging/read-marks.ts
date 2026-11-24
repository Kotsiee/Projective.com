import { z } from "zod";

/**
 * read marks — when a person last read a conversation surface inside a project (PROJECTS CH3,
 * PRD-E13, PRD-E17).
 *
 * A thread keeps its watermark on the reader's participant row (`comms.dm_participants.last_read_at`,
 * moved by `comms.mark_dm_read`). A project room has no per-person row, so its watermark is its own
 * table, `comms.project_channel_reads`, moved only by `comms.mark_room_read`. Both are moved by one
 * POST the chat island sends once a page has painted in a visible tab (CAS M10; a GET writes nothing,
 * PRD-C11): `POST /api/projects/messages/read` names the `(projectId, channelId)` pair the composer
 * posts to, so a `cht-` channel marks the thread and anything else marks the room
 * (`projectChatRef`). `read-marks.contract.test.ts` holds the row schema to the migration.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
// #endregion

// #region comms.project_channel_reads
/**
 * One `comms.project_channel_reads` row: the reader's own watermark in one project room. No row means
 * the room was never opened, and `comms.unread_rooms` then counts from the reader's first lane mark
 * on the engagement (`projects.view_reads`), so arriving on a project shows no room's history as news.
 */
export const ProjectChannelReadRowSchema = z.object({
	channelId: uuid,
	userId: uuid,
	lastReadAt: timestamp,
});
export type ProjectChannelReadRow = z.infer<typeof ProjectChannelReadRowSchema>;
// #endregion

// #region The read POST
/**
 * `POST /api/projects/messages/read`: the project chat a person has just seen, named exactly as the
 * composer's send names it (`SendProjectMessageSchema`'s `projectId` and `channelId`), so the two
 * resolve one room through one rule.
 */
export const MarkChatReadInputSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120),
});
export type MarkChatReadInput = z.infer<typeof MarkChatReadInputSchema>;
// #endregion
