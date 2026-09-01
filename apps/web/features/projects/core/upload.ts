import { FilesService } from "@features/files/core/FilesService.ts";
import { createFingerprinter } from "@features/files/core/fingerprint.ts";
import type {
	AssetMetadata,
	AssetOwnerType,
	AssetVisibility,
	ContentFingerprint,
	UploadTicket,
} from "@projective/types/files";

/**
 * upload — turning a device `File` into a `files.items` id, once, for every projects surface that
 * needs one.
 *
 * The chat composer and the submissions explorer both have to do this before their own POST can
 * carry an attachment, because neither `SendProjectMessageSchema` nor `CreateSubmissionSchema`
 * accepts bytes: they accept asset ids. That is the whole reason `/api/files/upload-init` exists —
 * a 500 MB attachment streamed through a Deno handler occupies a request worker for minutes and buys
 * nothing, so the browser PUTs directly at a scoped, short-lived signed URL and the application
 * routes only ever see identifiers.
 *
 * ## The handshake, unchanged
 *
 * `FilesService.uploadInit` → PUT the bytes at `ticket.signedUrl` replaying `ticket.headers` verbatim
 * → `FilesService.uploadComplete`. This is the SAME three steps `UploadDrawer.island.tsx` drives, and
 * this module exists so there is not a second implementation of them to keep in step: the drawer owns
 * the hub's queue, its duplicate prompt and its byte-level progress, and this owns the plain case
 * where a handful of files simply need ids.
 *
 * ## What it deliberately does not do
 *
 * No duplicate PROMPT. The hub can ask a person what to do about a copy they already have; a composer
 * has nowhere to ask and nothing sensible to do with the answer, so the verdict on the ticket is
 * ignored here. The fingerprint is still computed and still sent — that is what the server's dedup
 * index keys on, and omitting it would make every attachment allocate fresh storage against the
 * owner's quota even when the identical file is already in their library.
 *
 * No byte-level progress bar. The surfaces that call this report per-FILE state (queued → uploading →
 * done → failed) on an attachment chip, not a percentage, and reproducing the drawer's
 * `XMLHttpRequest` progress engine here would be exactly the duplicate this module exists to avoid.
 * The transfer therefore uses `fetch`, which is the drawer's own no-progress path.
 *
 * ## Failure is reported, never swallowed
 *
 * A file that does not make it comes back in {@link ProjectUploadOutcome.failures} with its name, its
 * position and why — the caller renders that inline beside the chip it belongs to. Silently dropping
 * one is the worst available outcome: the message sends, looks complete, and is missing the thing it
 * was written about.
 */

// #region Shapes
/** One file that did not become an asset, and the reason it did not. */
export interface ProjectUploadFailure {
	/** Position in the `files` array the caller passed — so a chip can be matched without a name. */
	index: number;
	/** The file's own name, for a message a person can act on. */
	name: string;
	/** What went wrong, already phrased for display. */
	message: string;
}

/**
 * The outcome of a whole drop.
 *
 * `assetIds` holds only the files that landed, in the caller's original order, so it can be spread
 * straight into an `attachmentIds` / `fileIds` payload. A partial success is the normal case, not an
 * error state: three of four attachments arriving is still a message worth sending.
 */
export interface ProjectUploadOutcome {
	assetIds: string[];
	failures: ProjectUploadFailure[];
}

/** How and where a projects attachment is stored. */
export interface ProjectUploadOptions {
	/** The principal the assets belong to — a person, or the team/business acting. */
	ownerType: AssetOwnerType;
	/** That principal's id. */
	ownerId: string;
	/** Destination folder in the owner's library; `null` is the root, which is a real destination. */
	folderId?: string | null;
	/**
	 * Privacy scope at rest. Defaults to `private` on purpose.
	 *
	 * Attaching is what elevates an asset to `link`, and the server does that when the message or the
	 * submission is created — elevation is one-directional and automatic, so uploading `link` here
	 * would widen access to a file whose attachment might never happen (an abandoned composer draft).
	 */
	visibility?: AssetVisibility;
	/**
	 * Extract the media metadata for one file — dimensions, a poster frame, a waveform, a page count.
	 *
	 * A callback rather than a direct import so this module does not depend on the extractor existing,
	 * and so a surface that has no use for a poster frame pays nothing for one. It runs in PARALLEL
	 * with the transfer: a 200 MB video must not wait on a thumbnail before its bytes start moving.
	 */
	metadataFor?: (file: File) => Promise<AssetMetadata | null>;
	/**
	 * How long the completion step will wait on {@link metadataFor} once the bytes have landed.
	 *
	 * A ceiling rather than an unbounded await, because a metadata reader that hangs would hold a
	 * finished upload in `pending_upload` indefinitely — the file would exist and never appear.
	 */
	metadataTimeoutMs?: number;
	/** Abort the whole drop — a cancelled composer, or an unmounting island. */
	signal?: AbortSignal;
	/** How many transfers run at once. Small on purpose; see {@link DEFAULT_CONCURRENCY}. */
	concurrency?: number;
}
// #endregion

// #region Policy
/**
 * How many files move at once.
 *
 * Three rather than one because an attachment set is usually several small files and serialising
 * them makes a drop feel broken; three rather than all of them because a message may carry twenty and
 * a submission a hundred, and twenty simultaneous multi-megabyte PUTs from one tab is how a person's
 * own connection becomes the bottleneck for the page they are still using.
 */
const DEFAULT_CONCURRENCY = 3;

/** The default ceiling on waiting for metadata after the bytes have landed. */
const DEFAULT_METADATA_TIMEOUT_MS = 8_000;

/**
 * Whether this ticket names somewhere bytes can actually go.
 *
 * With `FILES_BACKEND_LIVE` off the fat service mints `signedUrl: "#stub-upload"` — a FRAGMENT, which
 * resolves against the current page, so a PUT at it would reach a Fresh route that does not answer
 * `PUT` and every stubbed attachment would fail. The surface is stub-first and meant to be exercisable
 * with the gate off, so a fragment ticket skips the transfer and goes straight to finalising. Checked
 * structurally rather than by string: an address with no origin and no path is not a destination.
 */
function isStubTicket(ticket: UploadTicket): boolean {
	return ticket.signedUrl.startsWith("#");
}

/** Resolve a promise, or `null` once `ms` has elapsed. The pending work is left to finish alone. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
	return new Promise<T | null>((resolve) => {
		const timer = setTimeout(() => resolve(null), ms);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(null);
			},
		);
	});
}
// #endregion

// #region Transfer
/** The outcome of moving one file's bytes. */
type PutOutcome = { ok: true; etag: string | null } | { ok: false; message: string };

/**
 * PUT the bytes at the ticket's signed URL.
 *
 * The ticket's headers are replayed verbatim because they are part of what the signature covers. A
 * header the browser refuses to let a page set (the forbidden-header list, `content-length` among
 * them) is dropped rather than thrown on — failing a whole transfer over a header the browser sets
 * itself would be a self-inflicted outage.
 */
async function putBytes(
	file: File,
	ticket: UploadTicket,
	signal?: AbortSignal,
): Promise<PutOutcome> {
	if (isStubTicket(ticket)) return { ok: true, etag: null };

	const headers = new Headers();
	for (const [name, value] of Object.entries(ticket.headers)) {
		try {
			headers.set(name, value);
		} catch {
			// A forbidden header name — the browser supplies it.
		}
	}

	try {
		const res = await fetch(ticket.signedUrl, { method: "PUT", headers, body: file, signal });
		if (!res.ok) {
			return { ok: false, message: `Storage refused the upload (${res.status}).` };
		}
		const etag = res.headers.get("etag");
		return { ok: true, etag: etag ? etag.replaceAll('"', "").slice(0, 120) || null : null };
	} catch {
		return { ok: false, message: "The connection dropped while uploading." };
	}
}
// #endregion

// #region The handshake
/** Run one file through init → PUT → complete. Resolves the asset id, or the reason it has none. */
async function uploadOne(
	file: File,
	opts: ProjectUploadOptions,
	fingerprintOf: (file: File) => Promise<ContentFingerprint | null>,
): Promise<{ assetId: string } | { message: string }> {
	if (opts.signal?.aborted) return { message: "Upload cancelled." };

	// Started here, before init, so it overlaps the handshake as well as the transfer — the reader
	// only ever needs to have finished by the time `uploadComplete` is called.
	const metadata = opts.metadataFor
		? opts.metadataFor(file).catch(() => null)
		: Promise.resolve(null);

	const fingerprint = await fingerprintOf(file).catch(() => null);
	if (opts.signal?.aborted) return { message: "Upload cancelled." };

	const init = await FilesService.uploadInit({
		name: file.name,
		mimeType: file.type || "application/octet-stream",
		sizeBytes: file.size,
		fingerprint,
		folderId: opts.folderId ?? null,
		ownerType: opts.ownerType,
		ownerId: opts.ownerId,
		visibility: opts.visibility ?? "private",
	});
	if (!init.ok || !init.data) {
		return { message: init.message ?? "This upload could not be started." };
	}

	const ticket = init.data;
	const put = await putBytes(file, ticket, opts.signal);
	if (!put.ok) return { message: put.message };

	const finalised = await FilesService.uploadComplete({
		assetId: ticket.assetId,
		etag: put.etag,
		// Always sent, never omitted: this path ALWAYS attempts extraction, and the SSOT's `undefined`
		// means "nobody looked", which would be a false report here.
		//
		// `null` therefore covers three outcomes that are indistinguishable to the server and treated
		// alike on purpose — the file was unreadable, the reader threw, or it was still working when
		// the ceiling expired. All three mean the same thing to every consumer: no facts were filed
		// for this asset. Waiting past the ceiling to tell them apart would hold up the upload the
		// viewer is watching in order to refine a distinction nothing acts on.
		metadata: await withTimeout(metadata, opts.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS),
	});
	if (!finalised.ok) {
		return {
			message: finalised.message ??
				"The file uploaded but could not be filed, so it cannot be attached.",
		};
	}

	return { assetId: ticket.assetId };
}

/**
 * Upload every file and return the asset ids the caller's own payload should carry.
 *
 * Results are written positionally and only then compacted, so `assetIds` keeps the caller's order
 * whatever order the transfers actually finish in — a chip list reconciled by position against a set
 * ordered by completion would relabel the wrong files.
 */
export async function uploadForProject(
	files: File[],
	opts: ProjectUploadOptions,
): Promise<ProjectUploadOutcome> {
	if (files.length === 0) return { assetIds: [], failures: [] };

	// Created per drop and disposed at the end: `createFingerprinter` starts a worker lazily, and one
	// held at module scope would run during SSR (where `Worker` does not exist) and would outlive every
	// upload it was made for.
	const fingerprinter = createFingerprinter();
	const landed = new Array<string | null>(files.length).fill(null);
	const failures: ProjectUploadFailure[] = [];

	let next = 0;
	const workers = Array.from(
		{ length: Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, files.length)) },
		async () => {
			while (true) {
				const index = next++;
				const file = files[index];
				if (!file) return;
				const result = await uploadOne(
					file,
					opts,
					(f) => fingerprinter.fingerprint(f, { signal: opts.signal }),
				);
				if ("assetId" in result) landed[index] = result.assetId;
				else failures.push({ index, name: file.name, message: result.message });
			}
		},
	);

	try {
		await Promise.all(workers);
	} finally {
		fingerprinter.dispose();
	}

	failures.sort((a, b) => a.index - b.index);
	return { assetIds: landed.filter((id): id is string => id !== null), failures };
}
// #endregion
