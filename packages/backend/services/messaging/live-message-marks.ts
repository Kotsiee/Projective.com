import type { ReadActor } from "../read-actor.ts";
import type { WriteOutcome } from "../projects/live-writes.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { commsClient } from "./live-queries.ts";

/**
 * live-message-marks — the two per-message marks a reader sets: a PIN (`comms.message_pins`, shared by
 * everyone in the room) and a FAVOURITE (`comms.message_favorites`, the caller's own, listed on
 * `/saved`). Both tables are polymorphic over the two message tables, so a write first finds which
 * one holds the id — as the caller, so a message they cannot read is a miss (`null`, a 404).
 */

// #region Message lookup

/** The `message_table` discriminator the two mark tables carry. */
export type MessageTable = "comms.dm_messages" | "comms.project_messages";

/** Which table holds a live message the caller can read, or `null`. */
export async function messageTableOf(
	actor: ReadActor & { accessToken: string },
	messageId: string,
): Promise<MessageTable | null> {
	if (!UUID_RE.test(messageId)) return null;
	const db = commsClient(actor);
	const [dm, project] = await Promise.all([
		db.from("dm_messages").select("id").eq("id", messageId).is("deleted_at", null).maybeSingle(),
		db.from("project_messages").select("id").eq("id", messageId).is("deleted_at", null)
			.maybeSingle(),
	]);
	if (dm.error) throw new Error(`comms.dm_messages read failed: ${dm.error.message}`);
	if (project.error) {
		throw new Error(`comms.project_messages read failed: ${project.error.message}`);
	}
	if (dm.data) return "comms.dm_messages";
	return project.data ? "comms.project_messages" : null;
}

// #endregion

// #region Writes

/** Pin or unpin a message for the whole room. Idempotent both ways. */
export async function setMessagePin(
	actor: ReadActor & { accessToken: string },
	messageId: string,
	pinned: boolean,
): Promise<WriteOutcome<{ pinned: boolean }>> {
	const table = await messageTableOf(actor, messageId);
	if (!table) return null;
	const pins = commsClient(actor).from("message_pins");
	const { error } = pinned
		? await pins.upsert(
			{ message_table: table, message_id: messageId, pinned_by_user_id: actor.userId },
			{ onConflict: "message_table,message_id", ignoreDuplicates: true },
		)
		: await pins.delete().eq("message_table", table).eq("message_id", messageId);
	if (error) {
		if (error.code === "42501") {
			return { refusal: { status: 403, message: "You can't pin messages here." } };
		}
		throw new Error(`comms.message_pins write failed: ${error.message}`);
	}
	return { data: { pinned } };
}

/** Favourite or un-favourite a message for the caller only. Idempotent both ways. */
export async function setMessageFavourite(
	actor: ReadActor & { accessToken: string },
	messageId: string,
	favourite: boolean,
): Promise<WriteOutcome<{ favourite: boolean }>> {
	const table = await messageTableOf(actor, messageId);
	if (!table) return null;
	const favourites = commsClient(actor).from("message_favorites");
	const { error } = favourite
		? await favourites.upsert(
			{ user_id: actor.userId, message_table: table, message_id: messageId },
			{ onConflict: "user_id,message_table,message_id", ignoreDuplicates: true },
		)
		: await favourites.delete().eq("user_id", actor.userId).eq("message_table", table).eq(
			"message_id",
			messageId,
		);
	if (error) {
		if (error.code === "42501") return null;
		throw new Error(`comms.message_favorites write failed: ${error.message}`);
	}
	return { data: { favourite } };
}

// #endregion
