import { assert, assertEquals } from "@std/assert";
import { mintSlug } from "@projective/types/slugs";
import { setSharedKvForTesting } from "../../core/kv.ts";
import type { BoardCard } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { claimSweepDue } from "./freshness.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";

/**
 * cross-party-freshness_test — a write by one party to a shared project shows on the OTHER party's
 * next read, not up to `READ_CACHE_TTL_MS` later (ST6, Decision #427 (i)).
 *
 * The read cache is keyed by tenant, and a write used to evict only the writer's tenant, so the
 * other party was served its pre-write entry for the whole TTL. Each case reads as the seller,
 * writes as the client, and reads as the seller again inside the TTL. The database is a fake
 * PostgREST at `globalThis.fetch` holding one mutable project row; it counts the project reads, so
 * a cache hit (no read) is told from a database answer. The tests run without `--unstable-kv`, the
 * dev server's road; the last case stands a stub KV in for another isolate.
 */

// #region Fake PostgREST
const ENV = {
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	DENO_ENV: "development",
	PROJECTS_BACKEND_LIVE: "true",
};

/** Run `body` with the live env on and `fetch` answering from `answer(key)`. */
async function withPostgrest<T>(
	answer: (key: string) => unknown,
	body: () => Promise<T>,
): Promise<T> {
	const realFetch = globalThis.fetch;
	const saved = Object.keys(ENV).map((k) => [k, Deno.env.get(k)] as const);
	for (const [k, v] of Object.entries(ENV)) {
		v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
	}
	globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const path = new URL(request.url).pathname.replace(/^\/rest\/v1\//, "");
		const schema = request.headers.get("accept-profile") ??
			request.headers.get("content-profile") ??
			"public";
		const rpc = path.startsWith("rpc/");
		const value = answer(`${schema}.${rpc ? `rpc.${path.slice(4)}` : path}`) ?? (rpc ? null : []);
		const single = (request.headers.get("accept") ?? "").includes("vnd.pgrst.object");
		const rows = Array.isArray(value) ? value : [value];
		if (single && rows.length !== 1) {
			return Promise.resolve(Response.json(
				{ code: "PGRST116", message: "no rows", details: null, hint: null },
				{ status: 406 },
			));
		}
		return Promise.resolve(Response.json(single ? rows[0] : value, {
			headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
		}));
	};
	try {
		return await body();
	} finally {
		globalThis.fetch = realFetch;
		for (const [k, v] of saved) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
	}
}

const CLIENT = "00000000-0000-4000-8000-00000000c101";
const SELLER = "00000000-0000-4000-8000-00000000c102";
const actor = (userId: string): ReadActor => ({
	userId,
	contextId: "",
	contextType: "personal",
	accessToken: `token-${userId}`,
});

/** One shared service engagement: the seller owns it, the client bought it (Decision #427). */
function sharedProject() {
	const row = {
		id: crypto.randomUUID(),
		slug: mintSlug("project"),
		title: "Brand refresh",
		format: "pipeline",
		status: "active",
		visibility: "private",
		currency: "USD",
		owner_user_id: SELLER,
		owner_team_id: null,
		owner_enterprise_id: null,
		client_user_id: CLIENT,
		client_business_id: null,
		source_blueprint_id: null,
		updated_at: "2026-11-24T10:00:00Z",
		last_activity_at: "2026-11-24T10:00:00Z",
		is_personal: false,
		archived_at: null as string | null,
	};
	const db = { row, projectReads: 0 };
	const answer = (key: string) => {
		if (key === "projects.projects") {
			db.projectReads++;
			return [row];
		}
		if (key === "projects.rpc.set_project_status") {
			row.status = "archived";
			row.archived_at = "2026-11-24T10:01:00Z";
			row.title = "Brand refresh (archived)";
			return null;
		}
		return undefined;
	};
	return { db, answer };
}

/** How many project reads `read` cost the database. */
async function readsDuring(db: { projectReads: number }, read: () => Promise<unknown>) {
	const before = db.projectReads;
	await read();
	return db.projectReads - before;
}
// #endregion

// #region Cases
Deno.test("ST6: the client's write shows on the seller's next read", async () => {
	const { db, answer } = sharedProject();
	const slug = db.row.slug;
	await withPostgrest(answer, async () => {
		const before = await ProjectBackendService.item(slug, actor(SELLER));
		assertEquals(before.data?.item.title, "Brand refresh");

		const archived = await ProjectBackendService.archiveProject(slug, {}, actor(CLIENT));
		assertEquals(archived.ok, true, archived.message);

		const after = await ProjectBackendService.item(slug, actor(SELLER));
		assertEquals(
			after.data?.item.title,
			"Brand refresh (archived)",
			"the seller was served its pre-write entry",
		);
	});
});

Deno.test("ST6: with no write in between, the seller's repeat read stays a cache hit", async () => {
	const { db, answer } = sharedProject();
	const slug = db.row.slug;
	await withPostgrest(answer, async () => {
		const first = await readsDuring(db, () => ProjectBackendService.item(slug, actor(SELLER)));
		assert(first > 0, "the first read reaches the database");
		const second = await readsDuring(db, () => ProjectBackendService.item(slug, actor(SELLER)));
		assertEquals(second, 0, "a read with no write in between is served from the cache");
	});
});

Deno.test("ST6: another isolate's write re-keys this isolate's read within a second", async () => {
	const store = new Map<string, unknown>();
	const id = (key: Deno.KvKey) => JSON.stringify(key);
	const kv = {
		get: (key: Deno.KvKey) =>
			Promise.resolve({ key, value: store.get(id(key)) ?? null, versionstamp: null }),
		set: (key: Deno.KvKey, value: unknown) => {
			store.set(id(key), value);
			return Promise.resolve({ ok: true, versionstamp: "1" });
		},
	} as unknown as Deno.Kv;
	setSharedKvForTesting(kv);
	try {
		const { db, answer } = sharedProject();
		const slug = db.row.slug;
		await withPostgrest(answer, async () => {
			await ProjectBackendService.item(slug, actor(SELLER));
			// The client's write lands on ANOTHER isolate: the row changes and that isolate bumps KV,
			// with nothing in this isolate's memory told.
			db.row.title = "Renamed elsewhere";
			await kv.set(["cache", "v", "projects", slug], crypto.randomUUID());
			await new Promise((resolve) => setTimeout(resolve, 1_100));
			const after = await ProjectBackendService.item(slug, actor(SELLER));
			assertEquals(after.data?.item.title, "Renamed elsewhere");
		});
	} finally {
		setSharedKvForTesting(undefined);
	}
});

Deno.test("ST6: a board reads around the cache while the claim sweep is due on a card", () => {
	const now = Date.parse("2026-11-24T12:00:00Z");
	const ttl = 1440;
	const claimed = (claimedAt: string | null, status: BoardCard["status"] = "claimed") => ({
		status,
		claimedAt,
	});
	// Past the TTL and still only claimed: the sweep may release it at any quarter-hour.
	assert(claimSweepDue([claimed("2026-11-23T11:59:00Z")], ttl, now));
	// Inside the TTL, started, or never claimed: no sweep can act, so the cache serves it.
	assertEquals(claimSweepDue([claimed("2026-11-23T12:01:00Z")], ttl, now), false);
	assertEquals(claimSweepDue([claimed("2026-11-20T00:00:00Z", "in_progress")], ttl, now), false);
	assertEquals(claimSweepDue([claimed(null)], ttl, now), false);
	assertEquals(claimSweepDue([], ttl, now), false);
});
// #endregion
