/// <reference lib="dom" />
import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { POLL_MS } from "./notification-model.ts";

// #region Seam-free import
// `notification-state.ts` reaches `@web/utils/dev-seam.ts`, whose `dev.ts` reads Vite's
// `import.meta.env.DEV` at module scope (undefined under `deno test`). Same technique as
// `projects/core/board-access.test.ts`: load the module from source with the seam swapped for a stub.
const DEV_SEAM = "@web/utils/dev-seam.ts";
const SEAM_STUB = "export function readDevSeam() { return null; }\n" +
	"export function subscribeDevSeam() { return () => {}; }\n";

function dataUrl(source: string, type: "typescript" | "javascript"): string {
	return `data:application/${type},${encodeURIComponent(source)}`;
}

async function seamFreeUrl(file: URL): Promise<string> {
	let source = await Deno.readTextFile(file);
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		let target: string;
		if (spec === DEV_SEAM) target = dataUrl(SEAM_STUB, "javascript");
		else if (spec.startsWith(".")) {
			const dep = new URL(spec, file);
			target = (await Deno.readTextFile(dep)).includes(DEV_SEAM)
				? await seamFreeUrl(dep)
				: dep.href;
		} else target = import.meta.resolve(spec);
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	return dataUrl(source, "typescript");
}

const { inboxArrivals, inboxSummary, startInboxPolling }: typeof import("./notification-state.ts") =
	await import(await seamFreeUrl(new URL("./notification-state.ts", import.meta.url)));
// #endregion

Deno.test("the poller reads /summary on its cadence, pulses on arrivals and pauses while hidden", async () => {
	using time = new FakeTime(0);
	let calls = 0;
	let total = 1;
	const realFetch = globalThis.fetch;
	// A plain object, not a `Response`: reading a real body needs an event-loop turn FakeTime never gives.
	globalThis.fetch = (() => {
		calls++;
		const body = { ok: true, unread: total, unseen: total, total, byCategory: {} };
		return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
	}) as unknown as typeof fetch;
	const listeners = new Map<string, () => void>();
	const doc = {
		visibilityState: "visible",
		addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
		removeEventListener: (type: string) => listeners.delete(type),
	};
	Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
	try {
		const stop = startInboxPolling();
		await time.runMicrotasks();
		assertEquals(calls, 1);
		assertEquals(inboxSummary.value?.total, 1);
		const pulse = inboxArrivals.value;

		total = 2;
		await time.tickAsync(POLL_MS);
		await time.runMicrotasks();
		assertEquals(calls, 2);
		assertEquals(inboxArrivals.value, pulse + 1);

		doc.visibilityState = "hidden";
		listeners.get("visibilitychange")!();
		await time.tickAsync(POLL_MS * 3);
		assertEquals(calls, 2);

		doc.visibilityState = "visible";
		listeners.get("visibilitychange")!();
		await time.runMicrotasks();
		assertEquals(calls, 3);

		stop();
		await time.tickAsync(POLL_MS * 2);
		assertEquals(calls, 3);
	} finally {
		globalThis.fetch = realFetch;
		Reflect.deleteProperty(globalThis, "document");
	}
});
