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
/** The voice-recorder lifecycle phase. */
export type RecorderPhase = "inactive" | "requesting" | "recording" | "recorded";

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
}
// #endregion
