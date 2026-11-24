import type { ReadActor } from "../read-actor.ts";
import type { WriteOutcome } from "./live-writes.ts";
import { resolveSendRoom } from "./live-writes.ts";
import { commsDb, orgDb, projectsDb } from "./live-support.ts";

/**
 * live-read-marks — the comms RPCs behind a project's read state and its Private Messages group
 * (PROJECTS CH3; PRD-E13, PRD-E17): a room's read mark, the rooms that hold news for the viewer, the
 * threads of the group, and the two doors that bring a DM into the project and take it out
 * (Decision #560).
 *
 * Every call runs under the caller's own JWT. `comms.mark_room_read`, `comms.bring_dm_into_project`
 * and `comms.take_dm_out_of_project` are the definers (their tables have no client write);
 * `comms.unread_rooms` and `comms.project_dm_threads` are invokers, so the room, message and
 * participant read policies decide what they answer.
 */

// #region Room read mark
/**
 * Move the caller's read mark in the room a project chat addresses (`projectSlug` and the channel
 * segment the composer posts to, resolved by the send's own {@link resolveSendRoom}). `null` when the
 * pair names no room the caller can read; THROWS on any other failure.
 */
export async function markLiveRoomRead(
	actor: ReadActor & { accessToken: string },
	projectSlug: string,
	channelRef: string,
): Promise<WriteOutcome<{ moved: boolean }>> {
	const room = await resolveSendRoom(actor, projectSlug, channelRef);
	if (!room) return null;
	const { data, error } = await commsDb(actor).rpc("mark_room_read", { p_channel_id: room });
	if (error) {
		if (error.code === "42501") return null;
		throw new Error(`comms.mark_room_read failed: ${error.message}`);
	}
	return { data: { moved: data === true } };
}
// #endregion

// #region Unread rooms
/**
 * The rooms of one project that hold news for the viewer (`comms.unread_rooms`), by room id.
 * Secondary to the tree it marks: a failed read marks nothing unread, which is the tree's state
 * before read marks existed, rather than failing the project.
 */
export async function fetchUnreadRoomIds(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<Set<string>> {
	const { data, error } = await commsDb(actor).rpc("unread_rooms", { p_project_id: projectId });
	if (error || !Array.isArray(data)) return new Set();
	return new Set(
		(data as unknown[]).map((row) =>
			typeof row === "string" ? row : (row as { unread_rooms?: string }).unread_rooms ?? ""
		).filter((id) => id.length > 0),
	);
}
// #endregion

// #region Bring a DM in, take it out (Decision #560)
/** The project's row id for its `prj-` address, as the caller may see it; `null` for none. THROWS on failure. */
async function projectIdOf(
	actor: ReadActor & { accessToken: string },
	slug: string,
): Promise<string | null> {
	const { data, error } = await projectsDb(actor).from("projects").select("id").eq("slug", slug)
		.maybeSingle();
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	return (data as { id: string } | null)?.id ?? null;
}

/**
 * Bring the caller's conversation with the person at `handle` into the project (`comms.bring_dm_into_project`),
 * opening the pair's DM when there is none. `null` when the project or the person names nothing the
 * caller can reach; a refusal in the door's own words when the other is not on the project (CH409),
 * the DM shield refuses the pair (PM403) or the handle is the caller's own (22023). THROWS otherwise.
 */
export async function bringLiveDmIntoProject(
	actor: ReadActor & { accessToken: string },
	projectSlug: string,
	handle: string,
): Promise<WriteOutcome<{ ref: string; moved: boolean }>> {
	const [projectId, person] = await Promise.all([
		projectIdOf(actor, projectSlug),
		orgDb(actor).from("users_public").select("user_id").eq("username", handle).maybeSingle(),
	]);
	if (person.error) throw new Error(`org.users_public read failed: ${person.error.message}`);
	const otherId = (person.data as { user_id: string } | null)?.user_id;
	if (!projectId || !otherId) return null;

	const { data, error } = await commsDb(actor).rpc("bring_dm_into_project", {
		p_project_id: projectId,
		p_target_user_id: otherId,
	});
	if (error) {
		if (error.code === "42501") return null;
		if (error.code === "CH409") return { refusal: { status: 409, message: error.message } };
		if (error.code === "PM403") return { refusal: { status: 403, message: error.message } };
		if (error.code === "22023") {
			return { refusal: { status: 422, message: "That conversation would be with yourself." } };
		}
		throw new Error(`comms.bring_dm_into_project failed: ${error.message}`);
	}
	const answer = data as { thread_ref?: unknown; moved?: unknown } | null;
	if (typeof answer?.thread_ref !== "string") {
		throw new Error("comms.bring_dm_into_project returned no thread address");
	}
	return { data: { ref: answer.thread_ref, moved: answer.moved === true } };
}

/**
 * Take the conversation at `ref` out of the project's group (`comms.take_dm_out_of_project`). `null`
 * when the project or the conversation names nothing the caller can reach; a 422 for a group, which
 * the pair door could not bring back. THROWS otherwise.
 */
export async function takeLiveDmOutOfProject(
	actor: ReadActor & { accessToken: string },
	projectSlug: string,
	ref: string,
): Promise<WriteOutcome<{ moved: boolean }>> {
	const [projectId, thread] = await Promise.all([
		projectIdOf(actor, projectSlug),
		commsDb(actor).from("dm_threads").select("id").eq("ref", ref).maybeSingle(),
	]);
	if (thread.error) throw new Error(`comms.dm_threads read failed: ${thread.error.message}`);
	const threadId = (thread.data as { id: string } | null)?.id;
	if (!projectId || !threadId) return null;

	const { data, error } = await commsDb(actor).rpc("take_dm_out_of_project", {
		p_thread_id: threadId,
		p_project_id: projectId,
	});
	if (error) {
		if (error.code === "42501") return null;
		if (error.code === "22023") return { refusal: { status: 422, message: error.message } };
		throw new Error(`comms.take_dm_out_of_project failed: ${error.message}`);
	}
	return { data: { moved: data === true } };
}
// #endregion

// #region Private Messages threads
/** One thread of the project's Private Messages group, as `comms.project_dm_threads` answers it. */
export interface ProjectDmThreadRow {
	thread_id: string;
	ref: string;
	kind: "dm" | "service_inquiry" | "group";
	title: string | null;
	last_stamped_at: string;
}

/**
 * Every thread of the viewer's holding a message stamped with this project, one row each, newest
 * first (`comms.project_dm_threads`). The read it replaces scanned at most 500 stamped messages, so a
 * busy thread could crowd the others out (Decision #508 (g)). Secondary: a failed read is no group.
 */
export async function fetchProjectDmThreads(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ProjectDmThreadRow[]> {
	const { data, error } = await commsDb(actor).rpc("project_dm_threads", {
		p_project_id: projectId,
	});
	if (error || !Array.isArray(data)) return [];
	return data as ProjectDmThreadRow[];
}
// #endregion
