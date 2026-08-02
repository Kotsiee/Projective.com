/**
 * Composer draft types — the ephemeral, client-only shapes for a channel Chat composer draft
 * (text · attachments · a single voice memo). These are *draft* projections held in island signals
 * until the message is sent; the persisted message shape lands with the live messaging backend, so
 * no Zod SSOT (`@projective/types`) entry is warranted yet — root CLAUDE.md §1 governs *persisted*
 * schemas, not transient client state.
 */

// #region Attachments
/** How an attachment preview renders: the real image, a video thumbnail, or a file-type glyph. */
export type AttachmentKind = "image" | "video" | "file";

/** A single staged file (drag-drop / device upload / paste) shown as a card above the input. */
export interface DraftAttachment {
	/** Stable client id (drives the keyed list + removal). */
	id: string;
	/** The underlying file (sent as-is when the live backend lands). */
	file: File;
	name: string;
	/** Size in bytes. */
	size: number;
	/** Lower-cased extension without the dot (e.g. `pdf`, `png`) — drives the file glyph. */
	ext: string;
	kind: AttachmentKind;
	/** Object URL for image/video previews (`undefined` for generic files); revoked on removal. */
	previewUrl?: string;
}
// #endregion

// #region Pasted text
/**
 * A large pasted block collapsed into a document chip above the input (the way Claude collapses long
 * pastes) rather than letting it stretch the textarea. Re-expanded into the outgoing message on send.
 */
export interface PastedBlock {
	id: string;
	text: string;
	chars: number;
	lines: number;
}
// #endregion

// #region Voice
/**
 * The voice-recorder lifecycle phase.
 *
 * `inactive → requesting → recording ⇄ paused → recorded` (back to `inactive` on discard/reset/error).
 * `paused` is a real capture state, not a UI flag: `MediaRecorder` holds the encoder open, the elapsed
 * clock is frozen, and amplitude sampling halts so a pause records no silence bars.
 */
export type RecorderPhase = "inactive" | "requesting" | "recording" | "paused" | "recorded";

/**
 * The viewer's microphone permission as reported by the Permissions API, or what we have been able to
 * infer. `unknown` is the honest default — Firefox rejects a `"microphone"` permission query outright,
 * so an absent answer must never be read as `denied`.
 */
export type MicPermission = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

/**
 * Why capture failed. The distinction that earns its keep is `denied` vs `blocked`: a dismissed prompt
 * is recoverable by pressing the mic again, whereas a persisted block means the next press will do
 * nothing at all — so only `blocked` is worth spending instructions on.
 */
export type RecorderErrorKind =
	| "unsupported"
	| "denied"
	| "blocked"
	| "no_device"
	| "device_lost"
	| "in_use"
	| "too_large"
	| "failed";

/** A capture failure, split so the surface can render a heading, a cause, and a recovery path. */
export interface RecorderError {
	kind: RecorderErrorKind;
	/** The one-line statement of what happened. */
	title: string;
	/** Optional elaboration — why, or what was kept. */
	detail?: string;
	/** Actionable, browser-specific recovery steps. Present only when the viewer must leave the page. */
	help?: string;
}

/**
 * A finished voice-memo draft: the recorded blob + a normalised amplitude envelope. The visualiser
 * resamples {@link AudioDraft.peaks} to a fixed bar count that spans the exact input width.
 */
export interface AudioDraft {
	blob: Blob;
	/** Object URL for playback; revoked on discard/send. */
	url: string;
	durationMs: number;
	/** Normalised 0..1 peaks captured during recording (one per sample tick). */
	peaks: number[];
	/** The container the UA actually encoded to (`audio/webm;codecs=opus`, `audio/mp4`, …). */
	mimeType: string;
	/** Encoded size in bytes — checked against the upload ceiling before the memo may be sent. */
	bytes: number;
}
// #endregion

// #region Outgoing payload
/**
 * The voice memo as it leaves the composer: a real {@link File} plus the {@link MessageAudio}-shaped
 * projection the message bubble renders from. `peaks` is already resampled to the persisted cap, and
 * `durationLabel` is pre-formatted, so no consumer downstream repeats clock or envelope math.
 */
export interface VoicePayload {
	file: File;
	durationMs: number;
	/** Pre-formatted `m:ss`, matching the persisted `MessageAudio.durationLabel` convention. */
	durationLabel: string;
	/** Normalised 0..1 envelope, resampled to at most `MAX_AUDIO_PEAKS`. */
	peaks: number[];
}

/**
 * The assembled outgoing draft handed to the host on send. Text and voice are mutually exclusive by
 * construction — the waveform replaces the textarea while a memo exists — so exactly one of `text`
 * and `voice` is ever populated.
 */
export interface ComposerPayload {
	projectId: string;
	channelId: string;
	/** The typed body, with any collapsed paste blocks appended back in order. */
	text: string;
	/** Staged files, in the order they were queued. */
	files: File[];
	/** The recorded voice memo, or `null` when the draft is text/attachments. */
	voice: VoicePayload | null;
}
// #endregion
