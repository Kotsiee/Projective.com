import { assertEquals } from "@std/assert";
import { purgeDeletedFiles, type PurgeDeps, type PurgeObject } from "./purge.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const CLAIMED: PurgeObject[] = [
	{ item_id: A, bucket_id: "personal", storage_path: "u/a.png" },
	{ item_id: A, bucket_id: "personal", storage_path: "u/a.sm.webp" },
	{ item_id: B, bucket_id: "workspace", storage_path: "t/b.pdf" },
];

function deps(over: Partial<PurgeDeps> = {}) {
	const removed: Array<[string, readonly string[]]> = [];
	const released: string[][] = [];
	const d: PurgeDeps = {
		claim: () => Promise.resolve({ data: CLAIMED, error: null }),
		remove: (bucket, paths) => {
			removed.push([bucket, paths]);
			return Promise.resolve(true);
		},
		release: (ids) => {
			released.push(ids);
			return Promise.resolve({ error: null });
		},
		...over,
	};
	return { d, removed, released };
}

Deno.test("purge: one removal per bucket, every claimed file purged, nothing handed back", async () => {
	const { d, removed, released } = deps();
	const run = await purgeDeletedFiles(100, d);
	assertEquals(run.ok && run.data, { purged: 2, failed: 0 });
	assertEquals(removed, [["personal", ["u/a.png", "u/a.sm.webp"]], ["workspace", ["t/b.pdf"]]]);
	assertEquals(released, []);
});

Deno.test("purge: a bucket Storage refuses hands its files back to the next run", async () => {
	const { d, released } = deps({ remove: (bucket) => Promise.resolve(bucket !== "workspace") });
	const run = await purgeDeletedFiles(100, d);
	assertEquals(run.ok && run.data, { purged: 1, failed: 1 });
	assertEquals(released, [[B]]);
});

Deno.test("purge: a claim the database refuses answers 503 and deletes nothing", async () => {
	const { d, removed } = deps({
		claim: () => Promise.resolve({ data: null, error: { message: "down" } }),
	});
	const run = await purgeDeletedFiles(100, d);
	assertEquals(run.ok, false);
	assertEquals(!run.ok && run.status, 503);
	assertEquals(removed, []);
});

Deno.test("purge: an empty claim does nothing", async () => {
	const { d, removed } = deps({ claim: () => Promise.resolve({ data: [], error: null }) });
	const run = await purgeDeletedFiles(100, d);
	assertEquals(run.ok && run.data, { purged: 0, failed: 0 });
	assertEquals(removed, []);
});
