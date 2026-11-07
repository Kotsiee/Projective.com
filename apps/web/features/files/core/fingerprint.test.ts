import { assertEquals, assertRejects } from "@std/assert";
import { SAMPLE_THRESHOLD_BYTES, SAMPLE_WINDOW_BYTES } from "../types/file-types.ts";
import { digestFile } from "./digest.ts";
import {
	createFingerprinter,
	fingerprintFile,
	HashAbortedError,
	type HashRequest,
	type HashResponse,
} from "./fingerprint.ts";

/** A Worker the test drives by hand: it records what it is sent and runs nothing. */
class FakeWorker extends EventTarget {
	static spawned: FakeWorker[] = [];
	posted: HashRequest[] = [];
	terminated = false;

	constructor() {
		super();
		FakeWorker.spawned.push(this);
	}

	postMessage(message: HashRequest): void {
		this.posted.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	answer(data: HashResponse): void {
		this.dispatchEvent(new MessageEvent("message", { data }));
	}
}

/** Run with `globalThis.Worker` replaced, `undefined` standing for a browser without one. */
async function withWorker(replacement: unknown, run: () => Promise<void>): Promise<void> {
	const real = globalThis.Worker;
	FakeWorker.spawned = [];
	globalThis.Worker = replacement as typeof Worker;
	try {
		await run();
	} finally {
		globalThis.Worker = real;
	}
}

Deno.test("digestFile hashes every byte, or a head, a tail and the length", async () => {
	assertEquals(await digestFile(new Blob(["abc"]), null), {
		algo: "sha-256",
		hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		sizeBytes: 3,
		sampled: false,
	});
	// SHA-256 of "aacc" followed by the length 6 as 8 little-endian bytes.
	assertEquals(await digestFile(new Blob(["aabbcc"]), 2), {
		algo: "sampled-sha-256",
		hash: "5b5bb8b877704f7093dfea4d330f67fe9cf3df040b8d7771e81cc209118a47ef",
		sizeBytes: 6,
		sampled: true,
	});
});

Deno.test("the worker is told the sample window, and its answer settles the job", () =>
	withWorker(FakeWorker, async () => {
		const small = new Blob(["abc"]);
		const fingerprint = await fingerprintFile(small);
		const fractions: number[] = [];
		const fingerprinter = createFingerprinter();

		const job = fingerprinter.fingerprint(small, { onProgress: (f) => fractions.push(f) });
		const [worker] = FakeWorker.spawned;
		worker.answer({ kind: "progress", id: "h1", fraction: 0.5 });
		worker.answer({ kind: "done", id: "h1", fingerprint });
		assertEquals(await job, fingerprint);
		assertEquals(fractions, [0.5]);

		fingerprinter.fingerprint({ size: SAMPLE_THRESHOLD_BYTES + 1 } as Blob);
		const windows = worker.posted.map((m) => m.kind === "hash" && m.sampleWindowBytes);
		assertEquals(windows, [null, SAMPLE_WINDOW_BYTES]);
	}));

for (const failure of ["error", "messageerror"]) {
	Deno.test(`a worker's ${failure} moves every job to the main thread, for good`, () =>
		withWorker(FakeWorker, async () => {
			const file = new Blob(["abc"]);
			const expected = await fingerprintFile(file);
			const fingerprinter = createFingerprinter();

			const jobs = [fingerprinter.fingerprint(file), fingerprinter.fingerprint(file)];
			const [worker] = FakeWorker.spawned;
			worker.dispatchEvent(new Event(failure));

			assertEquals(await Promise.all(jobs), [expected, expected]);
			assertEquals(worker.terminated, true);

			assertEquals(await fingerprinter.fingerprint(file), expected);
			assertEquals(FakeWorker.spawned.length, 1);
			assertEquals(worker.posted.length, 2);
		}));
}

Deno.test("a job cancelled before its worker dies stays cancelled", () =>
	withWorker(FakeWorker, async () => {
		const controller = new AbortController();
		const job = createFingerprinter().fingerprint(new Blob(["abc"]), {
			signal: controller.signal,
		});
		controller.abort();
		FakeWorker.spawned[0].dispatchEvent(new Event("error"));
		await assertRejects(() => job, HashAbortedError);
	}));

Deno.test("hashing stays on the main thread where no worker can be constructed", async () => {
	const Refused = class {
		constructor() {
			throw new DOMException("Refused.", "SecurityError");
		}
	};
	for (const replacement of [undefined, Refused]) {
		await withWorker(replacement, async () => {
			const file = new Blob(["abc"]);
			assertEquals(await createFingerprinter().fingerprint(file), await fingerprintFile(file));
		});
	}
});

Deno.test("the real worker answers with the digest the main thread computes", () => {
	const answers: string[] = [];
	const Listened = class extends Worker {
		constructor(url: string | URL, options?: WorkerOptions) {
			super(url, options);
			this.addEventListener("message", (event) => answers.push(event.data.kind));
		}
	};
	return withWorker(Listened, async () => {
		const file = new Blob(["abc"]);
		const fingerprinter = createFingerprinter();
		// Deno's event loop does not count a worker's reply as pending work.
		const keepAlive = setInterval(() => {}, 1000);
		try {
			assertEquals(await fingerprinter.fingerprint(file), await fingerprintFile(file));
		} finally {
			clearInterval(keepAlive);
			fingerprinter.dispose();
		}
		// Without this, a broken worker would pass by way of the fallback.
		assertEquals(answers.at(-1), "done");
	});
});
