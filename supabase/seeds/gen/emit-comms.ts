/**
 * emit-comms.ts — `08_comms.sql`: project channels and their messages, direct-message threads
 * with read state, notifications, and a couple of auto-responses.
 *
 * Notifications are inserted through a join onto `comms.notification_types`, so category, urgency
 * and the channel fan-out come from the catalog rather than being restated here — the one place a
 * seeded notification could disagree with the router.
 */

import { ago, HEADER, id, insert, q, uuidFor } from "./sql.ts";
import { entity, party, persona, project, type World } from "./resolve.ts";
import { DMS, NOTIFICATIONS } from "./world.ts";

export function emitComms(world: World): string {
	const out: string[] = [
		HEADER(
			"08_comms.sql — project channels, direct messages and notifications",
			"A project gets a General room plus one `stage_all` room per stage (the rooms comms.get_stage_channels would otherwise provision lazily). DM read state is per participant: `last_read_at` before the last message means unread.",
		),
	];

	// #region Project channels + messages
	const channelRows: string[][] = [];
	const participantRows: string[][] = [];
	const messageRows: string[][] = [];
	for (const p of world.projects.values()) {
		channelRows.push([
			id(p.channelsByKey.get("general")!),
			id(p.projectId),
			"'General'",
			"NULL",
			"'project_all'",
			ago(p.createdDaysAgo),
		]);
		for (const s of p.stages) {
			channelRows.push([
				id(p.channelsByKey.get(s.key)!),
				id(p.projectId),
				q(s.name),
				id(p.stagesByKey.get(s.key)!.id),
				"'stage_all'",
				ago(p.createdDaysAgo),
			]);
		}
		// Participants on General: the client business and every assigned freelancer.
		const general = p.channelsByKey.get("general")!;
		if (p.clientBusinessId) {
			participantRows.push([
				id(uuidFor("channel_participant", `${p.key}:general:business`)),
				id(general),
				"'business'",
				id(p.clientBusinessId),
				"'owner'",
			]);
		}
		const seen = new Set<string>();
		for (const a of p.assignments) {
			const who = party(world, a.assignee);
			const users = who.kind === "user"
				? [who.persona.userId]
				: who.entity.members.map((m) => persona(world, m.persona).userId);
			for (const u of users) {
				if (seen.has(u)) continue;
				seen.add(u);
				participantRows.push([
					id(uuidFor("channel_participant", `${p.key}:general:${u}`)),
					id(general),
					"'freelancer'",
					id(u),
					"'participant'",
				]);
			}
		}
		p.messages.forEach((m, i) => {
			const channel = p.channelsByKey.get(m.channel);
			if (!channel) {
				throw new Error(`world: message on "${p.key}" names unknown channel "${m.channel}"`);
			}
			messageRows.push([
				id(uuidFor("project_message", `${p.key}:${i}`)),
				id(channel),
				id(persona(world, m.from).userId),
				q(m.body),
				ago(m.daysAgo),
			]);
		});
	}
	out.push(
		insert(
			"comms.project_channels",
			["id", "project_id", "name", "stage_id", "visibility", "created_at"],
			channelRows,
		),
	);
	out.push(
		insert(
			"comms.project_channel_participants",
			["id", "channel_id", "profile_type", "profile_id", "role"],
			participantRows,
		),
	);
	out.push(
		insert(
			"comms.project_messages",
			["id", "channel_id", "sender_user_id", "body", "created_at"],
			messageRows,
		),
	);
	// #endregion

	// #region Direct messages
	const threadRows: string[][] = [];
	const dmParticipantRows: string[][] = [];
	const dmMessageRows: string[][] = [];
	for (const dm of DMS) {
		const threadId = uuidFor("dm_thread", dm.key);
		const first = Math.max(...dm.messages.map((m) => m.daysAgo));
		const last = Math.min(...dm.messages.map((m) => m.daysAgo));
		threadRows.push([
			id(threadId),
			q(dm.kind),
			q(dm.title ?? null),
			id(persona(world, dm.createdBy).userId),
			ago(first + 0.01),
		]);
		for (const key of dm.participants) {
			const p = persona(world, key);
			const read = dm.readBy.includes(key);
			// An unread participant last read just before the newest message they did not send.
			const lastOwn = Math.min(
				...dm.messages.filter((m) => m.from === key).map((m) => m.daysAgo),
				Infinity,
			);
			const lastReadDaysAgo = read ? last : Math.min(lastOwn, last + 0.02);
			dmParticipantRows.push([
				id(uuidFor("dm_participant", `${dm.key}:${key}`)),
				id(threadId),
				id(p.userId),
				ago(Number.isFinite(lastReadDaysAgo) ? lastReadDaysAgo : first + 0.01),
				String(!!dm.starredBy?.includes(key)),
				ago(first + 0.01),
			]);
		}
		dm.messages.forEach((m, i) => {
			dmMessageRows.push([
				id(uuidFor("dm_message", `${dm.key}:${i}`)),
				id(threadId),
				id(persona(world, m.from).userId),
				q(m.body),
				ago(m.daysAgo),
			]);
		});
	}
	out.push(
		insert(
			"comms.dm_threads",
			["id", "kind", "title", "created_by_user_id", "created_at"],
			threadRows,
		),
	);
	out.push(
		insert(
			"comms.dm_participants",
			["id", "thread_id", "user_id", "last_read_at", "is_starred", "joined_at"],
			dmParticipantRows,
		),
	);
	out.push(
		insert(
			"comms.dm_messages",
			["id", "thread_id", "sender_user_id", "body", "created_at"],
			dmMessageRows,
		),
	);
	// #endregion

	// #region Notifications (category / urgency / channels from the catalog)
	const notificationValues = NOTIFICATIONS.map((n, i) => {
		const to = persona(world, n.to);
		const actor = n.actor ? persona(world, n.actor) : null;
		let contextType: string | null = null;
		let contextId: string | null = null;
		let actionUrl: string | null = n.actionUrl ?? null;
		if (n.context) {
			const [kind, key] = n.context;
			contextType = kind;
			switch (kind) {
				case "project": {
					const pr = project(world, key);
					contextId = pr.projectId;
					actionUrl ??= `/projects/${pr.slug}`;
					break;
				}
				case "conversation":
					contextId = uuidFor("dm_thread", key);
					actionUrl ??= `/messages/${contextId}`;
					break;
				case "team":
				case "business": {
					const e = entity(world, key);
					contextId = e.entityId;
					actionUrl ??= `/${kind === "team" ? "teams" : "businesses"}/${e.slug}`;
					break;
				}
			}
		}
		return `  (${id(uuidFor("notification", `${n.to}:${i}`))}, ${id(to.userId)}, ${q(n.type)}, ${
			q(n.title)
		}, ${q(n.body)}, ${id(actor?.userId)}, ${q(contextType)}, ${id(contextId)}, ${q(actionUrl)}, ${
			n.read ? ago(Math.max(0, n.daysAgo - 0.1)) : "NULL"
		}, ${n.read ? ago(Math.max(0, n.daysAgo - 0.1)) : "NULL"}, ${ago(n.daysAgo)})`;
	});
	out.push(
		"INSERT INTO comms.notifications (id, user_id, type, title, body, category, urgency, channels, actor_user_id, context_type, context_id, action_url, read_at, seen_at, created_at)",
		"SELECT v.id::uuid, v.user_id::uuid, nt.key, v.title, v.body, nt.category, nt.urgency, nt.default_channels,",
		"       v.actor_user_id::uuid, v.context_type, v.context_id::uuid, v.action_url, v.read_at, v.seen_at, v.created_at",
		"FROM (VALUES",
		notificationValues.join(",\n"),
		") AS v(id, user_id, type, title, body, actor_user_id, context_type, context_id, action_url, read_at, seen_at, created_at)",
		"JOIN comms.notification_types nt ON nt.key = v.type",
		"ON CONFLICT (id) DO NOTHING;\n",
	);
	// #endregion

	// #region Auto-responses (a seller's away message)
	out.push(
		insert(
			"comms.auto_responses",
			["id", "user_id", "enabled", "name", "trigger", "keyword", "message", "ai_assist"],
			[
				[
					id(uuidFor("auto_response", "saoirse:any")),
					id(persona(world, "saoirse").userId),
					"true",
					"'First reply'",
					"'any'",
					"NULL",
					"'Thanks for getting in touch — I reply to new messages within one working day. If it is about a portfolio review, the booking link on my profile is the fastest route.'",
					"false",
				],
				[
					id(uuidFor("auto_response", "ren:keyword")),
					id(persona(world, "ren").userId),
					"false",
					"'Launch film enquiries'",
					"'keyword'",
					"'launch film'",
					"'Launch films book out about six weeks ahead — send the product, the deadline and a reference or two and I will come back with dates.'",
					"false",
				],
			],
		),
	);
	// #endregion

	return out.join("\n");
}
