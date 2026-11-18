import { assert, assertEquals } from "@std/assert";
import type { NewsletterSyncRow, NewsletterTopic } from "@projective/types/community";
import { NewsletterProviderSync, type ProviderSyncDeps } from "./provider-sync.ts";
import type { ContactCall, ContactsClient, TopicSubscription } from "./resend-contacts.ts";

/**
 * One pass of the provider sync against a stub provider (CD1 step 5's acceptance). The list stands in
 * for `community.newsletter_sync_batch` / `record_newsletter_sync` with the same rule the SQL probe
 * `newsletter_provider_sync.sql` proves on Postgres: a confirmed, not unsubscribed, unsuppressed row
 * is eligible; the provider gets a contact for exactly those; the record stamps the version read.
 */

// #region The list
interface Row {
	id: string;
	email: string;
	topics: NewsletterTopic[];
	confirmed: boolean;
	unsubscribed: boolean;
	suppressed: boolean;
	ref: string | null;
	providerTopics: NewsletterTopic[] | null;
	version: number;
	synced: number | null;
	confirmedAt: number;
}

const CONFIG = {
	segment_id: "seg-1",
	topic_ids: { general: "t-general", changelog: "t-changelog" },
};

function row(id: string, over: Partial<Row> = {}): Row {
	return {
		id: crypto.randomUUID(),
		email: `${id}@example.com`,
		topics: ["general"],
		confirmed: true,
		unsubscribed: false,
		suppressed: false,
		ref: null,
		providerTopics: null,
		version: 10,
		synced: null,
		confirmedAt: 5,
		...over,
	};
}

const iso = (n: number) => new Date(Date.UTC(2026, 10, 18, 12, 0, n)).toISOString();
const num = (s: string) => new Date(s).getUTCSeconds();

/** The list as a database: the batch rule, the record's writes, and the log of record calls. */
function list(rows: Row[], enabled = true, config: Record<string, unknown> = CONFIG) {
	const records: Array<Record<string, unknown>> = [];
	const eligible = (r: Row) => r.confirmed && !r.unsubscribed && !r.suppressed;
	const deps: Pick<ProviderSyncDeps, "batch" | "record"> = {
		batch: ({ p_limit }) => {
			const due = rows
				.filter((r) => eligible(r) ? r.synced === null || r.synced < r.version : r.ref !== null)
				.sort((a, b) => a.version - b.version)
				.slice(0, p_limit as number);
			return Promise.resolve({
				data: {
					enabled,
					...config,
					rows: enabled
						? due.map((r): NewsletterSyncRow => ({
							id: r.id,
							email: r.email,
							topics: r.topics,
							action: eligible(r) ? "upsert" : "remove",
							contact_ref: r.ref,
							version: iso(r.version),
							reconfirmed: r.confirmed && r.confirmedAt > (r.synced ?? -1),
						}))
						: [],
				},
				error: null,
			});
		},
		record: (args) => {
			records.push(args);
			const r = rows.find((x) => x.id === args.p_id)!;
			if (args.p_action === "removed") {
				r.ref = null;
				r.providerTopics = null;
				r.synced = null;
			} else {
				if (args.p_action === "upserted") {
					r.ref = args.p_contact_ref as string;
					r.providerTopics = args.p_topics as NewsletterTopic[];
				}
				r.synced = num(args.p_version as string);
			}
			return Promise.resolve({ data: "recorded", error: null });
		},
	};
	return { rows, records, deps };
}
// #endregion

// #region The provider
interface Call {
	op: keyof ContactsClient;
	args: unknown[];
}

/** A stub Resend: every call recorded; answers scripted per op, ok with a fresh id otherwise. */
function provider(script: Partial<Record<keyof ContactsClient, ContactCall[]>> = {}) {
	const calls: Call[] = [];
	let next = 0;
	const answer = (op: keyof ContactsClient, args: unknown[]): Promise<ContactCall> => {
		calls.push({ op, args });
		const scripted = script[op]?.shift();
		return Promise.resolve(
			scripted ?? { ok: true, id: op === "remove" ? String(args[0]) : `ct-${++next}` },
		);
	};
	const client: ContactsClient = {
		create: (...a) => answer("create", a),
		find: (...a) => answer("find", a),
		resubscribe: (...a) => answer("resubscribe", a),
		addToSegment: (...a) => answer("addToSegment", a),
		setTopics: (...a) => answer("setTopics", a),
		remove: (...a) => answer("remove", a),
	};
	return { calls, client };
}

function deps(
	db: ReturnType<typeof list>,
	stub: ReturnType<typeof provider>,
	over: Partial<ProviderSyncDeps> = {},
): Partial<ProviderSyncDeps> {
	return {
		live: true,
		apiKey: "re_test_key",
		contacts: () => stub.client,
		budgetMs: 60_000,
		now: () => 0,
		log: () => {},
		...db.deps,
		...over,
	};
}

const subs = (general: boolean, changelog: boolean): TopicSubscription[] => [
	{ id: "t-general", subscription: general ? "opt_in" : "opt_out" },
	{ id: "t-changelog", subscription: changelog ? "opt_in" : "opt_out" },
];
// #endregion

Deno.test("only confirmed, unsuppressed rows reach the provider, with the address and topics only", async () => {
	const db = list([
		row("new", { topics: ["changelog", "general"] }),
		row("unconfirmed", { confirmed: false }),
		row("bounced", { suppressed: true }),
		row("left", { unsubscribed: true }),
	]);
	const stub = provider();
	const result = await NewsletterProviderSync.run(50, deps(db, stub));
	assert(result.ok);
	assertEquals(result.data!, {
		skipped: null,
		read: 1,
		upserted: 1,
		removed: 0,
		refused: 0,
		failed: 0,
		stopped: null,
	});
	assertEquals(stub.calls, [{
		op: "create",
		args: ["new@example.com", "seg-1", subs(true, true)],
	}]);
	assertEquals(db.rows[0].ref, "ct-1");
	assertEquals(db.rows[0].providerTopics, ["changelog", "general"]);
	// The next pass has nothing to do.
	const again = provider();
	const second = await NewsletterProviderSync.run(50, deps(db, again));
	assert(second.ok);
	assertEquals([second.data!.read, again.calls.length], [0, 0]);
});

Deno.test("an unsubscribe removes the contact, and a suppression does too", async () => {
	const db = list([
		row("left", { unsubscribed: true, ref: "ct-left", synced: 10 }),
		row("bounced", { suppressed: true, ref: "ct-bounced", synced: 10 }),
	]);
	const stub = provider();
	const result = await NewsletterProviderSync.run(50, deps(db, stub));
	assert(result.ok);
	assertEquals(result.data!.removed, 2);
	assertEquals(stub.calls.map((c) => `${c.op} ${c.args[0]}`), [
		"remove ct-left",
		"remove ct-bounced",
	]);
	assertEquals(db.rows.map((r) => r.ref), [null, null]);
	assertEquals(db.records.map((r) => [r.p_action, r.p_contact_ref]), [["removed", "ct-left"], [
		"removed",
		"ct-bounced",
	]]);
});

Deno.test("a known contact gets its segment and topics; its own opt-out is lifted only after a confirm", async () => {
	const db = list([
		row("changed", { ref: "ct-a", synced: 8, version: 10, confirmedAt: 5 }),
		row("reconfirmed", {
			ref: "ct-b",
			synced: 8,
			version: 11,
			confirmedAt: 11,
			topics: ["changelog"],
		}),
	]);
	const stub = provider();
	await NewsletterProviderSync.run(50, deps(db, stub));
	assertEquals(stub.calls.map((c) => `${c.op} ${c.args[0]}`), [
		"addToSegment ct-a",
		"setTopics ct-a",
		"resubscribe ct-b",
		"addToSegment ct-b",
		"setTopics ct-b",
	]);
	assertEquals(stub.calls[4].args[1], subs(false, true));
	assertEquals(db.records.map((r) => r.p_version), [iso(10), iso(11)]);
});

Deno.test("an address the provider already holds is found and updated, not created twice", async () => {
	const db = list([row("exists")]);
	const stub = provider({
		create: [{ ok: false, kind: "exists", status: 409 }],
		find: [{ ok: true, id: "ct-old" }],
	});
	await NewsletterProviderSync.run(50, deps(db, stub));
	assertEquals(stub.calls.map((c) => c.op), [
		"create",
		"find",
		"resubscribe",
		"addToSegment",
		"setTopics",
	]);
	assertEquals(db.rows[0].ref, "ct-old");
});

Deno.test("a contact deleted at the provider before its event arrived is created again", async () => {
	const db = list([row("vanished", { ref: "ct-gone", synced: 8 })]);
	const stub = provider({ addToSegment: [{ ok: false, kind: "not_found", status: 404 }] });
	await NewsletterProviderSync.run(50, deps(db, stub));
	assertEquals(stub.calls.map((c) => c.op), ["addToSegment", "create"]);
	assertEquals(db.rows[0].ref, "ct-1");
});

Deno.test("a 429 or an outage ends the pass; what was not done is not recorded", async () => {
	for (const kind of ["rate_limited", "unavailable"] as const) {
		const db = list([
			row("one", { version: 1 }),
			row("two", { version: 2 }),
			row("three", { version: 3 }),
		]);
		const stub = provider({
			create: [{ ok: true, id: "ct-one" }, { ok: false, kind, status: 429 }],
		});
		const result = await NewsletterProviderSync.run(50, deps(db, stub));
		assert(result.ok);
		assertEquals([result.data!.upserted, result.data!.stopped], [1, kind]);
		assertEquals(stub.calls.length, 2);
		assertEquals(db.records.length, 1);
	}
});

Deno.test("a refusal is recorded only in a pass where the provider took another address", async () => {
	const refused: ContactCall = { ok: false, kind: "refused", status: 422 };
	const missing: ContactCall = { ok: false, kind: "not_found", status: 404 };

	const mixed = list([row("bad", { version: 1 }), row("good", { version: 2 })]);
	const one = provider({ create: [refused], find: [missing] });
	const a = await NewsletterProviderSync.run(50, deps(mixed, one));
	assert(a.ok);
	assertEquals([a.data!.upserted, a.data!.refused], [1, 1]);
	assertEquals(mixed.records.map((r) => r.p_action), ["upserted", "refused"]);

	// Every call refused: a configuration error (a wrong segment or topic id), so nothing is stamped.
	const allBad = list([row("x", { version: 1 }), row("y", { version: 2 })]);
	const two = provider({ create: [refused, refused], find: [missing, missing] });
	const b = await NewsletterProviderSync.run(50, deps(allBad, two));
	assert(b.ok);
	assertEquals([b.data!.refused, b.data!.failed, allBad.records.length], [0, 2, 0]);
});

Deno.test("the pass stops at its time budget", async () => {
	let clock = 0;
	const db = list([row("one", { version: 1 }), row("two", { version: 2 })]);
	const stub = provider();
	const result = await NewsletterProviderSync.run(
		50,
		deps(db, stub, {
			budgetMs: 100,
			now: () => {
				const t = clock;
				clock += 80;
				return t;
			},
		}),
	);
	assert(result.ok);
	assertEquals([result.data!.upserted, result.data!.stopped], [1, "budget"]);
});

Deno.test("nothing is read or sent while stubbed, unconfigured or switched off", async () => {
	const cases: Array<[string, Partial<ProviderSyncDeps>, ReturnType<typeof list>]> = [
		["stub", { live: false }, list([row("a")])],
		["unconfigured", { apiKey: "XXXX-XXXX" }, list([row("a")])],
		["off", {}, list([row("a")], false)],
		[
			"unconfigured",
			{},
			list([row("a")], true, { segment_id: "seg", topic_ids: { general: "t" } }),
		],
		["unconfigured", {}, list([row("a")], true, { segment_id: null, topic_ids: CONFIG.topic_ids })],
	];
	for (const [skipped, over, db] of cases) {
		const stub = provider();
		const result = await NewsletterProviderSync.run(50, deps(db, stub, over));
		assert(result.ok);
		assertEquals(result.data!.skipped, skipped);
		assertEquals(stub.calls.length, 0);
		assertEquals(db.records.length, 0);
	}
});

Deno.test("a batch read error is a 503 and a drifted batch a 502; the limit is bounded", async () => {
	const stub = provider();
	const down = await NewsletterProviderSync.run(50, {
		...deps(list([]), stub),
		batch: () => Promise.resolve({ data: null, error: { code: "PGRST301", message: "x" } }),
	});
	assertEquals(down.status, 503);
	const drift = await NewsletterProviderSync.run(50, {
		...deps(list([]), stub),
		batch: () => Promise.resolve({ data: { enabled: true, rows: [{ id: "x" }] }, error: null }),
	});
	assertEquals(drift.status, 502);
	const limits: unknown[] = [];
	for (const n of [0, 5, 10_000]) {
		await NewsletterProviderSync.run(n, {
			...deps(list([]), stub),
			batch: (args) => {
				limits.push(args.p_limit);
				return Promise.resolve({ data: { enabled: false, rows: [] }, error: null });
			},
		});
	}
	assertEquals(limits, [50, 5, 200]);
});

Deno.test("only the dispatcher's bearer opens the sync", () => {
	const secret = "s".repeat(40);
	const before = Deno.env.get("COMMS_DISPATCH_SECRET");
	Deno.env.set("COMMS_DISPATCH_SECRET", secret);
	try {
		assert(NewsletterProviderSync.isAuthorised(`Bearer ${secret}`));
		assert(!NewsletterProviderSync.isAuthorised(`Bearer ${"t".repeat(40)}`));
		assert(!NewsletterProviderSync.isAuthorised(null));
	} finally {
		if (before === undefined) Deno.env.delete("COMMS_DISPATCH_SECRET");
		else Deno.env.set("COMMS_DISPATCH_SECRET", before);
	}
});
