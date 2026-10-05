import { extractMetadata } from "@web/features/files/core/media/extract.ts";
import { MessagingService } from "@web/features/messaging/core/MessagingService.ts";
import { messageDeltaText, normalizeMessageDelta } from "@projective/types/projects";
import { MessagesService } from "../../core/MessagesService.ts";
import { uploadForProject } from "../../core/upload.ts";
import {
	formatDuration,
	MAX_AUDIO_PEAKS,
	resamplePeaks,
	voiceFileNameFor,
} from "../../core/composer-model.ts";
import type {
	AudioDraft,
	ComposerPayload,
	DraftAttachment,
	PastedBlock,
	VoicePayload,
} from "../../types/composer-types.ts";

// #region Types
/**
 * What one send consumed.
 *
 * Captured before the request leaves so a success can clear exactly that and nothing else. The
 * composer stays editable while a large attachment uploads, and blanking the field on the way back
 * would delete a sentence typed after the send — the one kind of data loss a person cannot see
 * happening.
 */
export interface SentDraft {
	/** The raw field text at send time; cleared only if it is still that. */
	text: string;
	/** The message the send replied to; the strip is dismissed only if it still quotes it. */
	replyToId: string | null;
	/** The {@link DraftAttachment} ids consumed — by id, because the tray may have grown since. */
	attachmentIds: string[];
	/** The collapsed paste blocks consumed. */
	pastedIds: string[];
	/** Whether the voice memo went with it. */
	voice: boolean;
}

/** A send that did not land, phrased for the inline notice rather than for a log. */
export interface SendFailure {
	/** The one-line statement of what happened. */
	title: string;
	/** What to do about it, and what was kept. */
	detail?: string;
}

/** Everything {@link buildComposerPayload} reads from the composer at send time. */
export interface ComposerDraftSource {
	/** The engagement route slug. */
	projectId: string;
	/** The channel (or conversation) route segment. */
	channelId: string;
	/** The field's formatted runs, as the editor reports them. */
	ops: unknown[];
	/** The collapsed long-paste blocks, in order. */
	pasted: PastedBlock[];
	/** The attachment tray, in order. */
	attachments: DraftAttachment[];
	/** The id of the message being replied to, or null. */
	replyToId: string | null;
	/** The finished voice memo, or null. */
	memo: AudioDraft | null;
}

/** Where a draft is posted and how its uploads are filed. */
export interface DispatchTarget {
	/** Which door the send uses (see `ChatComposerProps.scope`). */
	scope: "project" | "conversation";
	/** The engagement route slug. */
	projectId: string;
	/** The channel route segment, or the conversation's own id in the `conversation` scope. */
	channelId: string;
	/** Resolves the library an upload asks to be filed in; null when there is none. */
	actingOwnerId: () => Promise<string | null>;
}

/** The result of {@link dispatchDraft}: the stored row on success, a phrased failure otherwise. */
export type DispatchOutcome =
	| { ok: true; message: unknown }
	| { ok: false; failure: SendFailure };
// #endregion

// #region Payload
/**
 * Assemble the outgoing draft. The memo becomes a real {@link File} named for the container the UA
 * actually produced, and its envelope is resampled here — once, at the boundary — to the persisted
 * `MessageAudio.peaks` cap, so nothing downstream repeats the maths.
 */
export function buildComposerPayload(source: ComposerDraftSource): ComposerPayload {
	const { memo } = source;
	let voice: VoicePayload | null = null;
	if (memo) {
		const file = new File([memo.blob], voiceFileNameFor(memo.mimeType, new Date()), {
			type: memo.mimeType,
			lastModified: Date.now(),
		});
		voice = {
			file,
			durationMs: memo.durationMs,
			durationLabel: formatDuration(memo.durationMs),
			peaks: resamplePeaks(memo.peaks, Math.min(MAX_AUDIO_PEAKS, Math.max(1, memo.peaks.length))),
		};
	}
	// Collapsed pastes were only ever collapsed for display — they rejoin the body on the way out,
	// as unformatted runs after the field's own (formatted) runs.
	const runs: unknown[] = source.ops;
	for (const p of source.pasted) {
		if (runs.length > 0) runs.push({ insert: "\n\n" });
		runs.push({ insert: p.text });
	}
	// The plain body is derived from the SAME runs the Delta is, and trimmed the way the Delta
	// normaliser trims, so the two agree character for character (the send schemas refuse a pair
	// that does not). A Delta the normaliser cannot store — an over-long run — is dropped, and the
	// message goes plain rather than not at all.
	const body = runs
		.map((op) =>
			typeof (op as { insert?: unknown }).insert === "string"
				? (op as { insert: string }).insert
				: ""
		)
		.join("")
		.replace(/\r\n?/g, "\n")
		.trim();
	const normalized = normalizeMessageDelta(runs);
	const delta = normalized && messageDeltaText(normalized) === body ? normalized : null;
	return {
		projectId: source.projectId,
		channelId: source.channelId,
		text: body,
		delta,
		replyToId: source.replyToId,
		// Device files carry bytes; library picks carry an id. They are separated HERE rather than by
		// the send path, so nothing downstream has to know how a card got onto the tray.
		files: source.attachments.flatMap((a) => (a.file ? [a.file] : [])),
		libraryAssetIds: source.attachments.flatMap((a) => (a.assetId ? [a.assetId] : [])),
		voice,
	};
}
// #endregion

// #region Upload + dispatch
/**
 * Turn every device file into a `files.items` id, in the caller's order.
 *
 * A partial upload REFUSES the send. The files module is right that three of four attachments
 * arriving is still a drop worth keeping — but a chat message is not a drop: it is a statement
 * about the things attached to it, and one that quietly arrives missing an attachment is worse
 * than one that does not arrive at all. Nothing is cleared, so the person can drop the file that
 * failed and press Send again; the ones that did land are already in their library and dedupe on
 * their fingerprint rather than costing a second slice of quota.
 */
export async function uploadDraftFiles(
	files: File[],
	actingOwnerId: () => Promise<string | null>,
): Promise<{ ids: string[] } | SendFailure> {
	if (files.length === 0) return { ids: [] };
	const ownerId = await actingOwnerId();
	if (!ownerId) {
		return {
			title: "Your attachments could not be uploaded.",
			detail: "We could not tell whose library to file them in — sign in again and retry.",
		};
	}
	const outcome = await uploadForProject(files, {
		ownerType: "user",
		ownerId,
		// Runs alongside the transfer, so a poster frame never delays the bytes; a reader that
		// cannot answer degrades to `generic` rather than failing the upload.
		metadataFor: extractMetadata,
	});
	if (outcome.failures.length > 0) {
		const names = outcome.failures.map((f) => f.name).join(", ");
		return {
			title: outcome.failures.length === files.length
				? "Nothing could be uploaded, so the message was not sent."
				: "Some attachments did not upload, so the message was not sent.",
			detail: `${names} — remove them or try again. Your message is still here.`,
		};
	}
	// Every file landed, and `assetIds` is written positionally, so index i is file i.
	return { ids: outcome.assetIds };
}

/**
 * Upload a draft's files and post it through the door its scope names.
 *
 * Returns the SERVER's stored row on success so the caller can announce it to whatever feed shares
 * the page, or the failure phrased for the notice. Nothing here touches composer state.
 */
export async function dispatchDraft(
	draft: ComposerPayload,
	target: DispatchTarget,
): Promise<DispatchOutcome> {
	const { scope, projectId, channelId } = target;
	// The memo goes LAST so its id is the last one back — it is the only attachment whose id the
	// payload needs individually, and a positional answer is cheaper than a second round trip.
	const memo = draft.voice;
	const uploaded = await uploadDraftFiles(
		memo ? [...draft.files, memo.file] : draft.files,
		target.actingOwnerId,
	);
	if (!("ids" in uploaded)) return { ok: false, failure: uploaded };
	const memoId = memo ? uploaded.ids[uploaded.ids.length - 1] ?? null : null;
	const attachmentIds = [
		...(memo ? uploaded.ids.slice(0, draft.files.length) : uploaded.ids),
		...draft.libraryAssetIds,
		...(memoId ? [memoId] : []),
	];
	const audio = memo && memoId
		? {
			// The server resolves the playable address from the asset the memo was uploaded as;
			// a URL minted here would be an object URL that dies with this page.
			url: "",
			durationMs: memo.durationMs,
			durationLabel: memo.durationLabel,
			peaks: memo.peaks,
		}
		: null;
	// One payload, two doors. The conversation door is addressed by the conversation's own id (the
	// `channelId` slot — a conversation mount passes it in both), the project door by the pair.
	const res = scope === "conversation"
		? await MessagingService.send({
			conversationId: channelId,
			text: draft.text,
			delta: draft.delta,
			replyToId: draft.replyToId,
			attachmentIds,
			audio,
		})
		: await MessagesService.send({
			projectId,
			channelId,
			text: draft.text,
			delta: draft.delta,
			replyToId: draft.replyToId,
			attachmentIds,
			audio,
		});
	if (res.ok) return { ok: true, message: res.data?.message ?? null };
	return {
		ok: false,
		failure: {
			title: res.message ?? "That message could not be sent.",
			detail: "Nothing was cleared — press Send to try again.",
		},
	};
}
// #endregion
