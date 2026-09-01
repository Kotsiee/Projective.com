import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// #region Stylesheet carriers
/**
 * A stylesheet reaches a page ONLY through a client/island bundle — a sheet imported by a server
 * component ships nothing. This drawer renders the shared {@link QuotaMeter} (`.fh-quota`, in
 * `files-hub.css`) as well as its own block, so both sheets are imported HERE rather than relying on
 * a component's own import being collected from a graph it is not in.
 */
import "../styles/files-hub.css";
import "../styles/upload-drawer.css";
// #endregion

import { Drawer, Message, ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";

import { QuotaMeter } from "../components/QuotaMeter.tsx";
import { DuplicatePrompt } from "../components/DuplicatePrompt.tsx";
import { FilesService } from "../core/FilesService.ts";
import { awaitExtraction, extractMetadata } from "../core/media/extract.ts";
import { simFromSeam, subscribeFilesSim } from "../core/files-seam.ts";
import { uploadDrawerOpen } from "../core/upload-drawer-state.ts";
import {
	createFingerprinter,
	degradedKey,
	type Fingerprinter,
	hasSubtleCrypto,
	isHashAborted,
} from "../core/fingerprint.ts";
import {
	clearFinishedUploads,
	commitFiles,
	dequeueUpload,
	items,
	patchUpload,
	quota,
	uploadQueue,
	uploadsActive,
} from "../core/files-state.ts";
import {
	type AssetOwnerType,
	canAccept,
	type ContentFingerprint,
	DEDUP_BATCH_MAX,
	type DedupVerdict,
	type DuplicateResolution,
	type FilesSim,
	type StorageQuota,
	type UploadPhase,
	type UploadTask,
	type UploadTicket,
} from "../types/file-types.ts";

/**
 * UploadDrawer — the queue, and the engine that drains it. The only place on the platform where a
 * file becomes an asset.
 *
 * The footer rig picks files and enqueues them; this drawer owns everything that happens next, in
 * this order and no other:
 *
 *  1. **Fingerprint, before a byte travels.** A digest computed after the upload would answer "you
 *     already had this" once the person has already waited for it, which is not an answer, it is a
 *     receipt. Full SHA-256 under 256 MiB, a head/tail/length SAMPLE above it, and nothing at all in
 *     an insecure context — `crypto.subtle` requires a secure context and is simply absent
 *     otherwise. Hashing runs in `hash-worker.ts` where a Worker can be constructed, and falls back
 *     to this thread where one cannot; the digest is identical either way because both paths call
 *     the same `fingerprintFile`.
 *  2. **Check the batch.** One round trip for the whole drop, per destination folder.
 *  3. **Ask, when there is something to ask about.** A prompt appears only when the server both found
 *     a match AND named it — see {@link needsAnswer}.
 *  4. **Init → PUT → complete.** Bytes go straight at the signed URL, never through an application
 *     route.
 *
 * ## Nothing in this pipeline may fail an upload for a reason that is not the upload's
 *
 * A missing `crypto.subtle`, a hash that throws, a dedup check that 500s and a quota read that times
 * out are all **degradations**: they cost the duplicate prompt or the meter, and the file still
 * uploads. The queue distinguishes `blocked` (a decision — the allowance is full AND enforcement is
 * on) from `error` (a failure) precisely so the two never wear each other's sentence.
 *
 * ## The allowance warns and does not block
 *
 * `canAccept` returns `true` while `StorageQuota.enforced` is false, so the fail-open contract lives
 * in the predicate every caller shares rather than in each call site's memory. The meter states the
 * band; the only refusal this island can produce is the one the server has already said it will make
 * anyway.
 *
 * ## Two owners raise it, and they share a module rather than a prop
 *
 * The drawer opens itself when the queue gains work, and the rig's affordance reopens it afterwards.
 * That flag is {@link uploadDrawerOpen} in `core/upload-drawer-state.ts`, NOT a prop: both halves are
 * islands, and a `Signal` passed across that boundary arrives as a different instance — the drawer
 * opened while the rig's copy stayed `false`. See the note on that module.
 *
 * ## What it never does
 *
 * No arithmetic on the allowance — `usedMib`, `remainingMib` and `pct` are server-computed and this
 * island renders them, exactly as `/wallet` renders money. No Supabase, no fixtures: every call goes
 * through the thin {@link FilesService} to `/api/files/*`.
 */

// #region Props
export interface UploadDrawerProps {
	/** The principal the upload is billed to and stored under. */
	ownerType: AssetOwnerType;
	ownerId: string;
}
// #endregion

// #region Constants
/**
 * How many files upload at once.
 *
 * Two, not one (a single stream leaves most of a connection idle) and not eight (browsers cap
 * per-host connections anyway, and eight progress bars all creeping is a worse report than two
 * finishing).
 */
const UPLOAD_CONCURRENCY = 2;

/**
 * The privacy scope a hub upload is created with.
 *
 * `private` is the SSOT's default and the only safe one: elevation to `link`/`public` is automatic at
 * the moment an asset is ATTACHED somewhere that requires it, and is one-directional. Starting
 * anywhere else would grant access nobody asked for and that nothing would ever narrow again.
 */
const UPLOAD_VISIBILITY = "private" as const;
// #endregion

// #region XHR surface
/**
 * The `XMLHttpRequest` surface this module uses, declared structurally.
 *
 * `fetch` cannot report upload progress — there is no request-side stream event — and an upload with
 * no progress is the one transfer where a person genuinely cannot tell working from hung. XHR is the
 * only API that reports it. It is typed through a minimal interface rather than the DOM lib's own,
 * for the same reason `hash-worker.ts` types its scope structurally: the cast keeps a plain
 * `deno check` of the whole app working without pinning a lib for every other module.
 */
interface UploadProgressEvent {
	lengthComputable: boolean;
	loaded: number;
	total: number;
}

interface UploadRequest {
	open(method: string, url: string, async: boolean): void;
	setRequestHeader(name: string, value: string): void;
	send(body: Blob): void;
	abort(): void;
	getResponseHeader(name: string): string | null;
	readonly status: number;
	readonly upload: { onprogress: ((event: UploadProgressEvent) => void) | null };
	onload: (() => void) | null;
	onerror: (() => void) | null;
	onabort: (() => void) | null;
}

/** Construct one, or `null` where the constructor is absent (SSR, or an exotic embedding). */
function newUploadRequest(): UploadRequest | null {
	const ctor = (globalThis as { XMLHttpRequest?: new () => UploadRequest }).XMLHttpRequest;
	if (!ctor) return null;
	try {
		return new ctor();
	} catch {
		return null;
	}
}

/** The outcome of moving the bytes. Cancellation is its own member — it is not a failure. */
type PutOutcome =
	| { kind: "ok"; etag: string | null }
	| { kind: "aborted" }
	| { kind: "error"; message: string };

/**
 * Whether this ticket names a real upload target.
 *
 * While `FILES_BACKEND_LIVE` is off the fat service mints `signedUrl: "#stub-upload"` — a FRAGMENT,
 * which resolves against the current page, so a PUT at it would reach a Fresh route that does not
 * answer `PUT` and every stubbed upload would end in `error`. The whole surface is stub-first and
 * meant to be exercisable with the gate off, so a fragment ticket skips the transfer and finalises
 * the row instead. It is checked structurally rather than by string, because that is the property
 * that matters: an address with no origin and no path is not somewhere bytes can go.
 */
function isStubTicket(ticket: UploadTicket): boolean {
	return ticket.signedUrl.startsWith("#");
}
// #endregion

// #region Pure helpers
/** Whether a phase is final — nothing further will happen to this task on its own. */
function isSettled(phase: UploadPhase): boolean {
	return phase === "done" || phase === "error" || phase === "cancelled" || phase === "blocked";
}

/**
 * Whether a verdict actually warrants a question.
 *
 * A non-`new` verdict carrying no `existing` is deliberately treated as `new`: a prompt that claims a
 * duplicate without naming it asks the person to guess, and the safe guess is always "upload it
 * again" — so the prompt would cost a decision and save nothing. Uploading is the honest fallback.
 */
function needsAnswer(verdict: DedupVerdict | null): verdict is DedupVerdict {
	return verdict !== null && verdict.verdict !== "new" && verdict.existing !== null;
}

/** Whether this task is parked waiting for a person rather than for the network. */
function awaitsDecision(task: UploadTask): boolean {
	return task.phase === "ready" && task.resolution === null && needsAnswer(task.verdict);
}

/** The queue mark. Shape carries the state, so it survives a colour-blindness overlay. */
function phaseIcon(task: UploadTask): IconName {
	switch (task.phase) {
		case "queued":
			return "clock";
		case "hashing":
			return "hourglass";
		case "checking":
			return "search";
		case "ready":
			return awaitsDecision(task) ? "help" : "upload";
		case "uploading":
			return "upload";
		case "finalising":
			return "hourglass";
		case "done":
			return "success";
		case "blocked":
			return "lock";
		case "error":
			return "error";
		case "cancelled":
			return "close";
	}
}

/**
 * The queue caption, in the reader's terms rather than the pipeline's.
 *
 * "Checking for a copy you already have" says what the round trip is FOR; "deduplicating" says what
 * the engineer called it. The phases stay separate here for the reason the SSOT keeps them separate:
 * collapsing them into "uploading" reports a 400 MB file as stuck at 0% for the twenty seconds it is
 * actually being read.
 */
function phaseLabel(task: UploadTask): string {
	switch (task.phase) {
		case "queued":
			return "Waiting";
		case "hashing":
			return "Reading the file";
		case "checking":
			return "Checking for a copy you already have";
		case "ready":
			if (awaitsDecision(task)) return "Needs your decision";
			return task.resolution === "replace" ? "Ready to replace" : "Ready";
		case "uploading":
			return "Uploading";
		case "finalising":
			return "Finishing up";
		case "done":
			return task.resolution === "link_existing"
				? "Used the copy you already had"
				: task.resolution === "replace"
				? "Replaced the older file"
				: "Uploaded";
		case "blocked":
			return "Not uploaded";
		case "error":
			return "Failed";
		case "cancelled":
			return "Cancelled";
	}
}

/** Whether the row should draw a progress track at all. */
function showsProgress(phase: UploadPhase): boolean {
	return phase === "hashing" || phase === "checking" || phase === "uploading" ||
		phase === "finalising";
}

/**
 * Read the storage provider's receipt.
 *
 * Quoted by the HTTP spec and capped to the SSOT's 120 characters; `null` whenever the header is
 * absent or not exposed to script by CORS, which `UploadCompleteSchema` models rather than rejects.
 */
function readEtag(request: UploadRequest): string | null {
	let raw: string | null = null;
	try {
		raw = request.getResponseHeader("etag");
	} catch {
		return null;
	}
	if (!raw) return null;
	return raw.replaceAll('"', "").slice(0, 120) || null;
}
// #endregion

export default function UploadDrawer(props: UploadDrawerProps): JSX.Element {
	const { ownerType, ownerId } = props;

	// #region Local state
	/**
	 * The allowance shown in the drawer, held LOCALLY.
	 *
	 * `files-state.quota` describes the LOCATION the body is listing, which may be a mounted drive
	 * that consumes none. The meter here is about the principal being uploaded to, so it is read for
	 * that principal and never written back over the page's copy.
	 */
	const allowance = useSignal<StorageQuota | null>(quota.peek());
	/** A failed allowance read. Reported, never swallowed — and never a reason to refuse an upload. */
	const quotaNote = useSignal<string | null>(null);
	/** A failed duplicate pre-flight. The files still upload; the person is told the check did not run. */
	const dedupNote = useSignal<string | null>(null);
	/** This browser cannot digest at all — an insecure context has no `crypto.subtle`. */
	const hashingUnavailable = useSignal(false);
	/** A digest threw. Distinct from the above: the API exists and the read went wrong. */
	const hashingFailed = useSignal(false);

	const fingerprinterRef = useRef<Fingerprinter | null>(null);
	/** One abort controller per in-flight hash, so a cancel reaches exactly the file it names. */
	const hashAborts = useRef(new Map<string, AbortController>());
	/** One request per in-flight upload, for the same reason. */
	const transfers = useRef(new Map<string, UploadRequest>());
	/** Ids the pipeline has already claimed — the guard that makes the queue watcher idempotent. */
	const claimed = useRef(new Set<string>());
	/** Whether a drain is already running; a second one would double-start the same batch. */
	const draining = useRef(false);
	const simRef = useRef<FilesSim | undefined>(undefined);
	// #endregion

	// #region Queue access
	/** The current row for an id — re-read rather than closed over, because every step patches it. */
	function taskOf(id: string): UploadTask | null {
		return uploadQueue.peek().find((task) => task.id === id) ?? null;
	}

	function fingerprinter(): Fingerprinter {
		if (!fingerprinterRef.current) fingerprinterRef.current = createFingerprinter();
		return fingerprinterRef.current;
	}

	/** Release the worker once nothing needs it. Recreated on the next drop; never held idle. */
	function releaseFingerprinter(): void {
		fingerprinterRef.current?.dispose();
		fingerprinterRef.current = null;
	}
	// #endregion

	// #region Step 1 — fingerprint
	/**
	 * Digest one file.
	 *
	 * Ends with the task either `cancelled` or carrying a `fingerprint` (possibly `null`). It never
	 * ends the task in `error` for a hashing reason: losing the duplicate prompt is a degraded
	 * experience, refusing the upload is a broken product.
	 */
	async function hashOne(task: UploadTask): Promise<void> {
		if (!task.file) {
			patchUpload(task.id, {
				phase: "error",
				error: "The browser no longer has this file. Choose it again.",
			});
			return;
		}
		if (!hasSubtleCrypto()) {
			hashingUnavailable.value = true;
			patchUpload(task.id, { fingerprint: null, progress: 0 });
			return;
		}

		patchUpload(task.id, { phase: "hashing", progress: 0 });
		const controller = new AbortController();
		hashAborts.current.set(task.id, controller);
		try {
			const fingerprint = await fingerprinter().fingerprint(task.file, {
				signal: controller.signal,
				onProgress: (fraction) => patchUpload(task.id, { progress: fraction }),
			});
			if (fingerprint === null) hashingUnavailable.value = true;
			patchUpload(task.id, { fingerprint, progress: 1 });
		} catch (err) {
			if (isHashAborted(err)) {
				patchUpload(task.id, { phase: "cancelled", progress: 0 });
				return;
			}
			hashingFailed.value = true;
			patchUpload(task.id, { fingerprint: null, progress: 1 });
		} finally {
			hashAborts.current.delete(task.id);
		}
	}
	// #endregion

	// #region Step 2 — duplicate pre-flight
	/**
	 * Ask the index about one folder's worth of the drop, in a single round trip.
	 *
	 * Verdicts come back POSITIONALLY aligned with the fingerprints sent, so the arrays are built in
	 * one pass and read back by index — a second pass that filtered differently is how a verdict ends
	 * up attached to the wrong file.
	 *
	 * Every task leaves this function in `ready`, whatever happened: unhashable, unchecked and
	 * checked-and-clear are three different reasons to upload normally, not three reasons to stop.
	 */
	async function checkGroup(group: readonly UploadTask[]): Promise<void> {
		const batched: UploadTask[] = [];
		const fingerprints: ContentFingerprint[] = [];
		const names: string[] = [];

		for (const task of group) {
			// A group is a subset of a batch that was already sliced to the maximum, so the ceiling is
			// unreachable today. It is written anyway: the payload has a hard bound, and a silent 422 on
			// the fifty-first file of a drop is a worse failure than that file going unchecked.
			if (task.fingerprint === null || batched.length >= DEDUP_BATCH_MAX) {
				patchUpload(task.id, { phase: "ready", verdict: null, progress: 0 });
				continue;
			}
			batched.push(task);
			fingerprints.push(task.fingerprint);
			names.push(task.name);
		}
		if (batched.length === 0) return;

		for (const task of batched) patchUpload(task.id, { phase: "checking", progress: 0 });

		const res = await FilesService.dedupCheck({
			fingerprints,
			names,
			folderId: batched[0].folderId,
		}, simRef.current);

		if (res.ok && res.data) {
			const verdicts = res.data;
			dedupNote.value = null;
			batched.forEach((task, index) => {
				patchUpload(task.id, { verdict: verdicts[index] ?? null, phase: "ready", progress: 0 });
			});
			return;
		}

		// The check is a courtesy the server repeats regardless, so a failure here loses the prompt and
		// nothing else. Reported rather than swallowed.
		dedupNote.value = res.message ??
			"Duplicate checking is unavailable right now — these files will upload normally.";
		for (const task of batched) {
			patchUpload(task.id, { verdict: null, phase: "ready", progress: 0 });
		}
	}
	// #endregion

	// #region Steps 3–4 — transfer
	/**
	 * PUT the bytes at the ticket's signed URL, reporting progress.
	 *
	 * The ticket's headers are replayed verbatim because they are part of what the signature covers;
	 * a header the browser refuses to set (the forbidden-header list) is skipped rather than thrown,
	 * since failing the whole transfer over `content-length` would be a self-inflicted outage.
	 */
	function putBytes(
		file: File,
		ticket: UploadTicket,
		id: string,
		onProgress: (fraction: number) => void,
	): Promise<PutOutcome> {
		// No bytes are moved, and none are claimed to have been: the row goes on to `finalising` with
		// an indeterminate track rather than a fabricated 100%. See {@link isStubTicket}.
		if (isStubTicket(ticket)) return Promise.resolve({ kind: "ok", etag: null });

		const request = newUploadRequest();
		if (!request) return putViaFetch(file, ticket);

		return new Promise<PutOutcome>((resolve) => {
			let done = false;
			const settle = (outcome: PutOutcome) => {
				if (done) return;
				done = true;
				transfers.current.delete(id);
				resolve(outcome);
			};

			transfers.current.set(id, request);
			try {
				request.open("PUT", ticket.signedUrl, true);
				for (const [name, value] of Object.entries(ticket.headers)) {
					try {
						request.setRequestHeader(name, value);
					} catch {
						// A forbidden header name — the browser sets it itself.
					}
				}
			} catch {
				settle({ kind: "error", message: "The upload address was rejected by the browser." });
				return;
			}

			request.upload.onprogress = (event) => {
				if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
			};
			request.onload = () => {
				if (request.status >= 200 && request.status < 300) {
					settle({ kind: "ok", etag: readEtag(request) });
					return;
				}
				settle({
					kind: "error",
					message: `Storage refused the upload (${request.status}). Please try again.`,
				});
			};
			request.onerror = () =>
				settle({ kind: "error", message: "The connection dropped while uploading." });
			request.onabort = () => settle({ kind: "aborted" });

			try {
				request.send(file);
			} catch {
				settle({ kind: "error", message: "The upload could not be started." });
			}
		});
	}

	/**
	 * The transfer without progress, for an environment with no `XMLHttpRequest`.
	 *
	 * Theoretical in a browser, and kept anyway: the alternative to a progressless upload is no
	 * upload. The row draws an indeterminate track because 0% reported forever is a figure, and a
	 * wrong one.
	 */
	async function putViaFetch(file: File, ticket: UploadTicket): Promise<PutOutcome> {
		try {
			const res = await fetch(ticket.signedUrl, {
				method: "PUT",
				headers: ticket.headers,
				body: file,
			});
			if (!res.ok) {
				return {
					kind: "error",
					message: `Storage refused the upload (${res.status}). Please try again.`,
				};
			}
			const etag = res.headers.get("etag");
			return { kind: "ok", etag: etag ? etag.replaceAll('"', "").slice(0, 120) || null : null };
		} catch {
			return { kind: "error", message: "The connection dropped while uploading." };
		}
	}

	/**
	 * Init → PUT → complete, for one task.
	 *
	 * Every branch ends the task in a stated phase; none of them ends in silence. A refetch or a
	 * handshake step with no `else` is how a person is left watching a bar that will never move.
	 */
	async function uploadOne(id: string): Promise<void> {
		const task = taskOf(id);
		if (!task || isSettled(task.phase)) return;
		if (!task.file) {
			patchUpload(id, {
				phase: "error",
				error: "The browser no longer has this file. Choose it again.",
			});
			return;
		}

		const limit = allowance.value;
		if (limit && !canAccept(limit, task.sizeBytes)) {
			// The only refusal this island produces, and only because the server has already said it
			// will refuse: `canAccept` returns true for the whole fail-open period.
			patchUpload(id, {
				phase: "blocked",
				progress: 0,
				error:
					`This file needs ${task.sizeLabel} and your allowance is full. Free up space or upgrade, then try again.`,
			});
			return;
		}

		patchUpload(id, { phase: "uploading", progress: 0, error: null });

		/**
		 * Started here and awaited after the transfer, so reading the file happens ALONGSIDE moving it.
		 * A 200 MB video must not wait on a poster frame — the bytes are the thing the person is
		 * waiting for, and a placeholder that arrives with them costs nothing.
		 *
		 * Inside `uploadOne` rather than at the moment the queue is claimed, so it inherits
		 * {@link UPLOAD_CONCURRENCY}: a fifty-file drop would otherwise start fifty video decodes at
		 * once and make the transfers it was meant to overlap slower than doing nothing.
		 */
		const extraction = extractMetadata(task.file);

		const init = await FilesService.uploadInit({
			name: task.name,
			mimeType: task.mimeType,
			sizeBytes: task.sizeBytes,
			fingerprint: task.fingerprint,
			folderId: task.folderId,
			ownerType,
			ownerId,
			visibility: UPLOAD_VISIBILITY,
		}, simRef.current);

		if (!init.ok || !init.data) {
			patchUpload(id, {
				phase: "error",
				error: init.message ?? "This upload could not be started.",
			});
			return;
		}

		const ticket = init.data;
		patchUpload(id, { assetId: ticket.assetId, ticket });

		const put = await putBytes(task.file, ticket, id, (fraction) => {
			patchUpload(id, { progress: fraction });
		});
		if (put.kind === "aborted") {
			patchUpload(id, { phase: "cancelled" });
			return;
		}
		if (put.kind === "error") {
			patchUpload(id, { phase: "error", error: put.message });
			return;
		}

		patchUpload(id, { phase: "finalising", progress: 1 });
		// Bounded: an extraction still running when the bytes have landed is worth less than the upload
		// finishing, so it falls back to a `generic` row carrying the reason rather than holding the
		// queue open. It never rejects and never throws — the file is already safe by this point.
		const metadata = await awaitExtraction(extraction);
		const finalised = await FilesService.uploadComplete({
			assetId: ticket.assetId,
			etag: put.etag,
			metadata,
		});
		if (!finalised.ok) {
			patchUpload(id, {
				phase: "error",
				error: finalised.message ??
					"The file uploaded but could not be filed. It will not appear until this is retried.",
			});
			return;
		}

		patchUpload(id, { phase: "done", progress: 1, error: null });
		await settleReplacement(id);
		await refreshQuota();
		// The library the body is showing has changed — it is the single fetch owner, so it re-reads.
		commitFiles();
	}

	/**
	 * Finish a `replace` by removing what it replaced.
	 *
	 * **This is a compose, not an in-place overwrite, and the prompt says so.** The files contract has
	 * no replace endpoint: the new bytes become a new asset and the old one is soft-deleted (nothing
	 * is hard-deleted, root CLAUDE.md §5), which means the id changes and a share link to the old
	 * asset stops resolving. `DuplicatePrompt` states both consequences before the person chooses.
	 *
	 * A failed removal leaves BOTH files rather than losing one, and says so on the row.
	 */
	async function settleReplacement(id: string): Promise<void> {
		const task = taskOf(id);
		const replaced = task?.resolution === "replace" ? task.verdict?.existing?.id ?? null : null;
		if (!replaced) return;
		const res = await FilesService.remove({ assetIds: [replaced] });
		if (res.ok) return;
		patchUpload(id, {
			error: res.message ??
				"Your file uploaded, but the older copy could not be removed — both are in your library.",
		});
	}
	// #endregion

	// #region The drain
	/** Run `ids` through `run` at {@link UPLOAD_CONCURRENCY}, in order, without overlapping a task. */
	async function runPool(
		ids: readonly string[],
		run: (id: string) => Promise<void>,
	): Promise<void> {
		let cursor = 0;
		const workers = Array.from(
			{ length: Math.min(UPLOAD_CONCURRENCY, ids.length) },
			async () => {
				while (cursor < ids.length) {
					const id = ids[cursor++];
					await run(id);
				}
			},
		);
		await Promise.all(workers);
	}

	/**
	 * Carry one batch from picked to filed.
	 *
	 * Hashing is sequential on purpose: there is one worker, so parallel digests would contend for
	 * the same thread and report four bars crawling instead of one finishing. The transfers that
	 * follow are the part worth overlapping.
	 */
	async function processBatch(batch: readonly UploadTask[]): Promise<void> {
		for (const task of batch) {
			const live = taskOf(task.id);
			if (!live || isSettled(live.phase)) continue;
			await hashOne(live);
		}

		// One check per DESTINATION: `name_collision` is scoped to a folder, so a batch spanning two
		// folders asked as one question would answer both against the first folder's contents.
		const groups = new Map<string, UploadTask[]>();
		for (const task of batch) {
			const live = taskOf(task.id);
			if (!live || isSettled(live.phase)) continue;
			const key = live.folderId ?? "";
			const group = groups.get(key);
			if (group) group.push(live);
			else groups.set(key, [live]);
		}
		for (const group of groups.values()) await checkGroup(group);

		const ready = batch
			.map((task) => taskOf(task.id))
			.filter((task): task is UploadTask =>
				task !== null && task.phase === "ready" && !awaitsDecision(task)
			)
			.map((task) => task.id);
		await runPool(ready, uploadOne);
	}

	/**
	 * Start every task nobody has claimed yet, one batch at a time.
	 *
	 * Re-entrant by guard rather than by luck: the queue signal changes on every patch, so the watcher
	 * fires constantly, and `claimed` is what makes a second call a no-op instead of a second upload
	 * of the same file.
	 */
	async function drain(): Promise<void> {
		if (draining.current) return;
		draining.current = true;
		try {
			for (;;) {
				const pending = uploadQueue.peek().filter(
					(task) => task.phase === "queued" && !claimed.current.has(task.id),
				);
				if (pending.length === 0) break;
				const batch = pending.slice(0, DEDUP_BATCH_MAX);
				for (const task of batch) claimed.current.add(task.id);
				await processBatch(batch);
			}
		} finally {
			draining.current = false;
			if (!uploadQueue.peek().some((task) => task.phase === "hashing")) releaseFingerprinter();
		}
	}
	// #endregion

	// #region Person-driven transitions
	/** Apply an answer to a duplicate prompt. `cancel` and `link_existing` move no bytes. */
	function resolve(id: string, resolution: DuplicateResolution): void {
		patchUpload(id, { resolution });
		if (resolution === "cancel") {
			patchUpload(id, { phase: "cancelled", progress: 0 });
			return;
		}
		if (resolution === "link_existing") {
			// Nothing is uploaded and nothing on the server changes — the asset the person chose is
			// already exactly where it was. The row states which copy is being used.
			const existing = taskOf(id)?.verdict?.existing ?? null;
			patchUpload(id, {
				phase: "done",
				progress: 1,
				assetId: existing?.id ?? null,
				error: null,
			});
			return;
		}
		void uploadOne(id);
	}

	/** Stop one task wherever it is. Cancelling is a decision, so it never reads as a failure. */
	function cancel(id: string): void {
		hashAborts.current.get(id)?.abort();
		const transfer = transfers.current.get(id);
		if (transfer) {
			try {
				transfer.abort();
			} catch {
				// Already finished — the settled outcome stands.
			}
		}
		patchUpload(id, { phase: "cancelled", progress: 0, error: null });
	}

	/** Try a failed transfer again from the handshake, keeping the digest and the verdict. */
	function retry(id: string): void {
		patchUpload(id, { phase: "ready", progress: 0, error: null });
		void uploadOne(id);
	}

	function cancelAll(): void {
		for (const task of uploadsActive.peek()) cancel(task.id);
	}
	// #endregion

	// #region Allowance
	/** Re-read the allowance. A failure keeps the last known figures and says the read failed. */
	async function refreshQuota(): Promise<void> {
		const res = await FilesService.quota(ownerType, ownerId, simRef.current);
		if (res.ok && res.data) {
			allowance.value = res.data;
			quotaNote.value = null;
			return;
		}
		quotaNote.value = res.message ?? "Your storage allowance could not be read just now.";
	}
	// #endregion

	// #region Mount
	useEffect(() => {
		simRef.current = simFromSeam();
		const unsubscribe = subscribeFilesSim((sim) => {
			simRef.current = sim;
			// The allowance is SERVER-derived, so a simulated band only exists once it is asked for
			// again — a re-render would relabel the same figures.
			void refreshQuota();
		});

		/**
		 * Leaving mid-upload loses the transfer, so the browser asks first. Deliberately gated on
		 * ACTIVE uploads: a queue of finished rows is a record, not work in progress, and prompting
		 * over it would train people to dismiss the prompt that matters.
		 */
		const guardUnload = (event: Event) => {
			if (uploadsActive.peek().length === 0) return;
			event.preventDefault();
			// Older engines need the assignment as well as the prevented default. Cast through
			// `unknown` because the DOM lib types the legacy `Event.returnValue` as a boolean, while
			// `beforeunload` is the one event for which the spec takes a string.
			(event as unknown as { returnValue: string }).returnValue = "";
		};
		globalThis.addEventListener("beforeunload", guardUnload);

		return () => {
			unsubscribe();
			globalThis.removeEventListener("beforeunload", guardUnload);
			releaseFingerprinter();
		};
	}, []);

	/** Start anything newly enqueued, and surface the drawer that is about to report on it. */
	useSignalEffect(() => {
		const pending = uploadQueue.value.filter(
			(task) => task.phase === "queued" && !claimed.current.has(task.id),
		);
		if (pending.length === 0) return;
		uploadDrawerOpen.value = true;
		void drain();
	});

	/** Read the allowance whenever the drawer is opened, so the meter is never a stale figure. */
	useSignalEffect(() => {
		if (!uploadDrawerOpen.value) return;
		void refreshQuota();
	});
	// #endregion

	// #region Derived
	const queue = uploadQueue.value;
	const active = uploadsActive.value.length;
	const finished = queue.filter((task) => task.phase === "done").length;
	const settled = queue.filter((task) => isSettled(task.phase)).length;

	/**
	 * The degraded "have you got one of these already?" lookup.
	 *
	 * Used ONLY when there is no digest to check with. It matches on name and exact size within the
	 * same folder, which is weaker than a sampled digest by a wide margin — so it produces a NOTE and
	 * never a verdict, never a prompt and never a blocked upload. Claiming a duplicate from a name is
	 * how the wrong file gets discarded.
	 */
	function degradedMatch(task: UploadTask): string | null {
		if (task.fingerprint !== null) return null;
		const key = degradedKey(task.name, task.sizeBytes);
		const match = items.value.find(
			(asset) =>
				asset.folderId === task.folderId && degradedKey(asset.name, asset.sizeBytes) === key,
		);
		return match
			? "A file with this name and size is already in this folder. It could not be compared byte for byte in this browser."
			: null;
	}
	// #endregion

	// #region Row
	function row(task: UploadTask): JSX.Element {
		const awaiting = awaitsDecision(task);
		const note = task.error ??
			(task.phase === "ready" || task.phase === "queued" ? degradedMatch(task) : null);
		const pct = Math.round(Math.min(1, Math.max(0, task.progress)) * 100);
		// 0% during a transfer means "nothing reported yet", not "none of it has moved" — a determinate
		// bar there would be a figure, and a wrong one.
		const indeterminate = task.phase === "checking" || task.phase === "finalising" ||
			(task.phase === "uploading" && pct === 0);

		return (
			<li class="fh-upl__row" data-phase={task.phase} key={task.id}>
				<span class="fh-upl__mark" aria-hidden="true">
					<Icon name={phaseIcon(task)} size="xs" />
				</span>

				<div class="fh-upl__main">
					<p class="fh-upl__name">{task.name}</p>
					<p class="fh-upl__meta">
						<span class="fh-upl__size">{task.sizeLabel}</span>
						<span class="fh-upl__phase">{phaseLabel(task)}</span>
					</p>

					{showsProgress(task.phase)
						? (
							<ProgressBar
								class="fh-upl__bar"
								mode={indeterminate ? "indeterminate" : "determinate"}
								value={pct}
								severity={task.phase === "uploading" ? "primary" : "secondary"}
								aria-label={`${phaseLabel(task)} — ${task.name}`}
							/>
						)
						: null}

					{note ? <p class="fh-upl__note">{note}</p> : null}

					{awaiting && task.verdict && task.verdict.existing
						? (
							<DuplicatePrompt
								task={task}
								outcome={task.verdict.verdict === "exact_duplicate"
									? "exact_duplicate"
									: "name_collision"}
								existing={task.verdict.existing}
								onResolve={(resolution) => resolve(task.id, resolution)}
							/>
						)
						: null}
				</div>

				<div class="fh-upl__rowactions">
					{task.phase === "error"
						? (
							<Tooltip content={`Try ${task.name} again`} placement="top">
								<Button
									variant="text"
									size="sm"
									iconOnly
									icon={<Icon name="refresh" />}
									aria-label={`Try ${task.name} again`}
									onClick={() => retry(task.id)}
								/>
							</Tooltip>
						)
						: null}
					{isSettled(task.phase)
						? (
							<Tooltip content={`Remove ${task.name} from this list`} placement="top">
								<Button
									variant="text"
									size="sm"
									iconOnly
									icon={<Icon name="close" />}
									aria-label={`Remove ${task.name} from this list`}
									onClick={() => dequeueUpload(task.id)}
								/>
							</Tooltip>
						)
						: (
							<Tooltip content={`Stop uploading ${task.name}`} placement="top">
								<Button
									variant="text"
									size="sm"
									severity="secondary"
									iconOnly
									icon={<Icon name="close" />}
									aria-label={`Stop uploading ${task.name}`}
									onClick={() => cancel(task.id)}
								/>
							</Tooltip>
						)}
				</div>
			</li>
		);
	}
	// #endregion

	return (
		<Drawer visible={uploadDrawerOpen} position="right" header="Uploads" class="fh-upl">
			<div class="fh-upl__body">
				<section class="fh-upl__allowance" aria-label="Storage allowance">
					<QuotaMeter quota={allowance.value} />
					{quotaNote.value ? <p class="fh-upl__note" role="status">{quotaNote.value}</p> : null}
				</section>

				{hashingUnavailable.value
					? (
						<Message
							severity="info"
							size="sm"
							class="fh-upl__message"
							text="Duplicate checking needs a secure connection, so it is off in this browser. Files still upload normally."
						/>
					)
					: null}
				{hashingFailed.value
					? (
						<Message
							severity="info"
							size="sm"
							class="fh-upl__message"
							text="Some files could not be read for comparison, so they were not checked against your library. They still upload normally."
						/>
					)
					: null}
				{dedupNote.value
					? (
						<Message
							severity="warning"
							size="sm"
							class="fh-upl__message"
							closable
							onClose={() => (dedupNote.value = null)}
							text={dedupNote.value}
						/>
					)
					: null}

				{queue.length === 0
					? (
						<p class="fh-upl__empty" role="status">
							Nothing is uploading. Choose <strong>Upload</strong> in the action bar to add files.
						</p>
					)
					: (
						<>
							<p class="fh-upl__summary" role="status">
								{active > 0
									? `${active} in progress · ${finished} uploaded`
									: `${finished} of ${queue.length} uploaded`}
							</p>
							<ul class="fh-upl__list">{queue.map(row)}</ul>
						</>
					)}
			</div>

			{queue.length > 0
				? (
					<div class="fh-upl__foot">
						{active > 0
							? <Button variant="text" size="sm" label="Stop all" onClick={cancelAll} />
							: null}
						{settled > 0
							? (
								<Button
									variant="text"
									size="sm"
									severity="secondary"
									label="Clear finished"
									onClick={() => clearFinishedUploads()}
								/>
							)
							: null}
					</div>
				)
				: null}
		</Drawer>
	);
}
