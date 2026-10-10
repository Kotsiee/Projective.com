import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	decodedBytesEstimate,
	envelopeOf,
	PEAK_COUNT,
	PEAK_DECODE_MAX_BYTES,
	peakPlan,
} from "./media-peaks.ts";

const MB = 1024 * 1024;

Deno.test("envelopeOf: no channels or no frames yields an empty envelope", () => {
	assertEquals(envelopeOf([]), []);
	assertEquals(envelopeOf([new Float32Array(0)]), []);
});

Deno.test("envelopeOf: silence measures zero and resolution is capped at the stored count", () => {
	const peaks = envelopeOf([new Float32Array(100_000)]);
	assertEquals(peaks.length, PEAK_COUNT);
	assert(peaks.every((p) => p === 0));
});

Deno.test("envelopeOf: a short buffer keeps one value per frame", () => {
	const peaks = envelopeOf([Float32Array.from([0.1, 0.2, 0.3])]);
	assertEquals(peaks.length, 3);
	assertAlmostEquals(peaks[0], 0.24, 1e-6);
	assertAlmostEquals(peaks[2], 0.72, 1e-6);
});

Deno.test("envelopeOf: values are RMS × 2.4 clamped to 1", () => {
	const loud = envelopeOf([new Float32Array(4096).fill(0.9)]);
	assert(loud.every((p) => p === 1));
	const quiet = envelopeOf([new Float32Array(4096).fill(0.25)]);
	assert(quiet.every((p) => Math.abs(p - 0.6) < 1e-6));
});

Deno.test("envelopeOf: channels are mixed per frame before measuring", () => {
	const left = new Float32Array(4096).fill(0.25);
	const right = new Float32Array(4096).fill(-0.25);
	const cancelled = envelopeOf([left, right]);
	assert(cancelled.every((p) => p === 0));
});

Deno.test("envelopeOf: a transient survives compression as a bucket max", () => {
	const samples = new Float32Array(204_800);
	samples.fill(0.3, 100_000, 100_100);
	const peaks = envelopeOf([samples]);
	assert(Math.max(...peaks) > 0);
	assertEquals(peaks.filter((p) => p > 0).length, 1);
});

Deno.test("envelopeOf: channels of unequal length are read to the shortest", () => {
	const peaks = envelopeOf([new Float32Array(10).fill(0.25), new Float32Array(4).fill(0.25)]);
	assertEquals(peaks.length, 4);
});

Deno.test("decodedBytesEstimate: duration wins over size", () => {
	assertEquals(decodedBytesEstimate(1, 1000, "mp3"), 44_100 * 2 * 4);
	assertEquals(decodedBytesEstimate(MB, null, "mp3"), 20 * MB);
	assertEquals(decodedBytesEstimate(MB, null, "WAV"), 4 * MB);
	assertEquals(decodedBytesEstimate(MB, 0, "flac"), 4 * MB);
});

Deno.test("peakPlan: stored peaks are used as-is", () => {
	assertEquals(
		peakPlan({ peaks: [0.1], sizeBytes: 900 * MB, durationMs: null, ext: "mp3" }),
		"stored",
	);
});

Deno.test("peakPlan: an empty or missing envelope is decoded within budget", () => {
	assertEquals(peakPlan({ peaks: [], sizeBytes: 4 * MB, durationMs: null, ext: "mp3" }), "decode");
	assertEquals(
		peakPlan({ peaks: null, sizeBytes: 40 * MB, durationMs: null, ext: "wav" }),
		"decode",
	);
	assertEquals(
		peakPlan({ peaks: null, sizeBytes: 40 * MB, durationMs: 10 * 60_000, ext: "mp3" }),
		"decode",
	);
});

Deno.test("peakPlan: files past the byte cap or the PCM budget stay flat", () => {
	assertEquals(
		peakPlan({ peaks: null, sizeBytes: PEAK_DECODE_MAX_BYTES + 1, durationMs: 1000, ext: "wav" }),
		"too-large",
	);
	assertEquals(
		peakPlan({ peaks: null, sizeBytes: 30 * MB, durationMs: null, ext: "mp3" }),
		"too-large",
	);
	assertEquals(
		peakPlan({ peaks: null, sizeBytes: 10 * MB, durationMs: 60 * 60_000, ext: "mp3" }),
		"too-large",
	);
	assertEquals(peakPlan({ peaks: null, sizeBytes: 0, durationMs: null, ext: "mp3" }), "too-large");
});
