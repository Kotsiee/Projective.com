import { Fragment, type JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
// Reuse the project chat message chrome (`.msg-row`/`.chat-day`) + composer verbatim.
import "@web/features/projects/styles/chat-feed.css";
import "../styles/chat-popout.css";
import { buildRows, type FeedRow } from "@web/features/projects/core/message-model.ts";
import { MessageBubble } from "@web/features/projects/components/MessageBubble.tsx";
import { SystemMessage } from "@web/features/projects/components/SystemMessage.tsx";
import ChatComposer, {
	type ComposerHandle,
} from "@web/features/projects/islands/ChatComposer.island.tsx";
import { MessagesService as ProjectMessagesService } from "@web/features/projects/core/MessagesService.ts";
import { MessagingService } from "../core/MessagingService.ts";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { ChatMessage, MessagePage } from "../types/messaging-types.ts";
import type { PopoutState } from "../core/popout-state.ts";

/**
 * PopoutChat — the message stream + composer inside the floating "Pop Out Chat" popover (task §1).
 * Because the shared {@link ChatFeed} virtualizes against the WINDOW scroll (wrong inside a floating
 * panel), this renders a lean, CONTAINER-scrolled message list instead — reusing the project message
 * components ({@link MessageBubble} / {@link SystemMessage}, styled by the shared `chat-feed.css`) and
 * the {@link ChatComposer} verbatim. It:
 *   - fetches the latest page for the popped-out channel (project scope) or conversation (inbox scope);
 *   - bottom-anchors on load and offers a "Load earlier" affordance (position-preserving prepend);
 *   - overlays a WHOLE-PANEL drag-and-drop drop zone that forwards dropped files into the composer's
 *     upload queue via its {@link ComposerHandle} (task §1's drag-and-drop file overlay).
 */

// #region Props
export interface PopoutChatProps {
	state: PopoutState;
}
// #endregion

export function PopoutChat({ state }: PopoutChatProps): JSX.Element {
	const messages = useSignal<ChatMessage[]>([]);
	const loading = useSignal(true);
	const loadingOlder = useSignal(false);
	const error = useSignal<string | null>(null);
	const hasMore = useSignal(false);
	const cursor = useSignal<string | null>(null);
	const canPin = useSignal(false);
	const dragActive = useSignal(false);

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

	async function loadOlder(): Promise<void> {
		if (!hasMore.value || !cursor.value || loadingOlder.value) return;
		const el = scrollRef.current;
		const prevHeight = el?.scrollHeight ?? 0;
		loadingOlder.value = true;
		const page = await fetchPage(cursor.value);
		loadingOlder.value = false;
		if (!page) {
			error.value = "Couldn't load earlier messages.";
			return;
		}
		messages.value = [...page.messages, ...messages.value];
		hasMore.value = page.hasMore;
		cursor.value = page.nextCursor;
		requestAnimationFrame(() => {
			if (el) el.scrollTop = el.scrollHeight - prevHeight;
		});
	}

	useEffect(() => {
		void loadLatest();
		return () => {
			settleTimers.current.forEach(clearTimeout);
			settleTimers.current = [];
		};
	}, [state.projectId, state.channelId, state.conversationId]);
	// #endregion

	// #region Optimistic message actions (mirrors ChatFeed)
	function updateMessage(id: string, fn: (m: ChatMessage) => ChatMessage): void {
		messages.value = messages.value.map((m) => (m.id === id ? fn(m) : m));
	}
	function toggleFavorite(id: string): void {
		updateMessage(id, (m) => ({ ...m, favorited: !m.favorited }));
	}
	function togglePin(id: string): void {
		updateMessage(id, (m) => ({ ...m, pinned: !m.pinned }));
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
	}
	const noop = (): void => {};
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
			<MessageBubble
				row={row}
				canPin={canPin.value}
				onReply={noop}
				onReact={react}
				onTogglePin={togglePin}
				onToggleFavorite={toggleFavorite}
				onReport={noop}
			/>
		);
	}

	const rows = buildRows(messages.value);

	return (
		<div
			class="pop-chat"
			data-drag={dragActive.value ? "true" : undefined}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<div class="pop-chat__scroll" ref={scrollRef}>
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
					projectId={state.projectId}
					channelId={state.channelId}
					onReady={(api) => (composerApi.current = api)}
				/>
			</div>

			<div class="pop-chat__drop" aria-hidden="true">
				<span class="pop-chat__drop-label">
					<MessagingIcon name="files" />
					Drop files to attach
				</span>
			</div>
		</div>
	);
}
