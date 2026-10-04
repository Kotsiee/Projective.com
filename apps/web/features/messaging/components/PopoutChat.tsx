import { Fragment, type JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
// Reuse the project chat message chrome (`.msg-row`/`.chat-day`) + composer verbatim.
import "@web/features/projects/styles/chat-feed.css";
import "../styles/chat-popout.css";
import { useIsMobile } from "@projective/ui/hooks";
import { buildRows, type FeedRow } from "@web/features/projects/core/message-model.ts";
import { MessageBubble } from "@web/features/projects/components/MessageBubble.tsx";
import { SystemMessage } from "@web/features/projects/components/SystemMessage.tsx";
import { MessageSelectionBar } from "@web/features/projects/components/MessageSelectionBar.tsx";
import { ReactionBubble } from "@web/features/projects/components/ReactionBubble.tsx";
import { useMessageSelection } from "@web/features/projects/hooks/useMessageSelection.ts";
import ChatComposer, {
	type ComposerHandle,
} from "@web/features/projects/islands/ChatComposer.island.tsx";
import { MessagesService as ProjectMessagesService } from "@web/features/projects/core/MessagesService.ts";
import { MESSAGE_SENT_EVENT, type MessageSentDetail } from "@web/utils/lane-events.ts";
import { ChatMessageSchema } from "@projective/types/projects";
import { MessagingService } from "../core/MessagingService.ts";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { ChatMessage, MessagePage } from "../types/messaging-types.ts";
import type { PopoutState } from "../core/popout-state.ts";
import { offlineOr } from "@web/utils/use-offline-stall.ts";

/**
 * PopoutChat — the message stream + composer inside the floating "Pop Out Chat" popover (task §1).
 * Because the shared {@link ChatFeed} virtualizes against the WINDOW scroll (wrong inside a floating
 * panel), this renders a lean, CONTAINER-scrolled message list instead — reusing the project message
 * components ({@link MessageBubble} / {@link SystemMessage}, styled by the shared `chat-feed.css`) and
 * the {@link ChatComposer} verbatim. It:
 *   - fetches the latest page for the popped-out channel (project scope) or conversation (inbox scope);
 *   - bottom-anchors on load and offers a "Load earlier" affordance (position-preserving prepend);
 *   - overlays a WHOLE-PANEL drag-and-drop drop zone that forwards dropped files into the composer's
 *     upload queue via its {@link ComposerHandle} (task §1's drag-and-drop file overlay);
 *   - appends the SERVER's row when the composer announces a send on `MESSAGE_SENT_EVENT`, so a
 *     message posted from the window appears in the window — the composer and the list are one
 *     component tree here, but the announcement is what the in-frame feed listens to as well, and
 *     one channel for "a row now exists" beats a second, private one;
 *   - runs the same highlight mode, selection, shortcuts and touch gestures as the page feed, as the
 *     `popout` surface ({@link useMessageSelection}): the keyboard is the window's while focus is
 *     inside it, and its replies go to ITS composer even when the page behind shows the same channel.
 *
 * The composer is mounted in the popout's own SCOPE (a conversation posts to the inbox's send door,
 * a project channel to the projects one) and in `toast` notice mode — a 24rem window has no room for
 * a paragraph of recovery steps under the input, so a capture or send failure goes to the shared
 * stack at `bottom-center` instead.
 */

// #region Props
export interface PopoutChatProps {
	state: PopoutState;
}
// #endregion

/** How many earlier pages a reply quote may load while looking for its original. */
const JUMP_PAGE_BUDGET = 8;

export function PopoutChat({ state }: PopoutChatProps): JSX.Element {
	const messages = useSignal<ChatMessage[]>([]);
	const loading = useSignal(true);
	const loadingOlder = useSignal(false);
	const error = useSignal<string | null>(null);
	const hasMore = useSignal(false);
	const cursor = useSignal<string | null>(null);
	const canPin = useSignal(false);
	const dragActive = useSignal(false);
	const flashId = useSignal<string | null>(null);
	const mobile = useIsMobile();

	const rootRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const composerApi = useRef<ComposerHandle | null>(null);
	const dragDepth = useRef(0);
	const settleTimers = useRef<number[]>([]);

	// #region Fetch
	function fetchPage(before: string | null): Promise<MessagePage | null> {
		if (state.scope === "conversation") {
			return MessagingService.messages(state.conversationId ?? state.channelId, before).then((r) =>
				r.ok && r.data ? r.data.page : null
			);
		}
		return ProjectMessagesService.page(state.projectId, state.channelId, before).then((r) =>
			r.ok && r.data ? r.data.page : null
		);
	}

	/**
	 * Pin to the newest message. A single `requestAnimationFrame` is not enough: the media in a
	 * message grows `scrollHeight` after that first frame, so a lone rAF lands the panel part-way up
	 * a conversation. Re-pin across a settle window (the same hardening the window-scrolled
	 * {@link ChatFeed} needed), and stop early once the panel is actually at the bottom.
	 */
	function scrollToBottom(): void {
		const pin = () => {
			const el = scrollRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		};
		pin();
		requestAnimationFrame(pin);
		const timers = [60, 180, 400].map((ms) => setTimeout(pin, ms) as unknown as number);
		settleTimers.current.forEach(clearTimeout);
		settleTimers.current = timers;
	}

	async function loadLatest(): Promise<void> {
		loading.value = true;
		error.value = null;
		const page = await fetchPage(null);
		if (page) {
			messages.value = page.messages;
			hasMore.value = page.hasMore;
			cursor.value = page.nextCursor;
			canPin.value = page.permissions.canPin;
		} else {
			// Without this the panel renders "No messages yet. Say hello 👋" on a NETWORK FAILURE —
			// a conversation with history would look brand new.
			error.value = "Couldn't load this conversation.";
		}
		loading.value = false;
		scrollToBottom();
	}

	/** Prepend the next-older page, keeping the reader's place. Resolves whether a page landed. */
	async function loadOlder(): Promise<boolean> {
		if (!hasMore.value || !cursor.value || loadingOlder.value) return false;
		const el = scrollRef.current;
		const prevHeight = el?.scrollHeight ?? 0;
		loadingOlder.value = true;
		const page = await fetchPage(cursor.value);
		loadingOlder.value = false;
		if (!page) {
			error.value = offlineOr("Couldn't load earlier messages.");
			return false;
		}
		messages.value = [...page.messages, ...messages.value];
		hasMore.value = page.hasMore;
		cursor.value = page.nextCursor;
		requestAnimationFrame(() => {
			if (el) el.scrollTop = el.scrollHeight - prevHeight;
		});
		return true;
	}

	useEffect(() => {
		void loadLatest();
		return () => {
			settleTimers.current.forEach(clearTimeout);
			settleTimers.current = [];
		};
	}, [state.projectId, state.channelId, state.conversationId]);

	/**
	 * Append a row the composer has just had persisted. Guarded exactly as the in-frame feed guards
	 * it: the channel must match (another feed on the page may be announcing), the payload must parse
	 * as a message (it crosses an untyped `CustomEvent` boundary), and an id already present is
	 * ignored so a second listener cannot double the row.
	 */
	useEffect(() => {
		function onSent(event: Event): void {
			const detail = (event as CustomEvent<MessageSentDetail>).detail;
			if (!detail || detail.channelId !== state.channelId) return;
			const parsed = ChatMessageSchema.safeParse(detail.message);
			if (!parsed.success) return;
			if (messages.value.some((m) => m.id === parsed.data.id)) return;
			messages.value = [...messages.value, parsed.data];
			scrollToBottom();
		}
		globalThis.addEventListener(MESSAGE_SENT_EVENT, onSent);
		return () => globalThis.removeEventListener(MESSAGE_SENT_EVENT, onSent);
	}, [state.channelId]);
	// #endregion

	// #region Selection (the `popout` surface)
	function rowEl(id: string): HTMLElement | null {
		return scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ??
			null;
	}

	/** Bring a message into the panel's view, moving its scroller only as far as needed. */
	function reveal(id: string): void {
		const el = rowEl(id);
		const box = scrollRef.current;
		if (!el || !box) return;
		const r = el.getBoundingClientRect();
		const b = box.getBoundingClientRect();
		if (r.top < b.top) box.scrollBy(0, r.top - b.top - 8);
		else if (r.bottom > b.bottom) box.scrollBy(0, r.bottom - b.bottom + 8);
	}

	const sel = useMessageSelection({
		surface: "popout",
		channelId: state.channelId,
		rootRef,
		messages,
		reveal,
		scrollBy: (dy) => scrollRef.current?.scrollBy(0, dy),
	});
	// #endregion

	// #region Optimistic message actions (mirrors ChatFeed)
	function updateMessage(id: string, fn: (m: ChatMessage) => ChatMessage): void {
		messages.value = messages.value.map((m) => (m.id === id ? fn(m) : m));
	}
	/** An action taken from the highlight-mode menu or the header bar ends highlight mode. */
	function done(): void {
		if (sel.active.value) sel.exit();
	}
	function toggleFavorite(id: string): void {
		updateMessage(id, (m) => ({ ...m, favorited: !m.favorited }));
		done();
	}
	function togglePin(id: string): void {
		updateMessage(id, (m) => ({ ...m, pinned: !m.pinned }));
		done();
	}
	function react(id: string, emoji: string): void {
		updateMessage(id, (m) => {
			const existing = m.reactions.find((r) => r.emoji === emoji);
			if (!existing) return { ...m, reactions: [...m.reactions, { emoji, count: 1, mine: true }] };
			if (existing.mine) {
				const reactions = existing.count <= 1
					? m.reactions.filter((r) => r.emoji !== emoji)
					: m.reactions.map((r) =>
						r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r
					);
				return { ...m, reactions };
			}
			return {
				...m,
				reactions: m.reactions.map((r) =>
					r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r
				),
			};
		});
		done();
	}
	function reply(id: string): void {
		const m = messages.value.find((x) => x.id === id);
		if (m) sel.reply(m);
	}
	function copy(id: string): void {
		const ids = sel.active.value && sel.selected.value.includes(id) ? sel.selected.value : [id];
		void sel.copy(ids);
		done();
	}
	function report(_id: string): void {
		// STUB: report/flag routes to moderation once the backend lands.
		done();
	}

	/** Scroll to a quoted original, paging backward (within a budget) when it is not loaded yet. */
	async function jumpTo(id: string): Promise<void> {
		for (let page = 0; !rowEl(id) && page < JUMP_PAGE_BUDGET && hasMore.value; page++) {
			if (!(await loadOlder())) break;
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		const el = rowEl(id);
		if (!el) {
			sel.status.value = "That message is too far back to jump to — scroll up to find it.";
			return;
		}
		el.scrollIntoView({ block: "center" });
		flashId.value = id;
		setTimeout(() => {
			if (flashId.value === id) flashId.value = null;
		}, 1800);
	}
	// #endregion

	// #region Whole-panel drop zone
	function onDragEnter(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		e.preventDefault();
		dragDepth.current += 1;
		dragActive.value = true;
	}
	function onDragOver(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		e.preventDefault();
	}
	function onDragLeave(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		e.preventDefault();
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) dragActive.value = false;
	}
	function onDrop(e: JSX.TargetedDragEvent<HTMLDivElement>): void {
		e.preventDefault();
		dragDepth.current = 0;
		dragActive.value = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0 && composerApi.current) composerApi.current.addFiles(files);
	}
	// #endregion

	const selectedCount = sel.selected.value.length;

	function renderRow(row: FeedRow): JSX.Element {
		if (row.kind === "divider") {
			return (
				<div class="chat-day">
					<span class="chat-day__label">{row.day}</span>
				</div>
			);
		}
		if (row.message.type === "system") return <SystemMessage message={row.message} />;
		return (
			<div
				class="pop-chat__row"
				data-highlight={flashId.value === row.message.id ? "true" : undefined}
			>
				<MessageBubble
					row={row}
					canPin={canPin.value}
					onReply={reply}
					onReact={react}
					onCopy={copy}
					onTogglePin={togglePin}
					onToggleFavorite={toggleFavorite}
					onReport={report}
					onJump={(id) => void jumpTo(id)}
					selection={sel.rowFor(row.message)}
					selectionCount={selectedCount}
				/>
			</div>
		);
	}

	const rows = buildRows(messages.value);
	const reactFor = sel.reactFor.value;

	return (
		<div
			class="pop-chat"
			ref={rootRef}
			data-chat-surface="popout"
			data-drag={dragActive.value ? "true" : undefined}
			data-msg-highlight={sel.active.value ? "true" : undefined}
			data-msg-shift={sel.shift.value ? "true" : undefined}
			data-msg-touch={sel.touch.value ? "true" : undefined}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<div class="pop-chat__scroll" ref={scrollRef}>
				<MessageSelectionBar
					selection={sel}
					messages={messages.value}
					canPin={canPin.value}
					mobile={mobile}
					onReply={(m) => sel.reply(m)}
					onTogglePin={togglePin}
					onToggleFavorite={toggleFavorite}
					onReport={report}
				/>
				{loading.value
					? <p class="pop-chat__hint">Loading conversation…</p>
					: error.value && messages.value.length === 0
					? (
						<div class="pop-chat__failed" role="alert">
							<p class="pop-chat__hint">{error.value}</p>
							<button type="button" class="pop-chat__earlier" onClick={() => void loadLatest()}>
								Try again
							</button>
						</div>
					)
					: messages.value.length === 0
					? <p class="pop-chat__hint">No messages yet. Say hello 👋</p>
					: (
						<>
							{hasMore.value && (
								<button
									type="button"
									class="pop-chat__earlier"
									disabled={loadingOlder.value}
									aria-busy={loadingOlder.value ? "true" : undefined}
									onClick={() => void loadOlder()}
								>
									{loadingOlder.value ? "Loading…" : "Load earlier"}
								</button>
							)}
							{rows.map((row) => <Fragment key={row.key}>{renderRow(row)}</Fragment>)}
						</>
					)}
			</div>

			<div class="pop-chat__composer">
				<ChatComposer
					scope={state.scope}
					surface="popout"
					projectId={state.projectId}
					channelId={state.channelId}
					notices="toast"
					onReady={(api) => (composerApi.current = api)}
				/>
			</div>

			<div class="pop-chat__drop" aria-hidden="true">
				<span class="pop-chat__drop-label">
					<MessagingIcon name="files" />
					Drop files to attach
				</span>
			</div>

			{reactFor && sel.touch.value && (
				<ReactionBubble
					messageId={reactFor}
					rootRef={rootRef}
					onReact={(emoji) => react(reactFor, emoji)}
				/>
			)}

			<p class="pop-chat__sr" role="status" aria-live="polite">{sel.status.value}</p>
		</div>
	);
}
