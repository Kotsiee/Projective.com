import type { MessageAttachmentMode } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import type { WriteRefusal } from "../projects/live-writes.ts";
import { filesDb, UUID_RE } from "../projects/live-support.ts";

/**
 * link-shares — sharing a file as a link in a message (Decision #401), for both message tables.
 *
 * A link share is a `comms.message_attachments` row in `link` mode. `files.fn_can_read` lets the
 * message's readers open the file through it only while the file is not `private`, so sending one
 * raises a private file to `restricted`, and the owner takes every link share back by returning it to
 * private. Copies sent earlier are untouched.
 *
 * Only the sender's own personal file can be shared this way. A team, business or project file is
 * read through its membership arm, which `fn_can_read` answers before the message arm, so a link share
 * of one would open for nobody new; the sender is told to send a copy instead.
 */

// #region Rules
/** The `files.items` columns the rule reads. */
export interface LinkShareRow {
	id: string;
	owner_user_id: string;
	owner_type: string;
	source: string;
	bucket_id: string;
	visibility: string;
}

/** Why a set of files cannot be shared as links, or `null` when every one can. */
export type LinkShareProblem = "missing" | "not_yours";

/**
 * The rule, pure: every id names a live row the sender can read, owns in their personal library, and
 * stores (an upload, which the link card opens in the inspector; never a saved web link, a mount or a
 * project room's file).
 */
export function linkShareProblem(
	ids: readonly string[],
	rows: readonly LinkShareRow[],
	senderId: string,
): LinkShareProblem | null {
	const byId = new Map(rows.map((row) => [row.id, row]));
	for (const id of ids) {
		const row = byId.get(id);
		if (!row) return "missing";
		const personal = row.owner_type === "user" && row.owner_user_id === senderId;
		if (row.source !== "supabase" || !personal || row.bucket_id === "project") return "not_yours";
	}
	return null;
}

const REFUSALS: Readonly<Record<LinkShareProblem, string>> = {
	missing: "One of the files can't be found any more. Remove it and try again.",
	not_yours: "Only files in your own library can be shared as a link. Send a copy instead.",
};

/** The refusal a problem is answered with, on the `linkedFileIds` field. */
export function linkShareRefusal(problem: LinkShareProblem): WriteRefusal {
	return { status: 422, message: REFUSALS[problem], errors: { linkedFileIds: problem } };
}
// #endregion

// #region Rows
/** One `comms.message_attachments` row to insert. */
export interface AttachmentInsert {
	message_table: "comms.project_messages" | "comms.dm_messages";
	message_id: string;
	attachment_id: string;
	mode: MessageAttachmentMode;
}

/** The attachment rows for one message: its copies, then its link shares. */
export function attachmentInserts(
	messageTable: AttachmentInsert["message_table"],
	messageId: string,
	copies: readonly string[],
	links: readonly string[],
): AttachmentInsert[] {
	return [
		...copies.map((id) => ({
			message_table: messageTable,
			message_id: messageId,
			attachment_id: id,
			mode: "copy" as const,
		})),
		...links.map((id) => ({
			message_table: messageTable,
			message_id: messageId,
			attachment_id: id,
			mode: "link" as const,
		})),
	];
}
// #endregion

// #region Writes
/**
 * Check a send's link shares and raise each private file to `restricted`, before the message exists:
 * a refusal leaves nothing written, and a message is never posted whose link shares would not open.
 * Read and written under the sender's own session, so the owner-only UPDATE policy is the gate.
 */
export async function prepareLinkShares(
	actor: ReadActor & { accessToken: string },
	ids: readonly string[],
): Promise<WriteRefusal | null> {
	if (ids.length === 0) return null;
	if (!ids.every((id) => UUID_RE.test(id))) return linkShareRefusal("missing");
	const db = filesDb(actor);
	const read = await db
		.from("items")
		.select("id, owner_user_id, owner_type, source, bucket_id, visibility")
		.in("id", ids as string[])
		.is("deleted_at", null);
	if (read.error) throw new Error(`files.items read failed: ${read.error.message}`);
	const problem = linkShareProblem(
		ids,
		(read.data ?? []) as unknown as LinkShareRow[],
		actor.userId,
	);
	if (problem) return linkShareRefusal(problem);

	const raised = await db
		.from("items")
		.update({ visibility: "restricted" })
		.in("id", ids as string[])
		.eq("visibility", "private");
	if (raised.error) throw new Error(`files.items visibility raise failed: ${raised.error.message}`);
	return null;
}
// #endregion
