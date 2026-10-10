import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	type PartyRow,
	projectsDb,
	resolveChannelRef,
	senderOf,
} from "../projects/live-support.ts";
import { assetIdOf } from "@projective/types/files";
import {
	type AttachmentSource,
	attachmentSourceExcerpt,
	DISCUSSION_REF,
} from "@projective/types/projects";
import { fmtDay, fmtTime } from "../files/asset-row.ts";

/**
 * live-attachment-source — the reverse lookup behind the preview modal's "Go to message": which
 * messages a `files.items` asset was posted in, newest first.
 *
 * Read entirely under the caller's own JWT. `comms.message_attachments` answers only for messages the
 * caller may read (`view_attachments_if_member`: channel access for a project room, participation for a
 * DM — the predicate `comms.can_read_message` restates), and the message reads below run under their
 * own table policies again, so an asset posted somewhere the caller cannot see yields nothing rather
 * than a row with its message withheld. A soft-deleted message is excluded explicitly: the policies are
 * the security gate, `deleted_at` is the meaning gate.
 *
 * Every hop is a keyed `.in()` stitched in TypeScript — the link table's `message_id` has no foreign key
 * (it points at two parents), so PostgREST cannot embed through it.
 *
 * A project message's route uses the room's public address, never its uuid (Decision #88): a stage's
 * shared room is its `stg-…` slug, and the engagement's primary room is `discussion`. A private
 * talent/client room or a secondary project-wide room has no other address, so its room id is the
 * segment there — exactly what the channel tree links to.
 */

// #region Constants

/** How many link rows one lookup considers — far beyond any honest re-post count. */
const LINK_CAP = 50;

/** The two `comms.message_attachments.message_table` discriminators, schema-qualified. */
const DM_TABLE = "comms.dm_messages";
const PROJECT_TABLE = "comms.project_messages";

/** Room visibilities that make a stage room private to one side — addressed by id, not slug. */
const PRIVATE_ROOMS: ReadonlySet<string> = new Set(["team_private", "business_private"]);

// #endregion

// #region Row shapes

interface LinkRow {
	message_table: string;
	message_id: string;
}

interface DmMessageRow {
	id: string;
	thread_id: string;
	sender_user_id: string;
	body: string | null;
	created_at: string;
}

interface ProjectMessageRow {
	id: string;
	channel_id: string;
	sender_user_id: string;
	body: string | null;
	created_at: string;
}

interface ThreadRow {
	id: string;
	kind: string | null;
	title: string | null;
}

/** One `comms.project_channels` row, as the source lookup reads it. */
export interface ChannelRow {
	id: string;
	project_id: string;
	name: string | null;
	stage_id: string | null;
	visibility: string | null;
}

// #endregion

// #region Pure helpers

/** `/messages/<conversation>?m=<message>` — a conversation message's deep link. */
export function dmMessageHref(conversationId: string, messageId: string): string {
	return `/messages/${encodeURIComponent(conversationId)}?m=${encodeURIComponent(messageId)}`;
}

/** `/projects/<prj-…>/<segment>/chat?m=<message>` — a project room message's deep link. */
export function projectMessageHref(
	projectSlug: string,
	segment: string,
	messageId: string,
): string {
	return `/projects/${encodeURIComponent(projectSlug)}/${encodeURIComponent(segment)}/chat?m=${
		encodeURIComponent(messageId)
	}`;
}

/**
 * The route segment a project room is reached by: a stage's shared room by its `stg-…` slug (a
 * Task's discussion included — the slug names the same room), the engagement's project-wide primary
 * room by `discussion`, and anything else (a private side room, a secondary project-wide room) by its
 * own id. `null` when a stage room's slug did not resolve and it is not the discussion either.
 */
export function roomSegment(
	room: Pick<ChannelRow, "id" | "stage_id" | "visibility">,
	stageSlug: string | null,
	discussionRoomId: string | null,
): string | null {
	const shared = !!room.stage_id && !PRIVATE_ROOMS.has(room.visibility ?? "");
	if (shared && stageSlug) return stageSlug;
	if (room.id === discussionRoomId) return DISCUSSION_REF;
	return shared ? null : room.id;
}

/** Newest first, id as the tiebreak so two messages of one instant keep a stable order. */
export function bySourceRecency(a: AttachmentSource, b: AttachmentSource): number {
	return b.createdAt.localeCompare(a.createdAt) || b.messageId.localeCompare(a.messageId);
}

/** One source, from a message row and what was resolved around it. */
function toSource(
	row: { id: string; sender_user_id: string; body: string | null; created_at: string },
	where: Pick<AttachmentSource, "kind" | "conversationId" | "channelLabel" | "href">,
	party: PartyRow | undefined,
	now: number,
): AttachmentSource {
	const parsed = Date.parse(row.created_at);
	const at = Number.isNaN(parsed) ? now : parsed;
	const sender = senderOf(row.sender_user_id, party);
	return {
		messageId: row.id,
		kind: where.kind,
		conversationId: where.conversationId,
		channelLabel: where.channelLabel,
		sender: {
			id: clampOr(sender.id, 80, "unknown"),
			name: clampOr(sender.name, 120, "Unknown"),
			handle: sender.handle ? clamp(sender.handle, 40) : null,
			avatarSrc: sender.avatar ? clamp(sender.avatar, 400) : null,
		},
		createdAt: new Date(at).toISOString(),
		dayLabel: clamp(fmtDay(at, now), 24),
		timeLabel: clamp(fmtTime(at), 20),
		excerpt: attachmentSourceExcerpt(row.body),
		href: where.href,
	};
}

// #endregion

// #region Reads

async function dmSources(
	actor: ReadActor & { accessToken: string },
	ids: readonly string[],
): Promise<{ rows: DmMessageRow[]; threads: Map<string, ThreadRow> }> {
	if (ids.length === 0) return { rows: [], threads: new Map() };
	const db = commsDb(actor);
	const read = await db
		.from("dm_messages")
		.select("id, thread_id, sender_user_id, body, created_at")
		.in("id", ids as string[])
		.is("deleted_at", null);
	if (read.error) throw new Error(`comms.dm_messages read failed: ${read.error.message}`);
	const rows = (read.data ?? []) as unknown as DmMessageRow[];
	const threadIds = [...new Set(rows.map((row) => row.thread_id))];
	const threads = new Map<string, ThreadRow>();
	if (threadIds.length === 0) return { rows, threads };
	const threadRead = await db.from("dm_threads").select("id, kind, title").in("id", threadIds);
	if (!threadRead.error) {
		for (const row of (threadRead.data ?? []) as unknown as ThreadRow[]) threads.set(row.id, row);
	}
	return { rows, threads };
}

interface ProjectContext {
	rows: ProjectMessageRow[];
	channels: Map<string, ChannelRow>;
	projectSlugs: Map<string, string>;
	stageSlugs: Map<string, string>;
	discussionRooms: Map<string, string | null>;
}

async function projectSources(
	actor: ReadActor & { accessToken: string },
	ids: readonly string[],
): Promise<ProjectContext> {
	const empty: ProjectContext = {
		rows: [],
		channels: new Map(),
		projectSlugs: new Map(),
		stageSlugs: new Map(),
		discussionRooms: new Map(),
	};
	if (ids.length === 0) return empty;
	const comms = commsDb(actor);
	const read = await comms
		.from("project_messages")
		.select("id, channel_id, sender_user_id, body, created_at")
		.in("id", ids as string[])
		.is("deleted_at", null);
	if (read.error) throw new Error(`comms.project_messages read failed: ${read.error.message}`);
	const rows = (read.data ?? []) as unknown as ProjectMessageRow[];
	if (rows.length === 0) return empty;

	const channelRead = await comms
		.from("project_channels")
		.select("id, project_id, name, stage_id, visibility")
		.in("id", [...new Set(rows.map((row) => row.channel_id))]);
	if (channelRead.error) {
		throw new Error(`comms.project_channels read failed: ${channelRead.error.message}`);
	}
	const channels = new Map(
		((channelRead.data ?? []) as unknown as ChannelRow[]).map((row) => [row.id, row]),
	);
	const rooms = [...channels.values()];
	const projectIds = [...new Set(rooms.map((row) => row.project_id))];
	const stageIds = [
		...new Set(rooms.map((row) => row.stage_id).filter((id): id is string => !!id)),
	];
	const withGeneralRoom = [
		...new Set(rooms.filter((row) => !row.stage_id).map((row) => row.project_id)),
	];

	const projects = projectsDb(actor);
	const [projectRead, stageRead, discussions] = await Promise.all([
		projects.from("projects").select("id, slug").in("id", projectIds),
		stageIds.length > 0
			? projects.from("project_stages").select("id, slug").in("id", stageIds)
			: Promise.resolve({ data: [], error: null }),
		Promise.all(
			withGeneralRoom.map(async (id) =>
				[id, await resolveChannelRef(actor, id, DISCUSSION_REF)] as const
			),
		),
	]);
	if (projectRead.error) {
		throw new Error(`projects.projects read failed: ${projectRead.error.message}`);
	}
	const projectSlugs = new Map(
		((projectRead.data ?? []) as unknown as { id: string; slug: string }[]).map((
			row,
		) => [row.id, row.slug]),
	);
	const stageSlugs = new Map(
		stageRead.error
			? []
			: ((stageRead.data ?? []) as unknown as { id: string; slug: string }[]).map((row) => [
				row.id,
				row.slug,
			]),
	);
	return { rows, channels, projectSlugs, stageSlugs, discussionRooms: new Map(discussions) };
}

/**
 * Every readable message `assetId` was posted in, newest first — narrowed to one conversation (a DM
 * thread id or a project room id) when `conversationId` is given. An empty list is a real answer:
 * the asset was never posted anywhere this caller can read.
 *
 * Throws on a failed primary read (the link rows, a message table, the room or project rows) so the
 * service can tell an outage from "never posted"; the thread titles and the party lookup degrade.
 */
export async function fetchAttachmentSources(
	actor: ReadActor & { accessToken: string },
	assetId: string,
	opts: { conversationId?: string | null } = {},
	now: number = Date.now(),
): Promise<AttachmentSource[]> {
	const id = assetIdOf(assetId);
	if (!id) return [];

	const links = await commsDb(actor)
		.from("message_attachments")
		.select("message_table, message_id")
		.eq("attachment_id", id)
		.order("created_at", { ascending: false })
		.limit(LINK_CAP);
	if (links.error) throw new Error(`comms.message_attachments read failed: ${links.error.message}`);
	const linkRows = (links.data ?? []) as unknown as LinkRow[];
	if (linkRows.length === 0) return [];

	const idsOf = (table: string) => [
		...new Set(linkRows.filter((row) => row.message_table === table).map((row) => row.message_id)),
	];
	const [dm, project] = await Promise.all([
		dmSources(actor, idsOf(DM_TABLE)),
		projectSources(actor, idsOf(PROJECT_TABLE)),
	]);
	const parties = await fetchParties(actor, [
		...dm.rows.map((row) => row.sender_user_id),
		...project.rows.map((row) => row.sender_user_id),
	]);

	const out: AttachmentSource[] = [];
	for (const row of dm.rows) {
		const thread = dm.threads.get(row.thread_id);
		const title = thread?.title?.trim() ?? "";
		out.push(toSource(
			row,
			{
				kind: "dm",
				conversationId: row.thread_id,
				channelLabel: title ? clamp(title, 160) : null,
				href: dmMessageHref(row.thread_id, row.id),
			},
			parties.get(row.sender_user_id),
			now,
		));
	}
	for (const row of project.rows) {
		const room = project.channels.get(row.channel_id);
		const slug = room ? project.projectSlugs.get(room.project_id) : undefined;
		if (!room || !slug) continue;
		const segment = roomSegment(
			room,
			room.stage_id ? project.stageSlugs.get(room.stage_id) ?? null : null,
			project.discussionRooms.get(room.project_id) ?? null,
		);
		if (!segment) continue;
		out.push(toSource(
			row,
			{
				kind: "project",
				conversationId: room.id,
				channelLabel: room.name?.trim() ? clamp(room.name, 160) : null,
				href: projectMessageHref(slug, segment, row.id),
			},
			parties.get(row.sender_user_id),
			now,
		));
	}

	const scope = opts.conversationId ?? null;
	return out.filter((source) => !scope || source.conversationId === scope).sort(bySourceRecency);
}

// #endregion
