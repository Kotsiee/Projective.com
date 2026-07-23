import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/chat-composer.css";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { CloseIcon, PlusIcon, TrashIcon } from "../components/glyphs.tsx";
import {
	FileTypeGlyph,
	LibraryIcon,
	MicIcon,
	SendIcon,
	StopIcon,
	UploadIcon,
} from "../components/composer-glyphs.tsx";
import {
	extOf,
	fileKindOf,
	formatBytes,
	formatDuration,
	makeId,
	MAX_ATTACHMENTS,
	PASTE_COLLAPSE_CHARS,
} from "../core/composer-model.ts";
import { useAutoResize } from "../hooks/useAutoResize.ts";
import { useAudioRecorder } from "../hooks/useAudioRecorder.ts";
import { useWaveform } from "../hooks/useWaveform.ts";
import type { DraftAttachment, PastedBlock } from "../types/composer-types.ts";

/**
 * ChatComposer — the floating message input bar for a channel's Chat tab
 * (`/projects/[projectId]/[channelId]/chat`). It floats over the message stream via a gradient +
 * backdrop-blur scrim (kept on a `::before`-style underlay element so it never re-bases the Popover's
 * fixed panel — the glass-blur / fixed-overlay trap, root CLAUDE.md §8/§9) and carries:
 *
 *   - an auto-growing textarea (to a 200px ceiling, then internal scroll);
 *   - a dynamic right control — Mic when empty, Send once there's a draft, Stop while recording;
 *   - a voice engine ({@link useAudioRecorder}) with click-to-toggle, hold-to-talk, and `Ctrl+Space`,
 *     a live scrolling waveform, and static equal-width bars once stopped (5-minute cap);
 *   - a left Plus popover (Upload from Device · Attach from Library — the library modal is stubbed),
 *     drag-and-drop, and up to 10 attachment preview cards;
 *   - long pastes (≥1000 chars) collapsed into a document chip instead of stretching the input.
 *
 * THIN: send is optimistic/stubbed — persistence lands with the live messaging backend behind
 * `PROJECTS_BACKEND_LIVE`, matching the rest of the projects feature. Text and voice drafts are
 * mutually exclusive by construction (the textarea is replaced by the waveform while a memo exists).
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
	 * Fired when the viewer sends (before the draft is cleared). The profile quick-message popover (task
	 * §3) uses it to create the conversation record + navigate into `/messages/[conversationId]` on the
	 * FIRST message. Unused by the in-frame composer (its send is optimistic/stubbed).
	 */
	onSend?: () => void;
}

/** The primary site sidebar the Plus popover must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;
/** A press held at least this long is a hold-to-talk gesture; shorter is a click-to-latch. */
const HOLD_THRESHOLD_MS = 350;

export default function ChatComposer(
	{ projectId, channelId, onReady, onSend }: ChatComposerProps,
): JSX.Element {
	// #region State
	const text = useSignal("");
	const attachments = useSignal<DraftAttachment[]>([]);
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
	const hasVoice = phase === "requesting" || phase === "recording" || phase === "recorded";
	const hasText = text.value.trim().length > 0;
	const hasContent = hasText || attachments.value.length > 0 || pasted.value.length > 0;
	const canSend = phase === "recorded" || (!hasVoice && hasContent);
	const atCapacity = attachments.value.length >= MAX_ATTACHMENTS;
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
				name: file.name,
				size: file.size,
				ext: extOf(file.name),
				kind,
				previewUrl,
			});
		}
		attachments.value = [...attachments.value, ...next];
	}

	function removeAttachment(id: string): void {
		const target = attachments.value.find((a) => a.id === id);
		if (target?.previewUrl) {
			try {
				URL.revokeObjectURL(target.previewUrl);
			} catch { /* already revoked */ }
		}
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
		event.currentTarget.setPointerCapture?.(event.pointerId);
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
		for (const a of attachments.value) {
			if (a.previewUrl) {
				try {
					URL.revokeObjectURL(a.previewUrl);
				} catch { /* already revoked */ }
			}
		}
		attachments.value = [];
		pasted.value = [];
		rec.discard();
		setTimeout(() => auto.resize(), 0);
	}

	function send(): void {
		if (!canSend) return;
		// Optimistic/stubbed — the outgoing payload (text + pasted blocks + attachments, or the voice
		// memo) is assembled here and dispatched once the messaging backend lands behind
		// `PROJECTS_BACKEND_LIVE`. For now the draft is simply cleared. `onSend` lets a host (the profile
		// quick-message popover) react to the first send (create + link the conversation).
		onSend?.();
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

	useEffect(() => () => {
		rec.dispose();
		for (const a of attachments.value) {
			if (a.previewUrl) {
				try {
					URL.revokeObjectURL(a.previewUrl);
				} catch { /* already revoked */ }
			}
		}
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
	function openLibrary(): void {
		// Placeholder — the media Library modal is a later build. Nothing staged for now.
		plusOpen.value = false;
	}
	function onFileInput(event: JSX.TargetedEvent<HTMLInputElement>): void {
		const files = event.currentTarget.files;
		if (files) addFiles(files);
		event.currentTarget.value = "";
	}
	// #endregion

	const memo = rec.draft.value;

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
									<canvas ref={canvasRef} class="chat-composer__wave" data-phase={phase} />
									<span class="chat-composer__timer">
										{formatDuration(
											phase === "recorded" && memo ? memo.durationMs : rec.elapsedMs.value,
										)}
										{phase !== "recorded" && (
											<span class="chat-composer__timer-max">/ {formatDuration(rec.maxMs)}</span>
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

					{/* Right control — Stop while recording, Send when there's a draft, else Mic. */}
					{phase === "recording" || phase === "requesting"
						? (
							<Tooltip content="Stop recording" placement="top">
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--stop"
									aria-label="Stop recording"
									onClick={() => (phase === "recording" ? rec.stop() : rec.discard())}
								>
									{StopIcon}
								</button>
							</Tooltip>
						)
						: canSend
						? (
							<Tooltip content="Send" placement="top">
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--send"
									aria-label="Send message"
									onClick={send}
								>
									{SendIcon}
								</button>
							</Tooltip>
						)
						: (
							<Tooltip content="Hold to talk · click to record · Ctrl+Space" placement="top">
								<button
									type="button"
									class="chat-composer__btn chat-composer__btn--mic"
									aria-label="Record a voice message"
									onPointerDown={onMicPointerDown}
									onPointerUp={onMicPointerUp}
									onPointerCancel={onMicPointerCancel}
									onPointerLeave={onMicPointerUp}
								>
									{MicIcon}
								</button>
							</Tooltip>
						)}
				</div>

				{rec.error.value && <p class="chat-composer__error" role="alert">{rec.error.value}</p>}
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
		</div>
	);
}
