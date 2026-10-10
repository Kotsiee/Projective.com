import { assert, assertEquals, assertRejects } from "@std/assert";
import { FileListPageSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { fetchFilePage } from "./live-files.ts";

/**
 * live-files_test — the project Files tab (every attachment posted to the project's channels) against
 * a fake PostgREST.
 *
 * Contract (module docblock): `null` when the project slug resolves to nothing for this viewer; a
 * THROWN error naming the table when any link of the channel → message → attachment → item chain
 * fails (each is load-bearing: a missing link would silently drop files); and degradation for the
 * enrichments (parties, folder trails, download marks). Owner-only facets (manage, share slug) are
 * resolved per viewer, so they are asserted for both an owner and a non-owner.
 *
 * The fake sits at `globalThis.fetch`, so the real supabase-js builder parses every answer.
 */

// #region Fake PostgREST
/** A PostgREST error body, exactly as the server serialises one. */
interface PgErrorBody {
	code: string;
	message: string;
	details: string | null;
	hint: string | null;
}

const FAIL = Symbol("pg-fail");

/** A route answer that makes PostgREST respond with an error envelope. */
interface PgFailure {
	[FAIL]: true;
	status: number;
	body: PgErrorBody;
}

/** One request the module issued, decoded. */
interface FakeRequest {
	method: string;
	schema: string;
	name: string;
	rpc: boolean;
	query: URLSearchParams;
	body: unknown;
}

/** A static answer, or a function of the request. Keys are `schema.table` / `schema.rpc.fn`. */
type Route = unknown | ((req: FakeRequest) => unknown);

/** Build an error answer — `42501` insufficient privilege, `P0001` raise, `23505`, `PGRST116`… */
function pgFail(
	code: string,
	message: string,
	status = 400,
	details: string | null = null,
): PgFailure {
	return { [FAIL]: true, status, body: { code, message, details, hint: null } };
}

function isFailure(value: unknown): value is PgFailure {
	return typeof value === "object" && value !== null && FAIL in value;
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Run `body` with `fetch` answering every Supabase REST call from `routes`. An unrouted table reads
 * as `[]` and an unrouted RPC as `null`, which is what an empty, RLS-filtered database answers.
 */
async function withPostgrest<T>(
	routes: Record<string, Route>,
	body: (calls: FakeRequest[]) => Promise<T>,
): Promise<T> {
	const calls: FakeRequest[] = [];
	const realFetch = globalThis.fetch;
	const savedEnv = ENV_KEYS.map((key) => [key, Deno.env.get(key)] as const);
	Deno.env.set("SUPABASE_URL", "http://postgrest.fake");
	Deno.env.set("SUPABASE_ANON_KEY", "XXXX-XXXX");
	Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "XXXX-XXXX");

	const json = (payload: unknown, status: number, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json", ...headers },
		});

	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const path = url.pathname.replace(/^\/rest\/v1\//, "");
		const rpc = path.startsWith("rpc/");
		const name = rpc ? path.slice(4) : path;
		const schema = request.headers.get("accept-profile") ??
			request.headers.get("content-profile") ?? "public";
		const text = await request.text();
		const req: FakeRequest = {
			method: request.method,
			schema,
			name,
			rpc,
			query: url.searchParams,
			body: text ? JSON.parse(text) : null,
		};
		calls.push(req);

		const key = `${schema}.${rpc ? "rpc." : ""}${name}`;
		const route = key in routes ? routes[key] : (rpc ? null : []);
		const answer = typeof route === "function"
			? (route as (r: FakeRequest) => unknown)(req)
			: route;
		if (isFailure(answer)) return json(answer.body, answer.status);

		if ((request.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
			const rows = Array.isArray(answer) ? answer : [answer];
			if (rows.length !== 1) {
				return json({
					code: "PGRST116",
					message: "JSON object requested, multiple (or no) rows returned",
					details: `The result contains ${rows.length} rows`,
					hint: null,
				}, 406);
			}
			return json(rows[0], 200);
		}
		const count = Array.isArray(answer) ? answer.length : 1;
		const range = count === 0 ? "*/0" : `0-${count - 1}/${count}`;
		if (request.method === "HEAD") {
			return new Response(null, { status: 200, headers: { "content-range": range } });
		}
		return json(answer, 200, { "content-range": range });
	};

	try {
		return await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of savedEnv) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

// #endregion

// #region Fixtures
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const FREELANCER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_UUID = "33333333-3333-4333-8333-333333333333";
const C_GENERAL = "44444444-4444-4444-8444-444444444441";
const C_STAGE = "44444444-4444-4444-8444-444444444442";
const C_FOREIGN = "44444444-4444-4444-8444-444444444449";
const STAGE_ID = "55555555-5555-4555-8555-555555555555";
const SLUG = "prj-fi2esrd222";

function actorOf(userId: string): ReadActor & { accessToken: string } {
	return { userId, contextId: "", contextType: "personal", accessToken: "XXXX-XXXX" };
}

const OWNER = actorOf(OWNER_ID);

const CHANNELS = [
	{
		id: C_GENERAL,
		name: "Discussion",
		stage_id: null,
		visibility: "project_all",
		created_at: "2026-09-01T00:00:00Z",
	},
	{
		id: C_STAGE,
		name: "Discovery",
		stage_id: STAGE_ID,
		visibility: "stage_all",
		created_at: "2026-09-02T00:00:00Z",
	},
];

const MESSAGES = [
	{
		id: "m-2",
		channel_id: C_STAGE,
		sender_user_id: OWNER_ID,
		body: "Reference link",
		is_audio: false,
		created_at: "2026-10-04T15:30:00.000Z",
	},
	{
		id: "m-1",
		channel_id: C_GENERAL,
		sender_user_id: FREELANCER_ID,
		body: "Brief attached",
		is_audio: true,
		created_at: "2026-10-02T09:00:00.000Z",
	},
	// A message in a channel outside this project's list can never surface a file.
	{
		id: "m-x",
		channel_id: C_FOREIGN,
		sender_user_id: OWNER_ID,
		body: "",
		is_audio: false,
		created_at: "2026-10-03T00:00:00.000Z",
	},
];

const ATTACHMENTS = [
	{ id: "a-2", message_id: "m-2", attachment_id: "i-link", created_at: "2026-10-04T15:30:00Z" },
	{ id: "a-1", message_id: "m-1", attachment_id: "i-brief", created_at: "2026-10-02T09:00:00Z" },
	{ id: "a-x", message_id: "m-x", attachment_id: "i-brief", created_at: "2026-10-03T00:00:00Z" },
	// RLS withheld this item: the attachment row exists, the file does not surface.
	{
		id: "a-hidden",
		message_id: "m-1",
		attachment_id: "i-hidden",
		created_at: "2026-10-02T09:00:00Z",
	},
];

function item(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		display_name: null,
		original_name: null,
		mime_type: null,
		size_bytes: null,
		category: null,
		status: null,
		source: "supabase",
		visibility: "private",
		owner_type: "user",
		owner_user_id: OWNER_ID,
		owner_entity_id: null,
		folder_id: null,
		starred: null,
		content_hash: null,
		hash_sampled: null,
		share_slug: null,
		download_count: null,
		link_url: null,
		link_domain: null,
		link_title: null,
		link_description: null,
		link_favicon_url: null,
		link_scan_status: null,
		link_scanned_at: null,
		...over,
	};
}

const ITEMS = [
	item("i-brief", {
		display_name: " Brief.pdf ",
		mime_type: "application/pdf",
		size_bytes: "2048",
		share_slug: "shr-brief",
		download_count: 4,
		folder_id: "f-1",
		starred: true,
		status: "uploaded",
	}),
	item("i-link", {
		original_name: "Moodboard",
		source: "link",
		visibility: "public",
		owner_user_id: FREELANCER_ID,
		link_url: " https://example.org/board ",
		link_domain: "example.org",
		link_title: "Moodboard",
		link_scan_status: "safe",
	}),
];

/** The full happy-path database for {@link SLUG}. */
function fileRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return {
		"projects.projects": [{ id: PROJECT_UUID, slug: SLUG }],
		"comms.project_channels": CHANNELS,
		"comms.project_messages": MESSAGES,
		"comms.message_attachments": ATTACHMENTS,
		"files.items": ITEMS,
		"files.folders": [{ id: "f-1", name: "Specs", path: ["Root"] }],
		"files.download_events": [{ item_id: "i-brief" }],
		"org.rpc.get_party_cards": [
			{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
			{ user_id: FREELANCER_ID, username: "fern", first_name: "Fern", last_name: null },
		],
		...over,
	};
}
// #endregion

// #region Happy path
Deno.test("fetchFilePage maps the attachment chain onto a schema-valid FileListPage", async () => {
	await withPostgrest(fileRoutes(), async () => {
		const page = await fetchFilePage(OWNER, { projectId: SLUG });
		assert(page);
		FileListPageSchema.parse(page);
		assertEquals(page.scope, "project");
		assertEquals(page.channelId, null);
		assertEquals(page.viewerId, OWNER_ID);
		// Newest first by default; the foreign-channel and RLS-withheld attachments never surface.
		assertEquals(page.items.map((f) => f.id), ["a-2", "a-1"]);
		assertEquals(page.total, 2);
		assertEquals(page.hasMore, false);
		assertEquals(page.channels.map((c) => [c.id, c.kind, c.count]), [
			[C_GENERAL, "general", 1],
			[C_STAGE, "stage", 1],
		]);
	});
});

Deno.test("fetchFilePage file facts: classification, size, folder trail, message context, link card", async () => {
	await withPostgrest(fileRoutes(), async () => {
		const page = await fetchFilePage(OWNER, { projectId: SLUG });
		assert(page);
		const brief = page.items.find((f) => f.id === "a-1")!;
		assertEquals([brief.name, brief.ext, brief.kind, brief.category], [
			"Brief.pdf",
			"pdf",
			"doc",
			"Document",
		]);
		assertEquals([brief.sizeBytes, brief.sizeLabel], [2048, "2.0 KB"]);
		assertEquals(brief.folderPath, ["Root", "Specs"]);
		assertEquals(brief.starred, true);
		assertEquals([brief.channelName, brief.channelKind, brief.messageId], [
			"Discussion",
			"general",
			"m-1",
		]);
		assertEquals(brief.messageText, "Brief attached");
		assertEquals(brief.messageAudioUrl, "#");
		assertEquals(brief.sender.name, "Fern");
		assertEquals(brief.downloadCount, 4);
		assertEquals(brief.downloadedByViewer, true);
		// A private item posted into a channel reads as link-visible to the room.
		assertEquals(brief.visibility, "link");
		// A stored, settled file streams through the proxy; a non-uuid key is no `files.items` id.
		assertEquals([brief.url, brief.thumbnailUrl, brief.assetId], [
			"/api/media/proxy/i-brief",
			null,
			null,
		]);

		const link = page.items.find((f) => f.id === "a-2")!;
		assertEquals([link.kind, link.ext, link.source], ["link", "", "link"]);
		assertEquals(link.link?.url, "https://example.org/board");
		assertEquals([link.url, link.thumbnailUrl], ["https://example.org/board", null]);
		assertEquals(link.link?.scanStatus, "safe");
		assertEquals(link.visibility, "public");
		assertEquals(link.channelKind, "stage");
	});
});
// #endregion

// #region Authorization-relevant facets and scope
Deno.test("only the item's owner may manage it or see its share slug", async () => {
	await withPostgrest(fileRoutes(), async () => {
		const owner = await fetchFilePage(OWNER, { projectId: SLUG });
		const asOwner = owner!.items.find((f) => f.id === "a-1")!;
		assertEquals([asOwner.canManage, asOwner.shareSlug], [true, "shr-brief"]);
		const notMine = owner!.items.find((f) => f.id === "a-2")!;
		assertEquals([notMine.canManage, notMine.shareSlug], [false, null]);

		const other = await fetchFilePage(actorOf(FREELANCER_ID), { projectId: SLUG });
		const asOther = other!.items.find((f) => f.id === "a-1")!;
		assertEquals([asOther.canManage, asOther.shareSlug], [false, null]);
	});
});

Deno.test("a channel-scoped read lists only that channel; a channel of another project yields an empty page", async () => {
	await withPostgrest(fileRoutes(), async (calls) => {
		const page = await fetchFilePage(OWNER, { projectId: SLUG, channelId: C_STAGE });
		assert(page);
		assertEquals(page.scope, "channel");
		assertEquals(page.channelId, C_STAGE);
		assertEquals(page.items.map((f) => f.id), ["a-2"]);
		assertEquals(page.channels.map((c) => c.id), [C_STAGE]);

		const before = calls.length;
		const foreign = await fetchFilePage(OWNER, { projectId: SLUG, channelId: C_FOREIGN });
		assert(foreign);
		assertEquals(foreign.items, []);
		assertEquals(foreign.channels, []);
		assertEquals(
			calls.slice(before).some((c) => c.name === "project_messages"),
			false,
			"no history is read for a channel outside the project",
		);
	});
});

Deno.test("fetchFilePage answers null for a slug that resolves to nothing", async () => {
	await withPostgrest(fileRoutes({ "projects.projects": [] }), async (calls) => {
		assertEquals(await fetchFilePage(OWNER, { projectId: SLUG }), null);
		assertEquals(calls.length, 1);
	});
});
// #endregion

// #region Filters, sort, paging
Deno.test("fetchFilePage filters by kind and name, sorts, and pages with a cursor", async () => {
	await withPostgrest(fileRoutes(), async () => {
		const links = await fetchFilePage(OWNER, { projectId: SLUG, kinds: ["link"] });
		assertEquals(links?.items.map((f) => f.id), ["a-2"]);
		assertEquals(links?.total, 1);

		const named = await fetchFilePage(OWNER, { projectId: SLUG, query: "  BRIEF " });
		assertEquals(named?.items.map((f) => f.id), ["a-1"]);

		const byName = await fetchFilePage(OWNER, { projectId: SLUG, sort: "name" });
		assertEquals(byName?.items.map((f) => f.name), ["Brief.pdf", "Moodboard"]);

		const first = await fetchFilePage(OWNER, { projectId: SLUG, limit: 1 });
		assertEquals([first?.items.map((f) => f.id), first?.hasMore, first?.nextCursor], [
			["a-2"],
			true,
			"a-2",
		]);
		const second = await fetchFilePage(OWNER, { projectId: SLUG, limit: 1, cursor: "a-2" });
		assertEquals([second?.items.map((f) => f.id), second?.hasMore, second?.nextCursor], [
			["a-1"],
			false,
			null,
		]);
	});
});

Deno.test("an engagement with no messages short-circuits to an empty page", async () => {
	await withPostgrest(fileRoutes({ "comms.project_messages": [] }), async (calls) => {
		const page = await fetchFilePage(OWNER, { projectId: SLUG });
		assert(page);
		FileListPageSchema.parse(page);
		assertEquals([page.items, page.total], [[], 0]);
		assertEquals(calls.some((c) => c.name === "message_attachments"), false);
	});
});
// #endregion

// #region Degradation and failures
Deno.test("failed enrichments (parties, folders, downloads) degrade instead of throwing", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	await withPostgrest(
		fileRoutes({
			"files.folders": denied,
			"files.download_events": denied,
			"org.rpc.get_party_cards": denied,
			"org.users_public": denied,
		}),
		async () => {
			const page = await fetchFilePage(OWNER, { projectId: SLUG });
			assert(page);
			FileListPageSchema.parse(page);
			const brief = page.items.find((f) => f.id === "a-1")!;
			assertEquals(brief.folderPath, []);
			assertEquals(brief.downloadedByViewer, false);
			assertEquals(brief.sender.name, "Unknown");
		},
	);
});

for (
	const [route, table, code] of [
		["projects.projects", "projects.projects slug read failed", "PGRST301"],
		["comms.project_channels", "comms.project_channels read failed", "42501"],
		["comms.project_messages", "comms.project_messages read failed", "42501"],
		["comms.message_attachments", "comms.message_attachments read failed", "57014"],
		["files.items", "files.items read failed", "42501"],
	] as const
) {
	Deno.test(`fetchFilePage THROWS when ${route} fails (${code})`, async () => {
		await withPostgrest(fileRoutes({ [route]: pgFail(code, "denied", 403) }), async () => {
			await assertRejects(
				() => fetchFilePage(OWNER, { projectId: SLUG }),
				Error,
				`${table}: denied`,
			);
		});
	});
}
// #endregion
