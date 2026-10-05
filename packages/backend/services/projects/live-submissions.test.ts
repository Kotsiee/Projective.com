import { assert, assertEquals, assertRejects } from "@std/assert";
import { SubmissionListPageSchema } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { fetchSubmissionPage } from "./live-submissions.ts";

/**
 * live-submissions_test — the submissions explorer read against a fake PostgREST.
 *
 * Contract (module docblock): `null` when the project does not resolve for this viewer; a THROWN
 * error naming the table when the project, stage, submission, pivot or item read fails; degradation
 * for the enrichments (channels, tickets, assignments, reviewer membership, parties).
 *
 * The property that matters most is ISOLATION: a viewer who is not a reviewer must have the
 * submissions QUERY narrowed to their own rows — a peer's submission is never fetched, so no later
 * step can leak it. That is asserted on the request the module sends, not only on the result.
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
const FERN_ID = "22222222-2222-4222-8222-222222222222";
const GUS_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ID = "44444444-4444-4444-8444-444444444444";
const BUSINESS_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_UUID = "66666666-6666-4666-8666-666666666666";
const S1 = "77777777-7777-4777-8777-777777777771";
const S2 = "77777777-7777-4777-8777-777777777772";
const TICKET_ID = "88888888-8888-4888-8888-888888888888";
const SLUG = "prj-subm2ss2on";
const S1_SLUG = "stg-dscvery222";

function actorOf(userId: string): ReadActor & { accessToken: string } {
	return { userId, contextId: "", contextType: "personal", accessToken: "XXXX-XXXX" };
}

const OWNER = actorOf(OWNER_ID);
const FERN = actorOf(FERN_ID);

const PROJECT_ROW = {
	id: PROJECT_UUID,
	slug: SLUG,
	title: "Brand refresh",
	format: "pipeline",
	structure_variation: "standard",
	owner_user_id: OWNER_ID,
	client_business_id: BUSINESS_ID,
};

const STAGES = [
	{
		id: S1,
		slug: S1_SLUG,
		name: "Discovery",
		status: "submitted",
		sort_order: 0,
		description_text: "Research and mood",
	},
	{
		id: S2,
		slug: "stg-de2very222",
		name: "Delivery",
		status: "open",
		sort_order: 1,
		description_text: null,
	},
];

function submission(id: string, over: Record<string, unknown>) {
	return {
		id,
		project_stage_id: S1,
		ticket_id: null,
		submitted_by: FERN_ID,
		title: null,
		status: "pending_review",
		notes: null,
		created_at: "2026-10-01T00:00:00.000Z",
		updated_at: null,
		reviewed_by: null,
		reviewed_at: null,
		feedback: null,
		...over,
	};
}

const SUBMISSIONS = [
	submission("sub-1", {
		title: "First cut",
		status: "revisions_requested",
		notes: "Two directions",
		feedback: { global: "  Tighten the kerning  " },
		reviewed_by: OWNER_ID,
		reviewed_at: "2026-10-03T10:00:00.000Z",
		created_at: "2026-10-02T00:00:00.000Z",
	}),
	submission("sub-2", {
		submitted_by: GUS_ID,
		ticket_id: TICKET_ID,
		created_at: "2026-10-04T00:00:00.000Z",
	}),
	submission("sub-3", {
		project_stage_id: S2,
		status: null,
		created_at: "2026-10-01T00:00:00.000Z",
	}),
];

function file(id: string, over: Record<string, unknown>) {
	return {
		id,
		owner_user_id: FERN_ID,
		folder_id: null,
		display_name: null,
		original_name: null,
		size_bytes: null,
		category: null,
		status: null,
		starred: null,
		source: null,
		visibility: null,
		owner_type: null,
		owner_entity_id: null,
		content_hash: null,
		hash_sampled: null,
		link_url: null,
		link_domain: null,
		link_title: null,
		link_description: null,
		link_favicon_url: null,
		link_scan_status: null,
		link_scanned_at: null,
		share_slug: null,
		download_count: null,
		created_at: "2026-10-02T00:00:00.000Z",
		deleted_at: null,
		...over,
	};
}

const FILES = [
	file("i-cut", {
		display_name: "cut.png",
		category: "Image",
		size_bytes: "1024",
		starred: true,
		folder_id: "f-private-library",
		visibility: "private",
	}),
	file("i-link", {
		owner_user_id: GUS_ID,
		original_name: "Reference",
		source: "link",
		link_url: "https://ex.org/board",
		created_at: "2026-10-04T00:00:00.000Z",
	}),
];

/** The full happy-path database for {@link SLUG}. */
function subRoutes(over: Record<string, Route> = {}): Record<string, Route> {
	return {
		"projects.projects": [PROJECT_ROW],
		"projects.project_stages": STAGES,
		"projects.stage_submissions": (req: FakeRequest) => {
			// Honour the isolation filter, as PostgREST would.
			const only = req.query.get("submitted_by");
			return only ? SUBMISSIONS.filter((s) => `eq.${s.submitted_by}` === only) : SUBMISSIONS;
		},
		"projects.submission_files": [
			{ submission_id: "sub-1", file_id: "i-cut" },
			{ submission_id: "sub-2", file_id: "i-link" },
			// Deleted or withheld: the pivot row exists, the item does not come back.
			{ submission_id: "sub-3", file_id: "i-gone" },
		],
		"files.items": FILES,
		"projects.tickets": [{ id: TICKET_ID, title: "Logo", text_description: "The primary mark" }],
		"comms.project_channels": [{ id: "c-s1", name: "Discovery room", stage_id: S1 }],
		"projects.stage_assignments": [
			{ project_stage_id: S1, freelancer_profile_id: FERN_ID, team_id: null, status: "accepted" },
			{ project_stage_id: S1, freelancer_profile_id: GUS_ID, team_id: null, status: "assigned" },
			{ project_stage_id: S2, freelancer_profile_id: FERN_ID, team_id: null, status: "accepted" },
			{ project_stage_id: S2, freelancer_profile_id: GUS_ID, team_id: null, status: "cancelled" },
		],
		"org.business_members": [],
		"org.rpc.get_party_cards": [
			{ user_id: OWNER_ID, username: "olive", first_name: "Olive", last_name: "Owner" },
			{ user_id: FERN_ID, username: "fern", first_name: "Fern", last_name: null },
			{ user_id: GUS_ID, username: "gus", first_name: "Gus", last_name: null },
		],
		...over,
	};
}

/** The submissions request the module issued (there is exactly one per read). */
function submissionsRead(calls: FakeRequest[]): FakeRequest {
	const found = calls.find((c) => c.name === "stage_submissions");
	assert(found, "the submissions table was read");
	return found;
}
// #endregion

// #region Happy path (reviewer, project scope)
Deno.test("fetchSubmissionPage maps the owner's project-scope read onto a schema-valid page", async () => {
	await withPostgrest(subRoutes(), async (calls) => {
		const page = await fetchSubmissionPage(OWNER, { projectId: SLUG });
		assert(page);
		SubmissionListPageSchema.parse(page);
		assertEquals(page.scope, "project");
		assertEquals(page.projectTitle, "Brand refresh");
		assertEquals(page.stageId, null);
		assertEquals(page.viewerIsClient, true);
		assertEquals(page.singleFreelancer, false);
		assertEquals(page.items.map((f) => f.id), ["i-link", "i-cut"], "newest file first");
		assertEquals(page.total, 2);
		assertEquals(
			submissionsRead(calls).query.get("submitted_by"),
			null,
			"a reviewer reads every row",
		);
	});
});

Deno.test("fetchSubmissionPage tree: stages as roots, submitter level only where a stage has several", async () => {
	await withPostgrest(subRoutes(), async () => {
		const page = await fetchSubmissionPage(OWNER, { projectId: SLUG });
		assert(page);
		assertEquals(page.tree.map((n) => [n.segment, n.kind, n.label, n.sublabel, n.fileCount]), [
			[S1, "stage", "Discovery", "active", 2],
			[S2, "stage", "Delivery", "draft", 0],
		]);
		// S1 has two submitters → a submitter level, newest submitter first.
		assertEquals(page.tree[0].children.map((n) => [n.segment, n.kind, n.label]), [
			[GUS_ID, "submitter", "Gus"],
			[FERN_ID, "submitter", "Fern"],
		]);
		// S2: one submitter and one ACTIVE provider (the cancelled seat does not count) → collapsed.
		const [unit] = page.tree[1].children;
		assertEquals([unit.kind, unit.status, unit.sublabel], ["unit", "draft", "Delivery"]);
		assert(unit.label.startsWith("Submission · "), unit.label);
		// A ticket-bound untitled submission is named after its ticket.
		assertEquals(page.tree[0].children[0].children[0].label, "Logo");
	});
});

Deno.test("fetchSubmissionPage file facts never disclose the submitter's library or owner-only state", async () => {
	await withPostgrest(subRoutes(), async () => {
		const page = await fetchSubmissionPage(OWNER, { projectId: SLUG });
		assert(page);
		const cut = page.items.find((f) => f.id === "i-cut")!;
		assertEquals([cut.kind, cut.ext, cut.sizeBytes, cut.sizeLabel], [
			"image",
			"png",
			1024,
			"1.0 KB",
		]);
		assertEquals(cut.folderPath, [], "the submitter's folder names stay private");
		assertEquals(cut.folderId, "f-private-library");
		assertEquals(
			[cut.canManage, cut.starred],
			[false, false],
			"the reviewer does not own the file",
		);
		assertEquals([cut.channelId, cut.channelName, cut.channelKind], [
			"c-s1",
			"Discovery room",
			"stage",
		]);
		assertEquals(cut.messageText, "Two directions");
		assertEquals(cut.sender.name, "Fern");

		const link = page.items.find((f) => f.id === "i-link")!;
		assertEquals(link.url, "https://ex.org/board");
		assertEquals(link.link?.domain, "ex.org", "derived from the URL when the column is empty");
		assertEquals(link.link?.title, "ex.org");
		assertEquals(link.link?.scanStatus, "pending");
	});
});

Deno.test("a path to a unit resolves the active unit, its review (with feedback) and the breadcrumbs", async () => {
	await withPostgrest(subRoutes(), async () => {
		const page = await fetchSubmissionPage(OWNER, {
			projectId: SLUG,
			path: [S1, FERN_ID, "sub-1", "nope"],
		});
		assert(page);
		assertEquals(page.path, [S1, FERN_ID, "sub-1"], "an unknown trailing segment is dropped");
		assertEquals(page.breadcrumbs.map((c) => c.label), [
			"All stages",
			"Discovery",
			"Fern",
			"First cut",
		]);
		assertEquals(page.items.map((f) => f.id), ["i-cut"]);
		const unit = page.activeUnit;
		assert(unit);
		assertEquals([unit.name, unit.kind, unit.status, unit.fileCount, unit.noteCount], [
			"First cut",
			"custom",
			"revision_requested",
			1,
			1,
		]);
		assertEquals(unit.path, [S1, FERN_ID, "sub-1"]);
		const review = page.review;
		assert(review);
		assertEquals([review.stageName, review.stageStatus, review.stageSummary], [
			"Discovery",
			"active",
			"Research and mood",
		]);
		assertEquals(review.notes.map((n) => [n.text, n.author.name, n.createdAt]), [
			["Tighten the kerning", "Olive Owner", "2026-10-03T10:00:00.000Z"],
		]);
	});
});

Deno.test("fetchSubmissionPage filters by kind and name, and pages with a cursor", async () => {
	await withPostgrest(subRoutes(), async () => {
		const images = await fetchSubmissionPage(OWNER, { projectId: SLUG, kinds: ["image"] });
		assertEquals(images?.items.map((f) => f.id), ["i-cut"]);
		const named = await fetchSubmissionPage(OWNER, { projectId: SLUG, query: "REFER" });
		assertEquals(named?.items.map((f) => f.id), ["i-link"]);
		const first = await fetchSubmissionPage(OWNER, { projectId: SLUG, limit: 1 });
		assertEquals([first?.items.map((f) => f.id), first?.hasMore, first?.nextCursor], [
			["i-link"],
			true,
			"i-link",
		]);
		const next = await fetchSubmissionPage(OWNER, { projectId: SLUG, limit: 1, cursor: "i-link" });
		assertEquals([next?.items.map((f) => f.id), next?.hasMore], [["i-cut"], false]);
	});
});
// #endregion

// #region Isolation (authorization)
Deno.test("a freelancer's submissions QUERY is narrowed to their own rows; peers are never fetched", async () => {
	await withPostgrest(subRoutes(), async (calls) => {
		const page = await fetchSubmissionPage(FERN, { projectId: SLUG });
		assert(page);
		SubmissionListPageSchema.parse(page);
		assertEquals(submissionsRead(calls).query.get("submitted_by"), `eq.${FERN_ID}`);
		assertEquals(page.viewerIsClient, false);
		assertEquals(page.singleFreelancer, true);
		assertEquals(page.items.map((f) => f.id), ["i-cut"]);
		assertEquals(
			JSON.stringify(page).includes(GUS_ID),
			false,
			"nothing of the peer reaches the page",
		);
		// Isolated → every stage collapses straight to the viewer's own units.
		assertEquals(page.tree[0].children.map((n) => n.kind), ["unit"]);
		const cut = page.items[0];
		assertEquals([cut.canManage, cut.starred], [true, true], "the owner of the file manages it");
	});
});

Deno.test("an owner asking to see the page as a freelancer is isolated to their own rows", async () => {
	await withPostgrest(subRoutes(), async (calls) => {
		const page = await fetchSubmissionPage(OWNER, { projectId: SLUG, asFreelancer: true });
		assert(page);
		assertEquals(submissionsRead(calls).query.get("submitted_by"), `eq.${OWNER_ID}`);
		assertEquals(page.viewerIsClient, false);
		assertEquals(page.items, []);
	});
});

Deno.test("an active member of the client business reviews; a failed membership read fails CLOSED", async () => {
	const member = actorOf(MEMBER_ID);
	await withPostgrest(
		subRoutes({ "org.business_members": [{ user_id: MEMBER_ID }] }),
		async (calls) => {
			const page = await fetchSubmissionPage(member, { projectId: SLUG });
			assert(page);
			assertEquals(page.viewerIsClient, true);
			assertEquals(submissionsRead(calls).query.get("submitted_by"), null);
			const membership = calls.find((c) => c.name === "business_members")!;
			assertEquals(membership.query.get("business_id"), `eq.${BUSINESS_ID}`);
			assertEquals(membership.query.get("status"), "eq.active");
		},
	);
	await withPostgrest(
		subRoutes({ "org.business_members": pgFail("42501", "permission denied", 403) }),
		async (calls) => {
			const page = await fetchSubmissionPage(member, { projectId: SLUG });
			assert(page);
			assertEquals(page.viewerIsClient, false);
			assertEquals(submissionsRead(calls).query.get("submitted_by"), `eq.${MEMBER_ID}`);
		},
	);
});

Deno.test("fetchSubmissionPage answers null for a project this viewer cannot see (slug or uuid)", async () => {
	await withPostgrest(subRoutes({ "projects.projects": [] }), async (calls) => {
		assertEquals(await fetchSubmissionPage(OWNER, { projectId: SLUG }), null);
		assertEquals(calls[0].query.get("slug"), `eq.${SLUG}`);
		assertEquals(await fetchSubmissionPage(OWNER, { projectId: PROJECT_UUID }), null);
		assertEquals(calls[1].query.get("id"), `eq.${PROJECT_UUID}`);
		assertEquals(calls.length, 2);
	});
});
// #endregion

// #region Channel scope
Deno.test("a stage-slug channel scope starts at the submitter level and anchors the stage", async () => {
	await withPostgrest(subRoutes(), async () => {
		const page = await fetchSubmissionPage(OWNER, { projectId: SLUG, channelId: S1_SLUG });
		assert(page);
		assertEquals(page.scope, "channel");
		assertEquals(page.stageId, S1);
		assertEquals(page.tree.map((n) => n.kind), ["submitter", "submitter"]);
		assertEquals(page.breadcrumbs[0].label, "Submissions");
	});
});

Deno.test("a channel that names no stage of this project yields an empty tree and skips the submissions read", async () => {
	await withPostgrest(subRoutes(), async (calls) => {
		const page = await fetchSubmissionPage(OWNER, { projectId: SLUG, channelId: "stg-zzzzzzzzzz" });
		assert(page);
		assertEquals([page.tree, page.items, page.stageId], [[], [], null]);
		assertEquals(calls.some((c) => c.name === "stage_submissions"), false);
	});
});
// #endregion

// #region Degradation and failures
Deno.test("failed enrichments (channels, tickets, assignments, parties) degrade instead of throwing", async () => {
	const denied = pgFail("42501", "permission denied", 403);
	await withPostgrest(
		subRoutes({
			"comms.project_channels": denied,
			"projects.tickets": denied,
			"projects.stage_assignments": denied,
			"org.rpc.get_party_cards": denied,
			"org.users_public": denied,
		}),
		async () => {
			const page = await fetchSubmissionPage(OWNER, { projectId: SLUG });
			assert(page);
			SubmissionListPageSchema.parse(page);
			const cut = page.items.find((f) => f.id === "i-cut")!;
			assertEquals(
				[cut.channelId, cut.channelName],
				[S1, "Discovery"],
				"provenance falls back to the stage",
			);
			assertEquals(cut.sender.name, "Unknown");
			// Without its ticket, the untitled ticket-bound submission is named by its timestamp.
			const gus = page.tree[0].children.find((n) => n.segment === GUS_ID)!;
			assert(gus.children[0].label.startsWith("Submission · "));
		},
	);
});

for (
	const [route, message, code] of [
		["projects.projects", "projects.projects slug read failed", "PGRST301"],
		["projects.project_stages", "projects.project_stages read failed", "42501"],
		["projects.stage_submissions", "projects.stage_submissions read failed", "42501"],
		["projects.submission_files", "projects.submission_files read failed", "57014"],
		["files.items", "files.items read failed", "42501"],
	] as const
) {
	Deno.test(`fetchSubmissionPage THROWS when ${route} fails (${code})`, async () => {
		await withPostgrest(subRoutes({ [route]: pgFail(code, "denied", 403) }), async () => {
			await assertRejects(
				() => fetchSubmissionPage(OWNER, { projectId: SLUG }),
				Error,
				`${message}: denied`,
			);
		});
	});
}

Deno.test("fetchSubmissionPage THROWS when a uuid-addressed project read fails", async () => {
	await withPostgrest(
		subRoutes({ "projects.projects": pgFail("XX000", "internal error", 500) }),
		async () => {
			await assertRejects(
				() => fetchSubmissionPage(OWNER, { projectId: PROJECT_UUID }),
				Error,
				"projects.projects id read failed: internal error",
			);
		},
	);
});
// #endregion
