import {
	messageDeltaFor,
	MessageEditFreeze,
	type MessageEditRules,
} from "@projective/types/projects";
import type { MessageChange } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import type { WriteOutcome } from "../projects/live-writes.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { commsClient } from "./live-queries.ts";

/**
 * live-message-edits — the author's two acts on a sent message (PROJECTS CH1; CAS M11): an edit
 * (`comms.edit_message`) and a delete for everyone (`comms.delete_message`), plus the rules a room's
 * reader is told before they are offered (`comms.message_edit_rules`). All three are definers that
 * resolve the message (or the room) by id and check the author, the window and the freeze under
 * their own lock, so this module only calls them as the caller and puts their SQLSTATEs in the
 * product's words: a message the caller cannot read is a miss (`null`, a 404), never a hint that it
 * exists.
 */

// #region Refusals
/** The doors' SQLSTATEs (00001300 §Editing and deleting a message) as HTTP refusals. */
const REFUSALS: Readonly<Record<string, number>> = {
	"42501": 403,
	"22023": 422,
	PM409: 409,
	PM410: 409,
	PM423: 409,
};

/** One door's raw answer, as `fn_message_change_result` builds it. */
interface ChangeRow {
	id: string;
	body: string;
	body_delta: unknown;
	pii_masked: boolean;
	edited_at: string | null;
	deleted_at: string | null;
}

function changeOf(row: ChangeRow): MessageChange {
	const deleted = row.deleted_at !== null;
	return {
		id: row.id,
		text: deleted ? "" : row.body,
		delta: deleted ? null : messageDeltaFor(row.body_delta, row.body),
		editedAt: row.edited_at,
		deleted,
	};
}

/** A door's error as an outcome: P0002 is a miss, a known refusal its own sentence; else it throws. */
function refusalOf(
	error: { code?: string; message: string },
	what: string,
): WriteOutcome<never> {
	if (error.code === "P0002") return null;
	const status = error.code ? REFUSALS[error.code] : undefined;
	if (status) return { refusal: { status, message: error.message } };
	throw new Error(`${what} failed: ${error.message}`);
}
// #endregion

// #region Doors
/** The author edits their message's words and formatting inside the window. */
export async function editLiveMessage(
	actor: ReadActor & { accessToken: string },
	messageId: string,
	input: { text: string; delta: unknown },
): Promise<WriteOutcome<MessageChange>> {
	if (!UUID_RE.test(messageId)) return null;
	const { data, error } = await commsClient(actor).rpc("edit_message", {
		p_message_id: messageId,
		p_body: input.text,
		p_body_delta: input.delta,
	});
	if (error) return refusalOf(error, "comms.edit_message");
	return { data: changeOf(data as ChangeRow) };
}

/** The author deletes their message for everyone. */
export async function deleteLiveMessage(
	actor: ReadActor & { accessToken: string },
	messageId: string,
): Promise<WriteOutcome<MessageChange>> {
	if (!UUID_RE.test(messageId)) return null;
	const { data, error } = await commsClient(actor).rpc("delete_message", {
		p_message_id: messageId,
	});
	if (error) return refusalOf(error, "comms.delete_message");
	return { data: changeOf(data as ChangeRow) };
}
// #endregion

// #region Rules
/**
 * The edit rules of a project room or a thread, by its uuid, for a page read. A room the caller
 * cannot read, or a failed read, is `null`: the page then offers no edit or delete, which is the
 * safe answer for a surface that only decides what to offer.
 */
export async function liveMessageEditRules(
	actor: ReadActor & { accessToken: string },
	roomId: string,
): Promise<MessageEditRules | null> {
	if (!UUID_RE.test(roomId)) return null;
	const { data, error } = await commsClient(actor).rpc("message_edit_rules", { p_room_id: roomId });
	if (error || !data) return null;
	const raw = data as { frozen?: unknown; edit_window_minutes?: unknown };
	const frozen = MessageEditFreeze.safeParse(raw.frozen);
	const minutes = Number(raw.edit_window_minutes);
	if (!Number.isInteger(minutes) || minutes < 0) return null;
	return { windowMinutes: minutes, frozen: frozen.success ? frozen.data : null };
}
// #endregion
