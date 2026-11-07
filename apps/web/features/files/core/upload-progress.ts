import type { DedupVerdict, UploadTask } from "../types/file-types.ts";

/**
 * upload-progress — what the footer's upload widget says about a batch, as pure functions over the
 * queue, so the sentence and the figure test without a DOM or a clock.
 *
 * A REPORT is the run of tasks the widget is describing: everything queued since it last went quiet.
 * The widget holds which ids it has already closed; this module only reads the tasks it is handed.
 *
 * Every figure is a count or a byte share of what the queue itself holds. Nothing here reads the
 * allowance, which stays server-computed (the drawer's meter renders it).
 */

// #region Shapes
/** What the widget is doing: describing work, asking for a look, or nothing at all. */
export type UploadTone = "idle" | "active" | "attention" | "success" | "noted" | "failed";

/** One batch, counted. */
export interface UploadReport {
	tone: UploadTone;
	/** Files meant to land: every task in the report except the cancelled. */
	total: number;
	/** Stored in the library. */
	uploaded: number;
	/** Failed for a reason that was not a decision (`error`). */
	failed: number;
	/** Refused because the allowance is full and enforced (`blocked`), a decision, not a failure. */
	blocked: number;
	/** Waiting on the person's answer to a duplicate prompt. */
	awaiting: number;
	/** Stored, with a note the person should read (a sanitised SVG, a replacement that kept both). */
	noted: number;
	/** The 1-based place of the file being worked on, for "Uploading 3 of 10". */
	position: number;
	/** Bytes in the report, cancelled tasks excluded. */
	bytesTotal: number;
	/** Bytes that have landed or been settled one way or the other. */
	bytesDone: number;
	/** `bytesDone / bytesTotal`, `0`–`1`. */
	fraction: number;
}

/** One reading of the batch's progress, for the time-remaining estimate. */
export interface ProgressSample {
	/** A monotonic timestamp in milliseconds (`performance.now()`). */
	at: number;
	bytes: number;
}
// #endregion

// #region Phases
/**
 * Whether a verdict actually warrants a question.
 *
 * A non-`new` verdict carrying no `existing` is deliberately treated as `new`: a prompt that claims a
 * duplicate without naming it asks the person to guess, and the safe guess is always "upload it
 * again", so the prompt would cost a decision and save nothing. Uploading is the honest fallback.
 */
export function needsAnswer(verdict: DedupVerdict | null): verdict is DedupVerdict {
	return verdict !== null && verdict.verdict !== "new" && verdict.existing !== null;
}

/** Whether a task is parked waiting for a person rather than for the network. */
export function awaitsAnswer(task: UploadTask): boolean {
	return task.phase === "ready" && task.resolution === null && needsAnswer(task.verdict);
}

function settled(task: UploadTask): boolean {
	return task.phase === "done" || task.phase === "error" || task.phase === "blocked";
}

/**
 * How many of a task's bytes count as handled. A failed or refused file counts in full: the bar
 * describes how much of the batch is behind the person, and a file that will not upload is behind
 * them too. A zero-byte file weighs one byte, so it still moves the bar.
 */
export function bytesDoneOf(task: UploadTask): number {
	const size = Math.max(1, task.sizeBytes);
	switch (task.phase) {
		case "done":
		case "error":
		case "blocked":
		case "finalising":
			return size;
		case "uploading":
			return size * Math.min(1, Math.max(0, task.progress));
		default:
			return 0;
	}
}
// #endregion

// #region Report
/**
 * Count a batch.
 *
 * The tone answers what the widget should do. `attention` wins over everything while a duplicate
 * prompt waits, because the batch cannot finish until it is answered. Once every file is settled, a
 * failure outranks a note, and a note outranks a plain success, which is the only tone that leaves on
 * its own.
 */
export function summariseUploads(tasks: readonly UploadTask[]): UploadReport {
	const live = tasks.filter((t) => t.phase !== "cancelled");
	const uploaded = live.filter((t) => t.phase === "done").length;
	const failed = live.filter((t) => t.phase === "error").length;
	const blocked = live.filter((t) => t.phase === "blocked").length;
	const awaiting = live.filter(awaitsAnswer).length;
	const noted = live.filter((t) => t.phase === "done" && t.error !== null).length;
	const finished = live.filter(settled).length;
	const bytesTotal = live.reduce((sum, t) => sum + Math.max(1, t.sizeBytes), 0);
	const bytesDone = live.reduce((sum, t) => sum + bytesDoneOf(t), 0);
	const total = live.length;

	let tone: UploadTone;
	if (total === 0) tone = "idle";
	else if (awaiting > 0) tone = "attention";
	else if (finished < total) tone = "active";
	else if (failed + blocked > 0) tone = "failed";
	else if (noted > 0) tone = "noted";
	else tone = "success";

	return {
		tone,
		total,
		uploaded,
		failed,
		blocked,
		awaiting,
		noted,
		position: Math.min(total, finished + 1),
		bytesTotal,
		bytesDone,
		fraction: bytesTotal === 0 ? 0 : Math.min(1, bytesDone / bytesTotal),
	};
}

function files(n: number): string {
	return `${n} ${n === 1 ? "file" : "files"}`;
}

function uploads(n: number): string {
	return `${n} ${n === 1 ? "upload" : "uploads"}`;
}

/** The widget's one sentence. */
export function uploadLabel(report: UploadReport): string {
	switch (report.tone) {
		case "idle":
			return "";
		case "attention":
			return `${files(report.awaiting)} ${report.awaiting === 1 ? "needs" : "need"} your answer`;
		case "active":
			return `Uploading ${report.position} of ${report.total}…`;
		case "success":
			return `${files(report.uploaded)} uploaded`;
		case "noted":
			return `${files(report.uploaded)} uploaded, ${report.noted} with a note`;
		case "failed": {
			// `blocked` is a decision and `error` a failure; neither wears the other's sentence.
			if (report.blocked === 0) return `${uploads(report.failed)} failed`;
			if (report.failed === 0) {
				return `${files(report.blocked)} did not fit your storage`;
			}
			return `${uploads(report.failed + report.blocked)} did not finish`;
		}
	}
}
// #endregion

// #region Time remaining
/** How far back the rate is measured, in milliseconds. Long enough to smooth a burst. */
export const RATE_WINDOW_MS = 10_000;

/** The shortest span a rate is trusted over: one progress event is not a speed. */
const MIN_SPAN_MS = 2_000;

/** Keep the samples inside the rate window, newest last. */
export function pruneSamples(samples: readonly ProgressSample[], now: number): ProgressSample[] {
	return samples.filter((s) => now - s.at <= RATE_WINDOW_MS);
}

/**
 * Seconds until the batch's remaining bytes land at the recent rate, or `null` when there is no
 * honest answer yet: too short a span, no movement, or nothing left.
 */
export function secondsRemaining(
	samples: readonly ProgressSample[],
	remainingBytes: number,
): number | null {
	if (samples.length < 2 || remainingBytes <= 0) return null;
	const first = samples[0];
	const last = samples[samples.length - 1];
	const span = last.at - first.at;
	const moved = last.bytes - first.bytes;
	if (span < MIN_SPAN_MS || moved <= 0) return null;
	return remainingBytes / (moved / (span / 1000));
}

/** "~45s remaining", "~3 min remaining"; never "0s". */
export function remainingLabel(seconds: number): string {
	if (seconds < 60) return `~${Math.max(1, Math.ceil(seconds))}s remaining`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `~${minutes} min remaining`;
	const hours = Math.round(minutes / 60);
	return `~${hours} h remaining`;
}
// #endregion
