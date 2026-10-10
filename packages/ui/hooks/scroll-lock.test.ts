import { assert, assertEquals, assertFalse } from "@std/assert";
import { createScrollLock, type ScrollLock } from "./scroll-lock.ts";

interface Rig {
	lock: ScrollLock;
	log: string[];
	pending: number;
	flush(): void;
}

function rig(): Rig {
	const log: string[] = [];
	let queue: { task: () => void; live: boolean }[] = [];
	const lock = createScrollLock({
		apply: () => log.push("apply"),
		release: () => log.push("release"),
		defer(task) {
			const entry = { task, live: true };
			queue.push(entry);
			return () => {
				entry.live = false;
			};
		},
	});
	return {
		lock,
		log,
		get pending() {
			return queue.filter((e) => e.live).length;
		},
		flush() {
			const due = queue;
			queue = [];
			for (const e of due) if (e.live) e.task();
		},
	};
}

Deno.test("scroll lock: the first claim applies, nested claims do not reapply", () => {
	const r = rig();
	r.lock.acquire();
	r.lock.acquire();
	assertEquals(r.log, ["apply"]);
	assertEquals(r.lock.count, 2);
	assert(r.lock.locked);
});

Deno.test("scroll lock: the last release waits for the deferral before unlocking", () => {
	const r = rig();
	r.lock.acquire();
	r.lock.release();
	assertEquals(r.log, ["apply"]);
	assert(r.lock.locked);
	assertEquals(r.pending, 1);
	r.flush();
	assertEquals(r.log, ["apply", "release"]);
	assertFalse(r.lock.locked);
});

Deno.test("scroll lock: a claim during the deferral keeps the page locked (frame swap)", () => {
	const r = rig();
	r.lock.acquire();
	r.lock.release();
	r.lock.acquire();
	assertEquals(r.pending, 0);
	r.flush();
	assertEquals(r.log, ["apply"]);
	assert(r.lock.locked);
	assertEquals(r.lock.count, 1);
});

Deno.test("scroll lock: a release with claims left schedules nothing", () => {
	const r = rig();
	r.lock.acquire();
	r.lock.acquire();
	r.lock.release();
	assertEquals(r.pending, 0);
	assertEquals(r.lock.count, 1);
});

Deno.test("scroll lock: an unmatched release is ignored", () => {
	const r = rig();
	r.lock.release();
	assertEquals(r.lock.count, 0);
	assertEquals(r.pending, 0);
	assertEquals(r.log, []);
});

Deno.test("scroll lock: repeated swaps schedule one deferral at a time and unlock once", () => {
	const r = rig();
	r.lock.acquire();
	r.lock.release();
	r.lock.acquire();
	r.lock.release();
	assertEquals(r.pending, 1);
	r.flush();
	assertEquals(r.log, ["apply", "release"]);
	r.lock.acquire();
	assertEquals(r.log, ["apply", "release", "apply"]);
});
