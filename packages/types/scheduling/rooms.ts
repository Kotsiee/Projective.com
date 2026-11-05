import { z } from "zod";
import { isSlug } from "../slugs/slug.ts";

/**
 * Rooms — one meeting at a provider, whatever it belongs to (`scheduling.rooms`; Decision #343, ruling
 * C4; Decision #383). A person reaches a room through its opaque address, `/meet/rom-…`, so a provider's
 * link stays on the server until the moment of joining.
 */

// #region Joining
/** `scheduling.rooms.status`. */
export const RoomStatus = z.enum(["pending", "minting", "ready", "failed", "closing", "closed"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

/** Why `scheduling.room_join` did or did not hand out a link. */
export const RoomJoinState = z.enum([
	"open",
	"upcoming",
	"ended",
	"cancelled",
	"not_party",
	"needs_rsvp",
	"unfunded",
	"unconfirmed",
	"no_room",
]);
export type RoomJoinState = z.infer<typeof RoomJoinState>;

/** Whether a join link is a room's own `/meet` address rather than one a host pasted. */
export function isRoomAddress(link: string): boolean {
	return link.includes("/meet/") && isSlug(link.slice(link.lastIndexOf("/") + 1), "room");
}

/** What a join answers: where to go when the room is open, and why not when it is not. */
export const RoomJoinAnswerSchema = z.object({
	state: RoomJoinState,
	url: z.string().url().nullable(),
});
export type RoomJoinAnswer = z.infer<typeof RoomJoinAnswerSchema>;
// #endregion

// #region Attendance
/** How a person in a room was identified. Only `email` is weaker evidence (ruling C4 (b)). */
export const PresenceMatch = z.enum([
	"host_account",
	"registrant",
	"email",
	"sole_attendee",
	"session",
	"unmatched",
]);
export type PresenceMatch = z.infer<typeof PresenceMatch>;
// #endregion
