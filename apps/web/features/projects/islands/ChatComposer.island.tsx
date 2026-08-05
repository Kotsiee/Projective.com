import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/chat-composer.css";
import { Message, Popover, Tooltip } from "@projective/ui/feedback";
import { useId } from "@projective/ui/hooks";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { CloseIcon, PlusIcon, TrashIcon } from "../components/glyphs.tsx";
import {
	FileTypeGlyph,
	LibraryIcon,
	MicIcon,
	MicOffIcon,
	PauseIcon,
	ResumeIcon,
	SendIcon,
	StopIcon,
	UploadIcon,
} from "../components/composer-glyphs.tsx";
import {
	extOf,
	fileKindOf,
	formatBytes,
	formatClock,
	formatDuration,
	isVoiceOversize,
	makeId,
	MAX_ATTACHMENTS,
	MAX_AUDIO_PEAKS,
	PASTE_COLLAPSE_CHARS,
	resamplePeaks,
	voiceFileNameFor,
} from "../core/composer-model.ts";
import { useAutoResize } from "../hooks/useAutoResize.ts";
import { useAudioRecorder } from "../hooks/useAudioRecorder.ts";
import { useWaveform } from "../hooks/useWaveform.ts";
import type {
	ComposerPayload,
	DraftAttachment,
	PastedBlock,
	RecorderError,
	RecorderPhase,
	VoicePayload,
} from "../types/composer-types.ts";

/**
 * ChatComposer — the floating message input bar for a channel's Chat tab
 * (`/projects/[projectId]/[channelId]/chat`). It floats over the message stream via a gradient +
 * backdrop-blur scrim (kept on a `::before`-style underlay element so it never re-bases the Popover's
 * fixed panel — the glass-blur / fixed-overlay trap, root CLAUDE.md §8/§9) and carries:
 *
 *   - an auto-growing textarea (to a 200px ceiling, then internal scroll);
 *   - a dynamic right control — Mic when empty, Send once there's a draft, Pause + Stop while capturing;
 *   - a voice engine ({@link useAudioRecorder}) with click-to-toggle, hold-to-talk, and `Ctrl+Space`,
 *     a live scrolling waveform, a `mm:ss` clock, pause/resume, and static equal-width bars once
 *     stopped (5-minute / 10 MB caps);
 *   - a left Plus popover (Upload from Device · Attach from Library — the library modal is stubbed),
 *     drag-and-drop, and up to 10 attachment preview cards;
 *   - long pastes (≥1000 chars) collapsed into a document chip instead of stretching the input.
 *
 * Capture failures surface **inline, in the composer itself** rather than as a corner toast: the
 * control that failed is right here, and a blocked microphone needs instructions the viewer can read
 * while looking at the button they just pressed.
 *
 * THIN: send assembles a real {@link ComposerPayload} — the voice memo becomes an actual `File` with
 * its envelope already resampled to the persisted cap — and hands it to the host; persistence lands
 * with the live messaging backend behind `PROJECTS_BACKEND_LIVE`, matching the rest of the projects
 * feature. Text and voice drafts are mutually exclusive by construction (the textarea is replaced by
 * the waveform while a memo exists).
 */

/** An imperative handle an external drop zone (e.g. the pop-out popover) uses to enqueue files. */
export interface ComposerHandle {
	/** Enqueue files into the attachment tray (respects the attachment cap). */
	addFiles(files: FileList | File[]): void;
}

export interface ChatComposerProps {
	/** The engagement route slug (thread scoping for the eventual send). */
	projectId: string;
	/** The channel route segment (its unified `chatId` is resolved server-side when live). */
	channelId: string;
	/**
	 * Fired once after mount with an imperative {@link ComposerHandle}, so an external surface — the
	 * floating "Pop Out Chat" popover's whole-panel drop zone (task §1) — can push dropped files into
	 * this composer's upload queue. Unused by the in-frame composer.
	 */
	onReady?: (api: ComposerHandle) => void;
	/**
	 * Fired when the viewer sends, with the assembled outgoing draft, before it is cleared. The profile
	 * quick-message popover (task §3) uses it to create the conversation record + navigate into
	 * `/messages/[conversationId]` on the FIRST message; the eventual upload pipeline consumes the same
	 * payload. Hosts that only care *that* a send happened may ignore the argument.
	 */
	onSend?: (payload: ComposerPayload) => void;
}

/** The primary site sidebar the Plus popover must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;
/** A press held at least this long is a hold-to-talk gesture; shorter is a click-to-latch. */
const HOLD_THRESHOLD_MS = 350;

/** Failures about microphone *access* rather than the take itself — these carry the struck-mic mark. */
const PERMISSION_KINDS: ReadonlySet<RecorderError["kind"]> = new Set([
	"blocked",
	"denied",
	"unsupported",
	"no_device",
	"in_use",
	"device_lost",
]);

/** The one sentence announced on each capture phase transition (see the `role="status"` line). */
function voiceStatus(phase: RecorderPhase, durationMs: number): string {
	switch (phase) {
		case "requesting":
			return "Connecting to your microphone.";
		case "recording":
			return "Recording.";
		case "paused":
			return "Recording paused.";
		case "recorded":
			return `Recording ready, ${formatDuration(durationMs)}. Send or discard it.`;
		default:
			return "";
	}
}

export default function ChatComposer(
	{ projectId, channelId, onReady, onSend }: ChatComposerProps,
): JSX.Element {
	// #region State
	const text = useSignal("");
	const attachments = useSignal<DraftAttachment[]>([]);
	/**
	 * This composer's Asset Picker routing key.
	 *
	 * Per INSTANCE, not per channel: the pop-out chat popover and the in-frame footer composer can be
	 * mounted at once on the same channel, and two pickers sharing a key would both open and both
	 * receive the other's files.
	 */
	const pickerId = useId(undefined, "composer-picker");
	const pasted = useSignal<PastedBlock[]>([]);
	const dragActive = useSignal(false);
	const plusOpen = useSignal(false);

	const auto = useAutoResize();
	const rec = useAudioRecorder();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useWaveform(canvasRef, rec);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const dragDepth = useRef(0);
	const pressAtRef = useRef(0);
	const holdingRef = useRef(false);
	const shortcutRef = useRef(false);
	// #endregion

	// #region Derived
	const phase = rec.phase.value;
	const memo = rec.draft.value;
	const capturing = phase === "recording" || phase === "paused";
	const hasVoice = phase === "requesting" || capturing || phase === "recorded";
	const hasText = text.value.trim().length > 0;
	const hasContent = hasText || attachments.value.length > 0 || pasted.value.length > 0;
	// An oversize memo stays playable but may not be sent — the same ceiling the hook reports on.
	const oversize = isVoiceOversize(memo);
	const canSend = phase === "recorded" ? !oversize : (!hasVoice && hasContent);
	const atCapacity = attachments.value.length >= MAX_ATTACHMENTS;
	const micBlocked = rec.permission.value === "denied" || rec.permission.value === "unsupported";
	// #endregion

	// #region Attachments + paste
	function addFiles(list: FileList | File[]): void {
		const incoming = Array.from(list);
		if (incoming.length === 0) return;
		const room = MAX_ATTACHMENTS - attachments.value.length;
		if (room <= 0) return;
		const next: DraftAttachment[] = [];
		for (const file of incoming.slice(0, room)) {
			const kind = fileKindOf(file.name, file.type);
			const previewUrl = kind === "image" || kind === "video"
				? URL.createObjectURL(file)
				: undefined;
			next.push({
				id: makeId("att"),
				file,
				assetId: null,
				name: file.name,
				size: file.size,
				ext: extOf(file.name),
				kind,
				previewUrl,
			});
		}
		attachments.value = [...attachments.value, ...next];
	}

	/**
	 * Stage assets the viewer already has, from the Asset Picker.
	 *
	 * **Nothing is uploaded and nothing is copied.** A library pick is a reference: the bytes are
	 * already on the platform, and re-uploading them would spend the person's storage allowance twice
	 * for one file and give the same content two identities.
	 *
	 * The same-file guard is by ASSET id rather than by name: two different files can share a name,
	 * and the same file picked twice is the case worth refusing.
	 */
	function addLibraryAssets(assets: AssetItem[]): void {
		if (assets.length === 0) return;
		const room = MAX_ATTACHMENTS - attachments.value.length;
		if (room <= 0) return;
		const staged = new Set(
			attachments.value.map((a) => a.assetId).filter((id): id is string => id !== null),
		);
		const next: DraftAttachment[] = [];
		for (const asset of assets) {
			if (next.length >= room) break;
			if (staged.has(asset.id)) continue;
			const kind = fileKindOf(asset.name, asset.ext);
			next.push({
				id: makeId("att"),
				file: null,
				assetId: asset.id,
				name: asset.name,
				size: asset.sizeBytes,
				ext: asset.ext,
				kind,
				// The asset's OWN thumbnail. Not an object URL, which is why the revoke paths below check
				// `assetId` first — revoking a remote URL is meaningless, and treating it as ours is how a
				// preview that other cards also point at goes blank.
				previewUrl: kind === "image" || kind === "video"
					? asset.thumbnailUrl ?? asset.url
					: undefined,
			});
		}
		attachments.value = [...attachments.value, ...next];
	}

	/** Revoke a preview URL only when this composer minted it (see {@link addLibraryAssets}). */
	function releasePreview(attachment: DraftAttachment): void {
		if (attachment.assetId !== null || !attachment.previewUrl) return;
		try {
			URL.revokeObjectURL(attachment.previewUrl);
		} catch { /* already revoked */ }
	}

	function removeAttachment(id: string): void {
		const target = attachments.value.find((a) => a.id === id);
		if (target) releasePreview(target);
		attachments.value = attachments.value.filter((a) => a.id !== id);
	}

	function removePasted(id: string): void {
		pasted.value = pasted.value.filter((p) => p.id !== id);
	}

	function onPaste(event: JSX.TargetedClipboardEvent<HTMLTextAreaElement>): void {
		const data = event.clipboardData;
		if (!data) return;
		if (data.files && data.files.length > 0) {
			event.preventDefault();
			addFiles(data.files);
			return;
		}
		const clip = data.getData("text");
		if (clip && clip.length >= PASTE_COLLAPSE_CHARS) {
			event.preventDefault();
			pasted.value = [...pasted.value, {
				id: makeId("paste"),
				text: clip,
				chars: clip.length,
				lines: clip.split(/\r\n|\r|\n/).length,
			}];
		}
	}
	// #endregion

	// #region Drag & drop
	function onDragEnter(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current += 1;
		dragActive.value = true;
	}
	function onDragOver(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
	}
	function onDragLeave(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) dragActive.value = false;
	}
	function onDrop(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current = 0;
		dragActive.value = false;
		if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
	}
	// #endregion

	// #region Voice gestures (click-to-toggle · hold-to-talk)
	function onMicPointerDown(event: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
		if (event.button !== 0) return;
		if (rec.phase.value === "recording") {
			rec.stop();
			return;
		}
		if (rec.phase.value !== "inactive" || hasText) return;
		holdingRef.current = true;
		pressAtRef.current = performance.now();
		try {
			// Capture keeps a drag off the button still counting as a hold. It throws if the pointer is
			// already gone — which must not cost the viewer the recording they just asked for.
			event.currentTarget.setPointerCapture?.(event.pointerId);
		} catch { /* pointer released before the handler ran — carry on */ }
		void rec.start();
	}
	function onMicPointerUp(): void {
		if (!holdingRef.current) return;
		holdingRef.current = false;
		const held = performance.now() - pressAtRef.current;
		// A real hold ends the take on release; a quick click leaves it latched (click again to stop).
		if (held >= HOLD_THRESHOLD_MS && rec.phase.value === "recording") rec.stop();
	}
	function onMicPointerCancel(): void {
		if (!holdingRef.current) return;
		holdingRef.current = false;
		if (rec.phase.value === "recording") rec.stop();
	}
	// #endregion

	// #region Send
	function resetDraft(): void {
		text.value = "";
		for (const a of attachments.value) releasePreview(a);
		attachments.value = [];
		pasted.value = [];
		rec.discard();
		setTimeout(() => auto.resize(), 0);
	}

	/**
	 * Assemble the outgoing draft. The memo becomes a real {@link File} named for the container the UA
	 * actually produced, and its envelope is resampled here — once, at the boundary — to the persisted
	 * `MessageAudio.peaks` cap, so nothing downstream repeats the maths.
	 */
	function buildPayload(): ComposerPayload {
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
		// Collapsed pastes were only ever collapsed for display — they rejoin the body on the way out.
		const body = [text.value.trim(), ...pasted.value.map((p) => p.text)].filter(Boolean).join(
			"\n\n",
		);
		return {
			projectId,
			channelId,
			text: body,
			// Device files carry bytes; library picks carry an id. They are separated HERE rather than by
			// the send path, so nothing downstream has to know how a card got onto the tray.
			files: attachments.value.flatMap((a) => (a.file ? [a.file] : [])),
			libraryAssetIds: attachments.value.flatMap((a) => (a.assetId ? [a.assetId] : [])),
			voice,
		};
	}

	function send(): void {
		if (!canSend) return;
		// Optimistic/stubbed transport — the payload below is real and complete; only its dispatch waits
		// on the messaging backend behind `PROJECTS_BACKEND_LIVE`. `onSend` lets a host (the profile
		// quick-message popover) react to the first send (create + link the conversation).
		onSend?.(buildPayload());
		resetDraft();
	}

	function onTextareaKeyDown(event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			send();
		}
	}
	// #endregion

	// #region Global shortcut + unmount cleanup
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (!event.ctrlKey || event.code !== "Space" || event.repeat) return;
			if (text.value.trim().length > 0 || rec.phase.value !== "inactive") return;
			event.preventDefault();
			shortcutRef.current = true;
			void rec.start();
		}
		function onKeyUp(event: KeyboardEvent): void {
			if (!shortcutRef.current) return;
			if (event.code === "Space" || event.key === "Control") {
				shortcutRef.current = false;
				if (rec.phase.value === "recording") rec.stop();
			}
		}
		globalThis.addEventListener("keydown", onKeyDown);
		globalThis.addEventListener("keyup", onKeyUp);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("keyup", onKeyUp);
		};
	}, []);

	// The recorder releases its own stream/graph on unmount and `pagehide` (see `useAudioRecorder`);
	// this only has to clean up the attachment previews the island itself minted.
	useEffect(() => () => {
		for (const a of attachments.value) releasePreview(a);
	}, []);

	// Expose the imperative handle so an external drop zone (the pop-out popover) can enqueue files.
	useEffect(() => {
		onReady?.({ addFiles });
	}, []);
	// #endregion

	// #region Plus menu actions
	function openDevicePicker(): void {
		plusOpen.value = false;
		fileInputRef.current?.click();
	}
	/**
	 * Open the Asset Picker over the viewer's own library.
	 *
	 * `max` is the room LEFT on the tray, not the tray's capacity — a picker that let someone choose
	 * ten while eight were already staged would silently drop two of the ten they chose.
	 */
	function openLibrary(): void {
		plusOpen.value = false;
		openPicker({
			requesterId: pickerId,
			title: "Attach from your files",
			multiple: true,
			max: Math.max(1, MAX_ATTACHMENTS - attachments.value.length),
		});
	}
	function onFileInput(event: JSX.TargetedEvent<HTMLInputElement>): void {
		const files = event.currentTarget.files;
		if (files) addFiles(files);
		event.currentTarget.value = "";
	}
	// #endregion

	const err = rec.error.value;

	return (
		<div
			class="chat-composer"
			data-project={projectId}
			data-channel={channelId}
			data-drag={dragActive.value ? "true" : undefined}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			{/* Gradient + blur underlay — a sibling, never an ancestor of the Plus popover trigger. */}
			<div class="chat-composer__scrim" aria-hidden="true" />

			<div class="chat-composer__inner">
				{/* Attachment preview cards (max 10). */}
				{attachments.value.length > 0 && (
					<ul class="chat-composer__cards" aria-label="Attachments">
						{attachments.value.map((att) => (
							<li key={att.id} class="chat-composer__card" data-kind={att.kind}>
								{att.kind === "image" && att.previewUrl
									? <img class="chat-composer__card-media" src={att.previewUrl} alt={att.name} />
									: att.kind === "video" && att.previewUrl
									? (
										<video
											class="chat-composer__card-media"
											src={att.previewUrl}
											muted
											playsInline
											preload="metadata"
										/>
									)
									: (
										<span class="chat-composer__card-file" aria-hidden="true">
											<FileTypeGlyph ext={att.ext} />
											{att.ext && <span class="chat-composer__card-ext">{att.ext}</span>}
										</span>
									)}
								<span
									class="chat-composer__card-name"
									title={`${att.name} · ${formatBytes(att.size)}`}
								>
									{att.name}
								</span>
								<button
									type="button"
									class="chat-composer__card-remove"
									aria-label={`Remove ${att.name}`}
									onClick={() =>
										removeAttachment(att.id)}
								>
									{CloseIcon}
								</button>
							</li>
						))}
					</ul>
				)}

				{/* Collapsed long-paste chips. */}
				{pasted.value.map((block) => (
					<div key={block.id} class="chat-composer__paste">
						<span class="chat-composer__paste-glyph" aria-hidden="true">
							<FileTypeGlyph ext="txt" />
						</span>
						<span class="chat-composer__paste-meta">
							<span class="chat-composer__paste-title">Pasted text</span>
							<span class="chat-composer__paste-sub">
								{block.lines} lines · {block.chars.toLocaleString()} chars
							</span>
						</span>
						<button
							type="button"
							class="chat-composer__paste-remove"
							aria-label="Remove pasted text"
							onClick={() => removePasted(block.id)}
						>
							{CloseIcon}
						</button>
					</div>
				))}

				{/* The floating input bar. */}
				<div class="chat-composer__bar">
					{/* Left control — Plus popover, or Discard while a voice memo is active. */}
					{hasVoice
						? (
							<Tooltip content="Discard recording" placement="top">
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--ghost"
									aria-label="Discard recording"
									onClick={() => rec.discard()}
								>
									{TrashIcon}
								</button>
							</Tooltip>
						)
						: (
							<Popover
								open={plusOpen}
								placement="top-start"
								avoid={SHELL_AVOID}
								allowOverflow={["top"]}
								class="chat-composer-pop"
								trigger={(api) => (
									<Tooltip content="Add attachment" placement="top">
										<button
											type="button"
											ref={api.ref as RefObject<HTMLButtonElement>}
											class="chat-composer__btn chat-composer__btn--ghost"
											aria-label="Add attachment"
											aria-haspopup="menu"
											aria-expanded={api.expanded}
											aria-controls={api.panelId}
											disabled={atCapacity}
											onClick={api.toggle}
										>
											{PlusIcon}
										</button>
									</Tooltip>
								)}
							>
								<div class="chat-composer__menu" role="menu" aria-label="Add attachment">
									<button
										type="button"
										role="menuitem"
										class="chat-composer__menu-item"
										onClick={openDevicePicker}
									>
										<span class="chat-composer__menu-icon" aria-hidden="true">{UploadIcon}</span>
										<span>Upload from Device</span>
									</button>
									<button
										type="button"
										role="menuitem"
										class="chat-composer__menu-item"
										onClick={openLibrary}
									>
										<span class="chat-composer__menu-icon" aria-hidden="true">{LibraryIcon}</span>
										<span>Attach from Library</span>
									</button>
								</div>
							</Popover>
						)}

					{/* Field — textarea, or the waveform while recording/recorded. */}
					<div class="chat-composer__field">
						{hasVoice
							? (
								<div class="chat-composer__voice" data-phase={phase}>
									{phase === "requesting" && (
										<span class="chat-composer__connecting">Connecting to your microphone…</span>
									)}
									<canvas
										ref={canvasRef}
										class="chat-composer__wave"
										data-phase={phase}
										aria-hidden="true"
									/>
									{
										/* Readable on demand, but never a live region — a clock announcing itself five
									    times a second would bury every other message. Transitions are announced by
									    the status line below instead. */
									}
									<span class="chat-composer__timer">
										{formatClock(
											phase === "recorded" && memo ? memo.durationMs : rec.elapsedMs.value,
										)}
										{phase !== "recorded" && (
											<span class="chat-composer__timer-max">/ {formatClock(rec.maxMs)}</span>
										)}
									</span>
								</div>
							)
							: (
								<textarea
									ref={auto.ref}
									class="chat-composer__input"
									rows={1}
									placeholder="Write a message…"
									value={text.value}
									onInput={(e) => {
										text.value = e.currentTarget.value;
										auto.resize();
									}}
									onPaste={onPaste}
									onKeyDown={onTextareaKeyDown}
								/>
							)}
					</div>

					{
						/* Right controls — Pause/Resume + Stop while capturing, Send when there's a draft,
					    else Mic. Pause sits between Cancel and the primary control, so the three recording
					    actions read left-to-right in the order they are reached. */
					}
					{phase === "requesting"
						? (
							<Tooltip content="Cancel" placement="top">
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--stop"
									data-paused="true"
									aria-label="Cancel recording"
									onClick={() => rec.discard()}
								>
									{StopIcon}
								</button>
							</Tooltip>
						)
						: capturing
						? (
							<>
								<Tooltip
									content={phase === "paused" ? "Resume recording" : "Pause recording"}
									placement="top"
								>
									<button
										type="button"
										class="chat-composer__btn chat-composer__btn--pause"
										aria-label={phase === "paused" ? "Resume recording" : "Pause recording"}
										onClick={() => (phase === "paused" ? rec.resume() : rec.pause())}
									>
										{phase === "paused" ? ResumeIcon : PauseIcon}
									</button>
								</Tooltip>
								<Tooltip content="Stop recording" placement="top">
									<button
										type="button"
										class="chat-composer__btn chat-composer__btn--stop"
										data-paused={phase === "paused" ? "true" : undefined}
										aria-label="Stop recording"
										onClick={() => rec.stop()}
									>
										{StopIcon}
									</button>
								</Tooltip>
							</>
						)
						: phase === "recorded" || canSend
						? (
							// A finished memo always shows Send, disabled when it is too large to upload.
							// Falling back to the Mic here would leave an enabled control that does nothing —
							// the press guard rejects a `recorded` phase — and hide the only correct action.
							<Tooltip content={oversize ? "Too large to send" : "Send"} placement="top">
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--send"
									aria-label={oversize ? "Send message — recording too large" : "Send message"}
									disabled={!canSend}
									onClick={send}
								>
									{SendIcon}
								</button>
							</Tooltip>
						)
						: (
							<Tooltip
								content={micBlocked
									? "Microphone unavailable"
									: "Hold to talk · click to record · Ctrl+Space"}
								placement="top"
							>
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--mic"
									data-blocked={micBlocked ? "true" : undefined}
									aria-label={micBlocked
										? "Microphone unavailable — why?"
										: "Record a voice message"}
									onPointerDown={onMicPointerDown}
									onPointerUp={onMicPointerUp}
									onPointerCancel={onMicPointerCancel}
									onPointerLeave={onMicPointerUp}
								>
									{micBlocked ? MicOffIcon : MicIcon}
								</button>
							</Tooltip>
						)}
				</div>

				{
					/* Capture failures, inline beside the control that produced them. Recovery steps appear
				    only for a persisted block, where pressing the mic again would do nothing at all. */
				}
				{err && (
					<div class="chat-composer__notice">
						<Message
							severity={err.kind === "too_large" || err.kind === "failed" ? "danger" : "warning"}
							variant="subtle"
							size="sm"
							icon={PERMISSION_KINDS.has(err.kind) ? MicOffIcon : undefined}
							closable
							onClose={() => rec.clearError()}
						>
							<span class="chat-composer__notice-body">
								<span class="chat-composer__notice-title">{err.title}</span>
								{err.detail && <span class="chat-composer__notice-detail">{err.detail}</span>}
								{err.help && <span class="chat-composer__notice-help">{err.help}</span>}
							</span>
						</Message>
					</div>
				)}

				{
					/* Phase transitions announced once each, so a non-sighted viewer knows capture began,
				    paused, and ended without the clock talking over everything. */
				}
				<p class="chat-composer__sr" role="status" aria-live="polite">
					{voiceStatus(phase, memo?.durationMs ?? 0)}
				</p>
			</div>

			{/* Hidden device file picker. */}
			<input
				ref={fileInputRef}
				type="file"
				multiple
				class="chat-composer__file-input"
				onChange={onFileInput}
			/>

			{/* Drag overlay. */}
			<div class="chat-composer__drop" aria-hidden="true">
				<span class="chat-composer__drop-label">Drop files to attach</span>
			</div>

			{
				/* Mounted unconditionally — an island is only in the page's island graph once it renders,
			    and that graph is what carries its stylesheet. It draws nothing until it is opened. */
			}
			<AssetPicker requesterId={pickerId} onPick={addLibraryAssets} />
		</div>
	);
}
