import { assertEquals } from "@std/assert";
import type { AssetItem, UploadPhase, UploadTask } from "../types/file-types.ts";
import {
	pruneSamples,
	RATE_WINDOW_MS,
	remainingLabel,
	secondsRemaining,
	summariseUploads,
	uploadLabel,
} from "./upload-progress.ts";

function task(phase: UploadPhase, patch: Partial<UploadTask> = {}): UploadTask {
	return {
		id: crypto.randomUUID(),
		file: null,
		name: "brief.pdf",
		sizeBytes: 100,
		sizeLabel: "100 B",
		mimeType: "application/pdf",
		folderId: null,
		phase,
		progress: 0,
		fingerprint: null,
		verdict: null,
		resolution: null,
		assetId: null,
		ticket: null,
		error: null,
		...patch,
	};
}

const MATCH = { verdict: "exact_duplicate", existing: { id: "a-1" } as AssetItem } as const;

Deno.test("an empty or all-cancelled queue says nothing", () => {
	assertEquals(summariseUploads([]).tone, "idle");
	assertEquals(summariseUploads([task("cancelled")]).tone, "idle");
	assertEquals(uploadLabel(summariseUploads([])), "");
});

Deno.test("a running batch counts the file in hand, leaving cancelled files out of the total", () => {
	const report = summariseUploads([
		task("done"),
		task("done"),
		task("uploading", { progress: 0.5 }),
		task("hashing"),
		task("cancelled"),
	]);
	assertEquals([report.tone, report.position, report.total], ["active", 3, 4]);
	assertEquals(uploadLabel(report), "Uploading 3 of 4…");
	// Two whole files and half of a third, of four.
	assertEquals(report.fraction, 250 / 400);
});

Deno.test("the position never runs past the total", () => {
	const report = summariseUploads([task("done"), task("finalising")]);
	assertEquals([report.position, report.total, report.tone], [2, 2, "active"]);
	assertEquals(report.fraction, 1);
});

Deno.test("a duplicate prompt holds the batch in attention while other files run", () => {
	const report = summariseUploads([
		task("ready", { verdict: MATCH }),
		task("uploading", { progress: 0.2 }),
	]);
	assertEquals(report.tone, "attention");
	assertEquals(uploadLabel(report), "1 file needs your answer");
	// An answered prompt, or a verdict that names nothing, asks nothing.
	assertEquals(
		summariseUploads([task("ready", { verdict: MATCH, resolution: "upload_copy" })]).tone,
		"active",
	);
	assertEquals(
		summariseUploads([task("ready", { verdict: { verdict: "exact_duplicate", existing: null } })])
			.tone,
		"active",
	);
});

Deno.test("a finished batch succeeds, carries its notes, or reports what did not land", () => {
	assertEquals(
		uploadLabel(summariseUploads([task("done"), task("done"), task("cancelled")])),
		"2 files uploaded",
	);
	assertEquals(summariseUploads([task("done")]).tone, "success");
	assertEquals(uploadLabel(summariseUploads([task("done")])), "1 file uploaded");

	const noted = summariseUploads([task("done", { error: "Scripts were removed." }), task("done")]);
	assertEquals([noted.tone, uploadLabel(noted)], ["noted", "2 files uploaded, 1 with a note"]);

	const failed = summariseUploads([task("done"), task("error"), task("error")]);
	assertEquals([failed.tone, uploadLabel(failed)], ["failed", "2 uploads failed"]);
	assertEquals(uploadLabel(summariseUploads([task("blocked")])), "1 file did not fit your storage");
	assertEquals(
		uploadLabel(summariseUploads([task("blocked"), task("error")])),
		"2 uploads did not finish",
	);
});

Deno.test("a zero-byte file still moves the bar", () => {
	const report = summariseUploads([
		task("done", { sizeBytes: 0 }),
		task("queued", { sizeBytes: 0 }),
	]);
	assertEquals(report.fraction, 0.5);
});

Deno.test("time remaining needs a real span and real movement", () => {
	assertEquals(secondsRemaining([], 100), null);
	assertEquals(secondsRemaining([{ at: 0, bytes: 0 }, { at: 1000, bytes: 50 }], 100), null);
	assertEquals(secondsRemaining([{ at: 0, bytes: 10 }, { at: 3000, bytes: 10 }], 100), null);
	assertEquals(secondsRemaining([{ at: 0, bytes: 0 }, { at: 4000, bytes: 400 }], 0), null);
	// 400 bytes in 4 s is 100 B/s: 900 bytes left is 9 s.
	assertEquals(secondsRemaining([{ at: 0, bytes: 0 }, { at: 4000, bytes: 400 }], 900), 9);
});

Deno.test("samples older than the rate window are dropped", () => {
	const now = 50_000;
	const kept = pruneSamples([
		{ at: now - RATE_WINDOW_MS - 1, bytes: 0 },
		{ at: now - RATE_WINDOW_MS, bytes: 1 },
		{ at: now, bytes: 2 },
	], now);
	assertEquals(kept.map((s) => s.bytes), [1, 2]);
});

Deno.test("time remaining reads in seconds, then minutes, then hours, never zero", () => {
	assertEquals(remainingLabel(0.2), "~1s remaining");
	assertEquals(remainingLabel(44.1), "~45s remaining");
	assertEquals(remainingLabel(150), "~3 min remaining");
	assertEquals(remainingLabel(7200), "~2 h remaining");
});
