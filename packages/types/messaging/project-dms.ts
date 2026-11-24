import { z } from "zod";
import { slugPattern } from "../slugs/slug.ts";

/**
 * project DMs — bringing a one-to-one conversation into a project, and taking it out (PROJECTS CH3,
 * Decision #560; the owner's ruling on stop 23).
 *
 * Either participant may bring their DM into a project while both are parties to it, and the other
 * is told (`message.brought_into_project`); either may take it out again, which hides it from the
 * project's Private Messages group for both people and leaves every message's project stamp in place
 * as evidence. The writes are `comms.bring_dm_into_project` and `comms.take_dm_out_of_project`; the
 * state is `comms.dm_thread_projects` (`project-dms.contract.test.ts` holds this file to it).
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
const projectRef = z.string().regex(slugPattern("project"), {
	error: "Expected a project address.",
});
const threadRef = z.string().regex(slugPattern("thread"), {
	error: "Expected a conversation address.",
});
// #endregion

// #region comms.dm_thread_projects
/**
 * One `comms.dm_thread_projects` row: a thread's place in one project beyond its stamped messages.
 * Brought in (`broughtIn*` set, `takenOut*` null) lists it in the project's group; taken out
 * (`takenOut*` set) hides it there however many stamped messages it holds.
 */
export const DmThreadProjectRowSchema = z.object({
	threadId: uuid,
	projectId: uuid,
	broughtInBy: uuid.nullable(),
	broughtInAt: timestamp.nullable(),
	takenOutBy: uuid.nullable(),
	takenOutAt: timestamp.nullable(),
}).refine((r) => (r.broughtInBy === null) === (r.broughtInAt === null), {
	message: "Who brought it in and when are stored together.",
	path: ["broughtInAt"],
}).refine((r) => (r.takenOutBy === null) === (r.takenOutAt === null), {
	message: "Who took it out and when are stored together.",
	path: ["takenOutAt"],
}).refine((r) => r.broughtInAt !== null || r.takenOutAt !== null, {
	message: "A row says the thread was brought in or taken out.",
	path: ["broughtInAt"],
});
export type DmThreadProjectRow = z.infer<typeof DmThreadProjectRowSchema>;
// #endregion

// #region The two doors
/**
 * `POST /api/projects/messages/dm`: open the viewer's conversation with a project member inside the
 * project (the Members "Message" action), bringing it in first when it is not there yet.
 */
export const BringDmIntoProjectInputSchema = z.object({
	projectId: projectRef,
	/** The other person's platform `@handle`, with or without the `@`. */
	handle: z.string().min(1).max(40).transform((h) => h.replace(/^@+/, "")),
});
export type BringDmIntoProjectInput = z.infer<typeof BringDmIntoProjectInputSchema>;

/** `DELETE /api/projects/messages/dm`: take one conversation out of the project's group. */
export const TakeDmOutOfProjectInputSchema = z.object({
	projectId: projectRef,
	conversationId: threadRef,
});
export type TakeDmOutOfProjectInput = z.infer<typeof TakeDmOutOfProjectInputSchema>;

/** The conversation a bring-in opened, by its `cht-` address; `moved` is false when it was already in. */
export const DmBroughtIntoProjectSchema = z.object({
	ref: threadRef,
	moved: z.boolean(),
});
export type DmBroughtIntoProject = z.infer<typeof DmBroughtIntoProjectSchema>;

/** Whether a take-out moved anything: false when the conversation was not in the group. */
export const DmTakenOutOfProjectSchema = z.object({ moved: z.boolean() });
export type DmTakenOutOfProject = z.infer<typeof DmTakenOutOfProjectSchema>;
// #endregion
