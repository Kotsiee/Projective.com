import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/chat-composer.css";
import { useId } from "@projective/ui/hooks";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import {
	type ChatSurface,
	MESSAGE_REPLY_EVENT,
	MESSAGE_SENT_EVENT,
	type MessageReplyDetail,
	type MessageSentDetail,
} from "@web/utils/lane-events.ts";
import { composerMayTake, isTypingKey, ownsKeys } from "../core/chat-keyboard.ts";
import { FormatBubble } from "../components/FormatBubble.tsx";
import {
	isVoiceOversize,
	makeId,
	MAX_ATTACHMENTS,
	PASTE_COLLAPSE_CHARS,
} from "../core/composer-model.ts";
import { useComposerEditor } from "../hooks/useComposerEditor.ts";
import { useAudioRecorder } from "../hooks/useAudioRecorder.ts";
import { useWaveform } from "../hooks/useWaveform.ts";
import type { ComposerPayload, DraftAttachment, PastedBlock } from "../types/composer-types.ts";
import {
	ComposerAttachments,
	ComposerReplyStrip,
	releasePreview,
	stageDeviceFiles,
	stageLibraryAssets,
	useFileDrop,
} from "../components/composer/ComposerAttachments.tsx";
import {
	ComposerAudioRecorder,
	useVoiceGestures,
	voiceStatus,
} from "../components/composer/ComposerAudioRecorder.tsx";
import {
	ComposerLeadingAction,
	ComposerTrailingAction,
} from "../components/composer/ComposerActions.tsx";
import {
	ComposerCaptureNotice,
	ComposerSendNotice,
	useComposerToasts,
} from "../components/composer/ComposerNotices.tsx";
import {
	buildComposerPayload,
	dispatchDraft,
	type SendFailure,
	type SentDraft,
} from "../components/composer/composer-send.ts";

/**
 * ChatComposer — the floating message input bar for a channel's Chat tab
 * (`/projects/[projectId]/[channelId]/chat`). It floats over the message stream via a gradient +
 * backdrop-blur scrim (kept on a `::before`-style underlay element so it never re-bases the Popover's
 * fixed panel — the glass-blur / fixed-overlay trap, root CLAUDE.md §8/§9) and carries:
 *
 *   - an auto-growing rich message field ({@link useComposerEditor} — Quill, to a 200px ceiling,
 *     then internal scroll) accepting exactly four marks: highlighting text raises the glass
 *     {@link FormatBubble} (Bold · Italic · Strikethrough · Underline) directly above the selection,
 *     and the send carries the body twice — plain `text` and the normalised Quill Delta — which the
 *     feed renders back with its formatting;
 *   - a reply strip: a feed asks for a reply on `MESSAGE_REPLY_EVENT` (Reply, an arrow key, a swipe)
 *     and the strip quotes the message being answered until the reply is sent or cancelled (×, or
 *     Escape in the field); the send carries its `replyToId`;
 *   - type-anywhere: with the field unfocused, ordinary typing on the page focuses it and appends the
 *     characters at the end of the draft (never stealing a key from another field, a menu, a dialog,
 *     or the other chat surface — see `chat-keyboard.ts`);
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
 * its envelope already resampled to the persisted cap — uploads every device file through the shared
 * files handshake ({@link uploadForProject}, so bytes never transit an application route), and posts
 * the resulting asset ids to `/api/projects/messages/send`. Text and voice drafts are mutually
 * exclusive by construction (the field is replaced by the waveform while a memo exists).
 *
 * Nothing is ever dropped quietly. The draft is cleared only by a SUCCESS, and only the parts that
 * were actually sent — so a refusal leaves the words on screen to retry, and a person who kept typing
 * while the request was in flight does not lose the sentence they added.
 */

/** An imperative handle an external drop zone (e.g. the pop-out popover) uses to enqueue files. */
export interface ComposerHandle {
	/** Enqueue files into the attachment tray (respects the attachment cap). */
	addFiles(files: FileList | File[]): void;
}

export interface ChatComposerProps {
	/** The engagement route slug (thread scoping for the send). */
	projectId: string;
	/** The channel route segment (its unified `chatId` is resolved server-side when live). */
	channelId: string;
	/**
	 * Which surface this composer is posting into.
	 *
	 * `project` posts to `/api/projects/messages/send`; `conversation` posts to
	 * `/api/messaging/messages/send`, the inbox's own door. Both announce the SERVER's row on
	 * `MESSAGE_SENT_EVENT` so whatever feed shares the page appends it. Naming the scope here rather
	 * than inferring it from the id pair is what lets one composer serve a stage room, the standalone
	 * inbox, the pop-out chat and the profile's floating messenger without a second implementation.
	 *
	 * A STRING and not a callback on purpose: island props must be serialisable, and a function prop
	 * fails the whole render ("Serializing functions is not supported"), which is why the server slot
	 * resolvers that mount this composer pass no handlers at all.
	 */
	scope?: "project" | "conversation";
	/**
	 * Which chat surface this composer serves (see {@link ChatSurface}). `page` (the default) is the
	 * footer composer of the channel the URL addresses: it takes type-anywhere keys from the whole page
	 * except the floating window. `popout` is the floating window's own composer: it takes them only
	 * while focus is inside the window. Replies are addressed by channel AND surface, so a reply
	 * started in the window never lands in the page's composer on the same channel, or the reverse.
	 */
	surface?: ChatSurface;
	/**
	 * Where a capture or send failure is reported.
	 *
	 * `inline` (the default) keeps Decision #66's rule for the in-frame composer: the notice renders
	 * beside the control that failed, because a blocked microphone needs instructions read while
	 * looking at the button that refused. `toast` is for a FLOATING host — the pop-out chat and the
	 * profile messenger — where the composer sits in a 24rem window with no room for a paragraph of
	 * recovery steps under it: the same structured failure goes to the shared toast stack at
	 * `bottom-center`, which the host mounts. The wording is identical either way; only the surface
	 * that carries it differs.
	 */
	notices?: "inline" | "toast";
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
	/**
	 * Focus the message field once on arrival, for a precise pointer only — on touch it would raise the
	 * keyboard over the thread being read. Never takes focus the viewer has already placed elsewhere.
	 */
	autoFocus?: boolean;
}

export default function ChatComposer(
	{
		projectId,
		channelId,
		scope = "project",
		surface = "page",
		notices = "inline",
		onReady,
		onSend,
		autoFocus = false,
	}: ChatComposerProps,
): JSX.Element {
	// #region State
	const rootRef = useRef<HTMLDivElement>(null);
	/** The message being replied to, as the strip quotes it; null when the draft is not a reply. */
	const replyTo = useSignal<MessageReplyDetail["target"] | null>(null);
	const editor = useComposerEditor({
		placeholder: "Write a message…",
		label: "Message",
		onSubmit: () => void send(),
		onEscape: () => {
			if (!replyTo.value) return false;
			replyTo.value = null;
			return true;
		},
		onPaste,
	});
	const text = editor.text;
	const attachments = useSignal<DraftAttachment[]>([]);
	/** A send is in flight — the Send control is held so one press cannot become two messages. */
	const sending = useSignal(false);
	/** Why the last send did not land; cleared when the next one starts. */
	const sendError = useSignal<SendFailure | null>(null);
	/**
	 * This composer's Asset Picker routing key.
	 *
	 * Per INSTANCE, not per channel: the pop-out chat popover and the in-frame footer composer can be
	 * mounted at once on the same channel, and two pickers sharing a key would both open and both
	 * receive the other's files.
	 */
	const pickerId = useId(undefined, "composer-picker");
	const pasted = useSignal<PastedBlock[]>([]);
	const drop = useFileDrop((files) => addFiles(files));
	const plusOpen = useSignal(false);

	const rec = useAudioRecorder();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useWaveform(canvasRef, rec);

	const fileInputRef = useRef<HTMLInputElement>(null);
	/**
	 * The acting principal an upload is filed against, resolved once and remembered.
	 *
	 * A REQUEST rather than the answer: `/api/files/upload-init` derives the real owner from the
	 * session and the fat service decides which library the bytes land in, so nothing here is trusted.
	 * It is asked for at all because a signed-out caller has no library, and finding that out at the
	 * point of upload is what turns a silent failure into a sentence.
	 */
	const ownerRef = useRef<string | null>(null);
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
	/**
	 * Whether this composer has somewhere to post.
	 *
	 * A conversation always does — its own id is the address. A project channel does only when the
	 * id pair actually names one: a mount that passes the same string as both `projectId` and
	 * `channelId` is a conversation that forgot to say so, and posting it to the projects endpoint
	 * would spend a request only to be told the project does not exist.
	 */
	const dispatches = scope === "conversation" || projectId !== channelId;
	// #endregion

	// #region Attachments + paste
	function addFiles(list: FileList | File[]): void {
		const next = stageDeviceFiles(list, attachments.value);
		if (next) attachments.value = [...attachments.value, ...next];
	}

	/** Stage library picks as references — see {@link stageLibraryAssets}. */
	function addLibraryAssets(assets: AssetItem[]): void {
		const next = stageLibraryAssets(assets, attachments.value);
		if (next) attachments.value = [...attachments.value, ...next];
	}

	function removeAttachment(id: string): void {
		const target = attachments.value.find((a) => a.id === id);
		if (target) releasePreview(target);
		attachments.value = attachments.value.filter((a) => a.id !== id);
	}

	function removePasted(id: string): void {
		pasted.value = pasted.value.filter((p) => p.id !== id);
	}

	/**
	 * Paste, seen in the capture phase before the editor's own handler. Files join the tray and a long
	 * paste collapses into a chip; anything else is left to the editor, which keeps only the four marks
	 * a message can carry from whatever formatting the clipboard holds.
	 */
	function onPaste(event: ClipboardEvent): void {
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

	// #region Send
	/**
	 * Clear exactly what went, and nothing else.
	 *
	 * The text is cleared only when it is still the text that was sent: anything typed while the
	 * request was in flight is a NEW draft, and blanking it would delete work the person can see
	 * themselves having done. Attachments and pastes are matched by id for the same reason.
	 */
	function clearSent(sent: SentDraft): void {
		if (text.value === sent.text) editor.clear();
		if (sent.replyToId !== null && replyTo.value?.id === sent.replyToId) replyTo.value = null;
		const consumedFiles = new Set(sent.attachmentIds);
		for (const a of attachments.value) if (consumedFiles.has(a.id)) releasePreview(a);
		attachments.value = attachments.value.filter((a) => !consumedFiles.has(a.id));
		const consumedPastes = new Set(sent.pastedIds);
		pasted.value = pasted.value.filter((p) => !consumedPastes.has(p.id));
		if (sent.voice) rec.discard();
	}

	/** The library an upload asks to be filed in, resolved from the session on first use. */
	async function actingOwnerId(): Promise<string | null> {
		if (ownerRef.current) return ownerRef.current;
		const me = await AccountService.current();
		ownerRef.current = me?.userId ?? null;
		return ownerRef.current;
	}

	/**
	 * Send the draft.
	 *
	 * {@link onSend} fires FIRST and unconditionally, because a host may navigate on it (the profile
	 * quick-message popover opens the thread on the first message) and a hook that only ran on a
	 * successful round trip would make that behaviour depend on the network.
	 */
	async function send(): Promise<void> {
		if (!canSend || sending.value) return;
		const draft = buildComposerPayload({
			projectId,
			channelId,
			ops: editor.ops(),
			pasted: pasted.value,
			attachments: attachments.value,
			replyToId: replyTo.value?.id ?? null,
			memo,
		});
		const sent: SentDraft = {
			text: text.value,
			replyToId: draft.replyToId,
			attachmentIds: attachments.value.map((a) => a.id),
			pastedIds: pasted.value.map((p) => p.id),
			voice: draft.voice !== null,
		};
		onSend?.(draft);
		if (!dispatches) {
			clearSent(sent);
			return;
		}

		sending.value = true;
		sendError.value = null;

		const outcome = await dispatchDraft(draft, { scope, projectId, channelId, actingOwnerId });
		sending.value = false;
		if (!outcome.ok) {
			sendError.value = outcome.failure;
			return;
		}
		clearSent(sent);
		// Tell whatever feed is on the page that a row now exists. The composer cannot reach the
		// feed directly — they are separate hydration roots in different bands — and without this
		// the message lands in the database while the surface shows nothing, which reads to the
		// sender as a failure. The SERVER's message is what travels, so the feed appends the row
		// that was actually stored rather than a hopeful copy of the draft.
		if (outcome.message) {
			globalThis.dispatchEvent(
				new CustomEvent<MessageSentDetail>(MESSAGE_SENT_EVENT, {
					detail: { channelId, message: outcome.message },
				}),
			);
		}
	}

	// #endregion

	// #region Reply strip + type-anywhere
	/**
	 * Take a reply a feed asked for. Addressed by channel AND surface: the pop-out window and the page
	 * can show the same channel at once, and a reply belongs to the composer beside the feed it was
	 * started from. Focus goes to the end of the draft, so the reader can start writing at once.
	 */
	useEffect(() => {
		function onReply(event: Event): void {
			const detail = (event as CustomEvent<MessageReplyDetail>).detail;
			if (!detail || detail.channelId !== channelId || detail.surface !== surface) return;
			if (rec.phase.value !== "inactive") return;
			replyTo.value = detail.target;
			editor.focusEnd();
		}
		globalThis.addEventListener(MESSAGE_REPLY_EVENT, onReply);
		return () => globalThis.removeEventListener(MESSAGE_REPLY_EVENT, onReply);
	}, [channelId, surface]);

	/**
	 * Typing with the field unfocused writes into it: the key is taken (default prevented), the field
	 * focused, and the character appended at the END of the draft — wherever the caret last was — so a
	 * reader who clicked a message and starts typing continues their sentence rather than splitting it.
	 * Ctrl/⌘+V moves focus the same way without taking the key, so the paste itself lands in the field
	 * through the normal path (files and long pastes included).
	 *
	 * Ownership is `chat-keyboard`'s: never a key typed into another field, a menu, a dialog, the other
	 * chat surface, or a Space meant for a focused button. Nothing happens while a voice memo holds
	 * the field.
	 */
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (event.defaultPrevented) return;
			const active = event.target instanceof Element ? event.target : document.activeElement;
			if (!ownsKeys(surface, active)) return;
			if (rec.phase.value !== "inactive") return;
			const paste = (event.ctrlKey || event.metaKey) && !event.altKey &&
				event.key.toLowerCase() === "v";
			if (paste) {
				editor.focusEnd();
				return;
			}
			if (!isTypingKey(event) || !composerMayTake(event, active)) return;
			event.preventDefault();
			editor.appendTyped(event.key);
		}
		globalThis.addEventListener("keydown", onKeyDown);
		return () => globalThis.removeEventListener("keydown", onKeyDown);
	}, [surface]);
	// #endregion

	// #region Voice gestures + unmount cleanup
	const gestures = useVoiceGestures(rec, text);

	// The recorder releases its own stream/graph on unmount and `pagehide` (see `useAudioRecorder`);
	// this only has to clean up the attachment previews the island itself minted.
	useEffect(() => () => {
		for (const a of attachments.value) releasePreview(a);
	}, []);

	useEffect(() => {
		if (!autoFocus || !globalThis.matchMedia?.("(pointer: fine)").matches) return;
		const timer = setTimeout(() => {
			const active = document.activeElement;
			if (active && active !== document.body) return;
			editor.focus();
		}, 0);
		return () => clearTimeout(timer);
	}, []);

	// Expose the imperative handle so an external drop zone (the pop-out popover) can enqueue files.
	useEffect(() => {
		onReady?.({ addFiles });
	}, []);
	// #endregion

	// #region Toast-mode notices
	useComposerToasts(notices, rec, sendError);
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

	// Read for its subscription: the selection's on-screen box moves when the field scrolls or the
	// draft reflows, and the bubble has to move with it.
	void editor.layoutTick.value;
	const formatRect = editor.range.value && !hasVoice ? editor.selectionRect() : null;

	return (
		<div
			ref={rootRef}
			class="chat-composer"
			data-surface={surface}
			data-project={projectId}
			data-channel={channelId}
			data-drag={drop.dragActive.value ? "true" : undefined}
			onDragEnter={drop.onDragEnter}
			onDragOver={drop.onDragOver}
			onDragLeave={drop.onDragLeave}
			onDrop={drop.onDrop}
		>
			{/* Gradient + blur underlay — a sibling, never an ancestor of the Plus popover trigger. */}
			<div class="chat-composer__scrim" aria-hidden="true" />

			<div class="chat-composer__inner">
				<ComposerReplyStrip replyTo={replyTo} />

				<ComposerAttachments
					attachments={attachments}
					pasted={pasted}
					onRemoveAttachment={removeAttachment}
					onRemovePasted={removePasted}
				/>

				{/* The floating input bar. */}
				<div class="chat-composer__bar">
					<ComposerLeadingAction
						hasVoice={hasVoice}
						plusOpen={plusOpen}
						atCapacity={atCapacity}
						onDiscard={() => rec.discard()}
						onUploadFromDevice={openDevicePicker}
						onAttachFromLibrary={openLibrary}
					/>

					{/* Field — the message editor, or the waveform while recording/recorded. */}
					<div class="chat-composer__field">
						{
							/* The editor host stays MOUNTED while a memo holds the field, only hidden: Quill
							   owns its DOM, and unmounting it would throw the instance away and rebuild it on
							   every recording. Text and voice never coexist, so it is empty while hidden. */
						}
						<div class="chat-composer__editor" hidden={hasVoice}>
							<div
								ref={editor.hostRef}
								class="chat-composer__input"
								data-placeholder="Write a message…"
								data-ready="false"
							/>
						</div>
						{hasVoice && <ComposerAudioRecorder rec={rec} canvasRef={canvasRef} />}
					</div>

					<ComposerTrailingAction
						rec={rec}
						canSend={canSend}
						oversize={oversize}
						micBlocked={micBlocked}
						sending={sending}
						onSend={() => void send()}
						gestures={gestures}
					/>
				</div>

				{notices === "inline" && <ComposerCaptureNotice rec={rec} />}

				{notices === "inline" && <ComposerSendNotice sendError={sendError} />}

				{
					/* Phase transitions announced once each, so a non-sighted viewer knows capture began,
				    paused, and ended without the clock talking over everything. The send takes the same
				    line while it runs — the two states cannot overlap, and one live region interrupts
				    less than two. */
				}
				<p class="chat-composer__sr" role="status" aria-live="polite">
					{sending.value ? "Sending your message." : voiceStatus(phase, memo?.durationMs ?? 0)}
				</p>
			</div>

			{formatRect && (
				<FormatBubble
					rect={formatRect}
					marks={editor.marks.value}
					onToggle={(mark) => editor.toggleMark(mark)}
				/>
			)}

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
