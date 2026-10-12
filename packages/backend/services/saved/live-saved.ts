import {
	COLLECTABLE_TYPES,
	type SavedCollection,
	type SavedEntityType,
	type SavedItem,
	type SavedState,
	type SavedToggle,
} from "@projective/types/org";
import type { ProfileKind } from "@projective/types/profile";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { fetchProfileView } from "../profile/live-profile.ts";
import { fetchFollowing, fetchProfileCards, profileKey } from "../profile/live-follows.ts";
import { fetchPartyCards } from "../profile/party-cards.ts";
import { ExploreBackendService } from "../explore/ExploreBackendService.ts";
import { assetAddress, classify, ITEM_COLUMNS, type ItemRow } from "../files/asset-row.ts";
import { setMessageFavourite } from "../messaging/live-message-marks.ts";
import { MessagingBackendService } from "../messaging/MessagingBackendService.ts";

/**
 * live-saved — the per-kind stores behind `SavedBackendService` (Decision #174). Each kind keeps its
 * save where it already lived; this module resolves a surface's `ref` to that store's key, writes it,
 * reads the caller's saved rows back and resolves them for display. Every query runs under the
 * caller's own JWT, so RLS decides what they may save and see.
 */

type Actor = ReadActor & { accessToken: string };

// #region Kinds

/** The listing kinds: a slugged row, a bookmark entity, and the Explore type its page routes by. */
const LISTINGS = {
	service: {
		schema: "marketplace",
		table: "service_blueprints",
		entity: "service_blueprint",
		explore: "services",
		label: "Service",
	},
	product: {
		schema: "catalogue",
		table: "products",
		entity: "product",
		explore: "products",
		label: "Product",
	},
	article: {
		schema: "catalogue",
		table: "articles",
		entity: "article",
		explore: "articles",
		label: "Article",
	},
} as const;
type ListingType = keyof typeof LISTINGS;

/** The bookmark entity types a person's profile can be. */
const PROFILE_ENTITIES = ["user", "team", "business", "organisation"] as const;

const PROFILE_LABEL: Record<ProfileKind, string> = {
	freelancer: "Freelancer",
	client: "Client",
	team: "Team",
	business: "Business",
	organisation: "Organisation",
};

function isListing(type: SavedEntityType): type is ListingType {
	return type in LISTINGS;
}

/** The SavedEntityType a bookmark row lists as. */
function typeOfEntity(entity: string): SavedEntityType {
	if (entity === "project_channel") return "project_channel";
	for (const [type, k] of Object.entries(LISTINGS)) {
		if (k.entity === entity) return type as ListingType;
	}
	return "profile";
}

function db(actor: Actor, schema: string) {
	return getUserClient(actor.accessToken).schema(schema);
}

/** Leading `@`s off, lower-cased — how a handle compares. */
function bareHandle(handle: string): string {
	return handle.replace(/^@+/, "").toLowerCase();
}

/** Collapse a message body to one short line. */
function snippet(body: string | null, max = 120): string {
	const line = (body ?? "").replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// #endregion

// #region Resolve

/** A bookmark's `(entity_type, entity_id)`, or `null` when the ref names nothing the caller can see. */
async function bookmarkTarget(
	actor: Actor,
	type: SavedEntityType,
	ref: string,
): Promise<{ entity: string; id: string } | null> {
	if (isListing(type)) {
		const k = LISTINGS[type];
		const { data, error } = await db(actor, k.schema).from(k.table).select("id").eq("slug", ref)
			.maybeSingle();
		if (error) throw new Error(`${k.schema}.${k.table} read failed: ${error.message}`);
		return data ? { entity: k.entity, id: (data as { id: string }).id } : null;
	}
	if (type === "profile") {
		const profile = await fetchProfileView(bareHandle(ref), actor);
		if (profile === undefined) throw new Error("org.get_profile_view unreachable");
		return profile?.owner ? { entity: profile.owner.type, id: profile.owner.id } : null;
	}
	if (!UUID_RE.test(ref)) return null;
	const { data, error } = await db(actor, "comms").from("project_channels").select("id").eq(
		"id",
		ref,
	).maybeSingle();
	if (error) throw new Error(`comms.project_channels read failed: ${error.message}`);
	return data ? { entity: "project_channel", id: ref } : null;
}

/** A project's id from its slug, as the caller can see it. */
async function projectIdOf(actor: Actor, slug: string): Promise<string | null> {
	const { data, error } = await db(actor, "projects").from("projects").select("id").eq("slug", slug)
		.maybeSingle();
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	return (data as { id: string } | null)?.id ?? null;
}

// #endregion

// #region Writes

const GONE = "That item isn't available any more.";

/**
 * Save or un-save a bookmark-, project- or message-backed thing. Conversations and files are written
 * by their own services; `SavedBackendService` dispatches those itself.
 */
export async function writeSaved(
	actor: Actor,
	input: SavedToggle,
): Promise<ServiceResult<SavedState>> {
	if (input.type === "project") {
		const projectId = await projectIdOf(actor, input.ref);
		if (!projectId) return fail(404, { message: GONE });
		const { error } = await db(actor, "projects").from("user_preferences").upsert(
			{ user_id: actor.userId, project_id: projectId, is_starred: input.saved },
			{ onConflict: "user_id,project_id" },
		);
		if (error) throw new Error(`projects.user_preferences write failed: ${error.message}`);
		return ok({ saved: input.saved, collectionId: null });
	}
	if (input.type === "message") {
		const outcome = await setMessageFavourite(actor, input.ref, input.saved);
		if (outcome === null) return fail(404, { message: "No such message." });
		if ("refusal" in outcome) {
			return fail(outcome.refusal.status, { message: outcome.refusal.message });
		}
		return ok({ saved: input.saved, collectionId: null });
	}

	const target = await bookmarkTarget(actor, input.type, input.ref);
	if (!target) return fail(404, { message: GONE });
	const bookmarks = db(actor, "org").from("user_bookmarks");
	if (!input.saved) {
		const { error } = await bookmarks.delete()
			.eq("user_id", actor.userId).eq("entity_type", target.entity).eq("entity_id", target.id);
		if (error) throw new Error(`org.user_bookmarks delete failed: ${error.message}`);
		return ok({ saved: false, collectionId: null });
	}
	const row: Record<string, unknown> = {
		user_id: actor.userId,
		entity_type: target.entity,
		entity_id: target.id,
	};
	if (input.collectionId !== undefined) row.collection_id = input.collectionId;
	const { data, error } = await bookmarks
		.upsert(row, { onConflict: "user_id,entity_type,entity_id" })
		.select("collection_id")
		.single();
	if (error) {
		if (error.code === "23503") return fail(404, { message: "No such collection." });
		throw new Error(`org.user_bookmarks write failed: ${error.message}`);
	}
	return ok({
		saved: true,
		collectionId: (data as { collection_id: string | null }).collection_id,
	});
}

// #endregion

// #region Saved rows

/** One saved thing before display resolution: its kind, store key and when it was saved. */
export interface SavedRow {
	type: SavedEntityType;
	/** The store key — an entity id, project id, thread id, message id or file id. */
	key: string;
	/** For a bookmark or follow: the entity type behind `key`. For a message: its table. */
	entity?: string;
	savedAt: string | null;
	collectionId: string | null;
	following: boolean;
	/** A file's row, read with the star so it needs no second query. */
	file?: ItemRow;
}

/** Most rows read per store. shortcut: a page is sliced in memory; move to SQL paging past this. */
const STORE_CAP = 200;

/**
 * Every saved row of the given kinds, unsorted. `collection` narrows to bookmarks in one collection
 * (or the unfiled), and then the kinds that cannot be filed contribute nothing.
 */
export async function readSavedRows(
	actor: Actor,
	types: readonly SavedEntityType[],
	collection: string | undefined,
): Promise<SavedRow[]> {
	const want = new Set(types);
	const filed = collection !== undefined;
	const reads: Promise<SavedRow[]>[] = [];

	const entities = [
		...(Object.keys(LISTINGS) as ListingType[]).filter((t) => want.has(t)).map((t) =>
			LISTINGS[t].entity
		),
		...(want.has("profile") ? PROFILE_ENTITIES : []),
		...(want.has("project_channel") ? ["project_channel"] : []),
	];
	if (entities.length > 0) {
		reads.push((async () => {
			let q = db(actor, "org").from("user_bookmarks")
				.select("entity_type, entity_id, collection_id, created_at")
				.eq("user_id", actor.userId)
				.in("entity_type", entities);
			if (collection === "unfiled") q = q.is("collection_id", null);
			else if (filed) q = q.eq("collection_id", collection);
			const { data, error } = await q.order("created_at", { ascending: false }).limit(STORE_CAP);
			if (error) throw new Error(`org.user_bookmarks read failed: ${error.message}`);
			return ((data ?? []) as {
				entity_type: string;
				entity_id: string;
				collection_id: string | null;
				created_at: string;
			}[])
				.map((r) => ({
					type: typeOfEntity(r.entity_type),
					key: r.entity_id,
					entity: r.entity_type,
					savedAt: r.created_at,
					collectionId: r.collection_id,
					following: false,
				}));
		})());
	}
	if (filed) return (await Promise.all(reads)).flat();

	if (want.has("profile")) {
		reads.push(
			fetchFollowing(getUserClient(actor.accessToken), actor.userId, STORE_CAP).then((edges) =>
				edges.map((e) => ({
					type: "profile" as const,
					key: e.id,
					entity: e.type,
					savedAt: e.at,
					collectionId: null,
					following: true,
				}))
			),
		);
	}
	if (want.has("project")) {
		reads.push((async () => {
			const { data, error } = await db(actor, "projects").from("user_preferences")
				.select("project_id").eq("user_id", actor.userId).eq("is_starred", true).limit(STORE_CAP);
			if (error) throw new Error(`projects.user_preferences read failed: ${error.message}`);
			return ((data ?? []) as { project_id: string }[]).map((r) => bare("project", r.project_id));
		})());
	}
	if (want.has("conversation")) {
		reads.push((async () => {
			const { data, error } = await db(actor, "comms").from("dm_participants")
				.select("thread_id").eq("user_id", actor.userId).eq("is_starred", true).is(
					"deleted_at",
					null,
				)
				.limit(STORE_CAP);
			if (error) throw new Error(`comms.dm_participants read failed: ${error.message}`);
			return ((data ?? []) as { thread_id: string }[]).map((r) =>
				bare("conversation", r.thread_id)
			);
		})());
	}
	if (want.has("message")) {
		reads.push((async () => {
			const { data, error } = await db(actor, "comms").from("message_favorites")
				.select("message_table, message_id, created_at").eq("user_id", actor.userId)
				.order("created_at", { ascending: false }).limit(STORE_CAP);
			if (error) throw new Error(`comms.message_favorites read failed: ${error.message}`);
			return ((data ?? []) as { message_table: string; message_id: string; created_at: string }[])
				.map((r) => ({
					...bare("message", r.message_id),
					entity: r.message_table,
					savedAt: r.created_at,
				}));
		})());
	}
	if (want.has("file")) {
		reads.push((async () => {
			const { data, error } = await db(actor, "files").from("items").select(ITEM_COLUMNS)
				.eq("owner_user_id", actor.userId).eq("starred", true).is("deleted_at", null).limit(
					STORE_CAP,
				);
			if (error) throw new Error(`files.items read failed: ${error.message}`);
			return ((data ?? []) as unknown as ItemRow[]).map((r) => ({
				...bare("file", r.id),
				file: r,
			}));
		})());
	}
	return (await Promise.all(reads)).flat();
}

/** A row from a store that keeps no saved-at instant and no collection. */
function bare(type: SavedEntityType, key: string): SavedRow {
	return { type, key, savedAt: null, collectionId: null, following: false };
}

/** Saved first, follows last; newest first within each; rows with no instant after those with one. */
export function sortSaved(rows: SavedRow[]): SavedRow[] {
	return [...rows].sort((a, b) =>
		Number(a.following) - Number(b.following) ||
		(b.savedAt ?? "").localeCompare(a.savedAt ?? "")
	);
}

// #endregion

// #region Display

/** Resolve rows for display, in order. A row whose thing is gone or hidden from the caller is dropped. */
export async function displaySaved(actor: Actor, rows: readonly SavedRow[]): Promise<SavedItem[]> {
	const of = (t: SavedEntityType) => rows.filter((r) => r.type === t);
	const resolved = new Map<
		SavedRow,
		Omit<SavedItem, "type" | "savedAt" | "collectionId" | "following">
	>();
	await Promise.all([
		...(Object.keys(LISTINGS) as ListingType[]).map((t) =>
			resolveListings(actor, t, of(t), resolved)
		),
		resolveProfiles(actor, of("profile"), resolved),
		resolveProjects(actor, of("project"), resolved),
		resolveChannels(actor, of("project_channel"), resolved),
		resolveConversations(actor, of("conversation"), resolved),
		resolveMessages(actor, of("message"), resolved),
	]);
	for (const row of of("file")) resolved.set(row, fileDisplay(row.file!));

	const items: SavedItem[] = [];
	for (const row of rows) {
		const shown = resolved.get(row);
		if (!shown) continue;
		items.push({
			...shown,
			type: row.type,
			savedAt: row.savedAt,
			collectionId: row.collectionId,
			following: row.following,
		});
	}
	return items;
}

type Resolved = Map<SavedRow, Omit<SavedItem, "type" | "savedAt" | "collectionId" | "following">>;

async function resolveListings(
	actor: Actor,
	type: ListingType,
	rows: SavedRow[],
	out: Resolved,
): Promise<void> {
	if (rows.length === 0) return;
	const k = LISTINGS[type];
	const { data, error } = await db(actor, k.schema).from(k.table).select("id, slug, title")
		.in("id", rows.map((r) => r.key));
	if (error) throw new Error(`${k.schema}.${k.table} read failed: ${error.message}`);
	const byId = new Map(
		((data ?? []) as { id: string; slug: string; title: string }[]).map((r) => [r.id, r]),
	);
	const catalog = await ExploreBackendService.items([...byId.values()].map((r) => r.slug));
	const items = new Map((catalog.ok ? catalog.data ?? [] : []).map((i) => [i.id, i]));
	for (const row of rows) {
		const hit = byId.get(row.key);
		if (!hit) continue;
		const item = items.get(hit.slug);
		out.set(row, {
			ref: hit.slug,
			title: item?.title ?? hit.title,
			meta: item ? `${k.label} · ${item.owner.name}` : k.label,
			thumbnail: item?.media ?? null,
			href: `/view/${encodeURIComponent(hit.slug)}?type=${k.explore}`,
		});
	}
}

async function resolveProfiles(actor: Actor, rows: SavedRow[], out: Resolved): Promise<void> {
	if (rows.length === 0) return;
	const cards = await fetchProfileCards(
		getUserClient(actor.accessToken),
		rows.map((r) => ({ type: r.entity!, id: r.key })),
	);
	for (const row of rows) {
		const card = cards.get(profileKey(row.entity!, row.key));
		if (!card) continue;
		out.set(row, {
			ref: card.handle,
			title: card.name,
			meta: PROFILE_LABEL[card.kind],
			thumbnail: card.avatar,
			href: `/@${card.handle}`,
		});
	}
}

async function resolveProjects(actor: Actor, rows: SavedRow[], out: Resolved): Promise<void> {
	if (rows.length === 0) return;
	const { data, error } = await db(actor, "projects").from("projects").select("id, slug, title")
		.in("id", rows.map((r) => r.key));
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	const byId = new Map(
		((data ?? []) as { id: string; slug: string; title: string }[]).map((r) => [r.id, r]),
	);
	for (const row of rows) {
		const p = byId.get(row.key);
		if (p) {
			out.set(row, {
				ref: p.slug,
				title: p.title,
				meta: "Project",
				thumbnail: null,
				href: `/projects/${p.slug}`,
			});
		}
	}
}

/** Where each room lives: its project's slug + title and the room's route segment. */
async function roomPlaces(
	actor: Actor,
	channelIds: string[],
): Promise<
	Map<string, { name: string; project: { slug: string; title: string }; segment: string }>
> {
	const out = new Map<
		string,
		{ name: string; project: { slug: string; title: string }; segment: string }
	>();
	if (channelIds.length === 0) return out;
	const { data, error } = await db(actor, "comms").from("project_channels").select(
		"id, name, project_id, stage_id",
	)
		.in("id", channelIds);
	if (error) throw new Error(`comms.project_channels read failed: ${error.message}`);
	const rooms = (data ?? []) as {
		id: string;
		name: string;
		project_id: string;
		stage_id: string | null;
	}[];
	const [projects, stages] = await Promise.all([
		db(actor, "projects").from("projects").select("id, slug, title").in("id", [
			...new Set(rooms.map((r) => r.project_id)),
		]),
		db(actor, "projects").from("project_stages").select("id, slug")
			.in("id", rooms.map((r) => r.stage_id).filter((x): x is string => !!x)),
	]);
	if (projects.error) throw new Error(`projects.projects read failed: ${projects.error.message}`);
	const projectById = new Map(
		((projects.data ?? []) as { id: string; slug: string; title: string }[]).map((p) => [p.id, p]),
	);
	const stageSlug = new Map(
		((stages.data ?? []) as { id: string; slug: string }[]).map((s) => [s.id, s.slug]),
	);
	for (const room of rooms) {
		const project = projectById.get(room.project_id);
		if (!project) continue;
		// A stage room routes by its stage's slug; the project-wide room is the Discussion (Decision #88).
		const segment = room.stage_id ? stageSlug.get(room.stage_id) : "discussion";
		if (segment) out.set(room.id, { name: room.name, project, segment });
	}
	return out;
}

async function resolveChannels(actor: Actor, rows: SavedRow[], out: Resolved): Promise<void> {
	const places = await roomPlaces(actor, rows.map((r) => r.key));
	for (const row of rows) {
		const place = places.get(row.key);
		if (!place) continue;
		out.set(row, {
			ref: row.key,
			title: place.name,
			meta: `Channel · ${place.project.title}`,
			thumbnail: null,
			href: `/projects/${place.project.slug}/${place.segment}`,
		});
	}
}

async function resolveConversations(actor: Actor, rows: SavedRow[], out: Resolved): Promise<void> {
	if (rows.length === 0) return;
	const res = await MessagingBackendService.conversations({ view: "starred", limit: 100 }, actor);
	const byId = new Map((res.ok ? res.data?.page.conversations ?? [] : []).map((c) => [c.id, c]));
	for (const row of rows) {
		const c = byId.get(row.key);
		if (!c) continue;
		out.set(row, {
			ref: c.id,
			title: c.title,
			meta: c.lastActivityLabel ? `Conversation · ${c.lastActivityLabel}` : "Conversation",
			thumbnail: c.avatar,
			href: `/messages/${encodeURIComponent(c.id)}`,
		});
	}
}

async function resolveMessages(actor: Actor, rows: SavedRow[], out: Resolved): Promise<void> {
	if (rows.length === 0) return;
	const ids = (table: string) => rows.filter((r) => r.entity === table).map((r) => r.key);
	const dmIds = ids("comms.dm_messages");
	const roomIds = ids("comms.project_messages");
	const [dm, room] = await Promise.all([
		dmIds.length
			? db(actor, "comms").from("dm_messages").select("id, thread_id, sender_user_id, body")
				.in("id", dmIds).is("deleted_at", null)
			: Promise.resolve({ data: [], error: null }),
		roomIds.length
			? db(actor, "comms").from("project_messages").select("id, channel_id, sender_user_id, body")
				.in("id", roomIds).is("deleted_at", null)
			: Promise.resolve({ data: [], error: null }),
	]);
	if (dm.error) throw new Error(`comms.dm_messages read failed: ${dm.error.message}`);
	if (room.error) throw new Error(`comms.project_messages read failed: ${room.error.message}`);
	type Msg = {
		id: string;
		thread_id?: string;
		channel_id?: string;
		sender_user_id: string;
		body: string | null;
	};
	const messages = [...(dm.data ?? []), ...(room.data ?? [])] as Msg[];
	const [senders, places] = await Promise.all([
		fetchPartyCards(getUserClient(actor.accessToken), messages.map((m) => m.sender_user_id)),
		roomPlaces(actor, [
			...new Set(messages.map((m) => m.channel_id).filter((x): x is string => !!x)),
		]),
	]);
	const byId = new Map(messages.map((m) => [m.id, m]));
	for (const row of rows) {
		const m = byId.get(row.key);
		if (!m) continue;
		const sender = senders.get(m.sender_user_id)?.name ?? "Unknown";
		const anchor = `?m=${encodeURIComponent(m.id)}`;
		const place = m.channel_id ? places.get(m.channel_id) : undefined;
		if (m.channel_id && !place) continue;
		out.set(row, {
			ref: m.id,
			title: snippet(m.body) || "Attachment",
			meta: place ? `Message · ${sender} · ${place.project.title}` : `Message · ${sender}`,
			thumbnail: null,
			href: place
				? `/projects/${place.project.slug}/${place.segment}/chat${anchor}`
				: `/messages/${encodeURIComponent(m.thread_id!)}${anchor}`,
		});
	}
}

function fileDisplay(
	row: ItemRow,
): Omit<SavedItem, "type" | "savedAt" | "collectionId" | "following"> {
	const name = row.display_name || row.original_name || "Untitled file";
	const { kind } = classify(row, name);
	// The name's own extension when it has one; a seeded or renamed file may not, so fall back to its kind.
	const ext = /.([a-z0-9]{1,8})$/i.exec(name)?.[1];
	return {
		ref: row.id,
		title: name,
		meta: `File · ${ext ? ext.toUpperCase() : kind}`,
		thumbnail: assetAddress(row, kind).thumbnailUrl,
		href: `/inspect/${row.id}`,
	};
}

// #endregion

// #region State lookup

/** The kinds `GET /api/saved/state` answers — the surfaces whose own read carries no saved flag. */
export const LOOKUP_TYPES: readonly SavedEntityType[] = [
	"service",
	"product",
	"article",
	"profile",
	"project",
];

/** Which of `refs` (per kind) the caller has saved; returns the saved `type:ref` keys as asked. */
export async function lookupSaved(
	actor: Actor,
	refs: ReadonlyMap<SavedEntityType, readonly string[]>,
): Promise<string[]> {
	const types = [...refs.keys()].filter((t) => LOOKUP_TYPES.includes(t));
	const rows = await readSavedRows(actor, types, undefined);
	const saved = new Set<string>();
	const keysOf = (t: SavedEntityType) =>
		rows.filter((r) => r.type === t && !r.following).map((r) => r.key);

	await Promise.all(types.map(async (t) => {
		const keys = keysOf(t);
		if (keys.length === 0) return;
		if (t === "profile") {
			const cards = await fetchProfileCards(
				getUserClient(actor.accessToken),
				rows.filter((r) => r.type === "profile" && !r.following).map((r) => ({
					type: r.entity!,
					id: r.key,
				})),
			);
			for (const card of cards.values()) saved.add(`profile:${bareHandle(card.handle)}`);
			return;
		}
		const k = t === "project"
			? { schema: "projects", table: "projects" }
			: LISTINGS[t as ListingType];
		const { data, error } = await db(actor, k.schema).from(k.table).select("slug").in("id", keys);
		if (error) throw new Error(`${k.schema}.${k.table} read failed: ${error.message}`);
		for (const r of (data ?? []) as { slug: string }[]) saved.add(`${t}:${r.slug}`);
	}));

	const out: string[] = [];
	for (const [t, list] of refs) {
		for (const ref of list) {
			if (saved.has(`${t}:${t === "profile" ? bareHandle(ref) : ref}`)) out.push(`${t}:${ref}`);
		}
	}
	return out;
}

// #endregion

// #region Collections

/** The caller's collections, oldest first. */
export async function readCollections(actor: Actor): Promise<SavedCollection[]> {
	const { data, error } = await db(actor, "org").from("user_bookmark_collections").select(
		"id, name",
	)
		.eq("user_id", actor.userId).order("created_at", { ascending: true }).limit(STORE_CAP);
	if (error) throw new Error(`org.user_bookmark_collections read failed: ${error.message}`);
	return (data ?? []) as SavedCollection[];
}

/** Create a collection. A name the caller already uses is a 409. */
export async function insertCollection(
	actor: Actor,
	name: string,
): Promise<ServiceResult<SavedCollection>> {
	const { data, error } = await db(actor, "org").from("user_bookmark_collections")
		.insert({ user_id: actor.userId, name }).select("id, name").single();
	if (error) {
		if (error.code === "23505") {
			return fail(409, {
				message: `You already have a collection called "${name}".`,
				errors: { name: "taken" },
			});
		}
		throw new Error(`org.user_bookmark_collections insert failed: ${error.message}`);
	}
	return ok(data as SavedCollection, { status: 201, message: "Collection created." });
}

/** Delete a collection; its bookmarks become unfiled (the FK sets them NULL), never deleted. */
export async function removeCollection(
	actor: Actor,
	id: string,
): Promise<ServiceResult<{ id: string }>> {
	if (!UUID_RE.test(id)) return fail(404, { message: "No such collection." });
	const { data, error } = await db(actor, "org").from("user_bookmark_collections").delete()
		.eq("id", id).eq("user_id", actor.userId).select("id");
	if (error) throw new Error(`org.user_bookmark_collections delete failed: ${error.message}`);
	if ((data ?? []).length === 0) return fail(404, { message: "No such collection." });
	return ok({ id }, { message: "Collection deleted. Its items are still saved." });
}

/** Whether a kind is a bookmark and so can be filed. */
export function isCollectable(type: SavedEntityType): boolean {
	return COLLECTABLE_TYPES.includes(type);
}

// #endregion
