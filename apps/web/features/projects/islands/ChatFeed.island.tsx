import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import "../styles/chat-feed.css";
import { useIntersectionObserver, useVirtualScroll } from "@projective/ui/hooks";
import type { ChatMessage, MessagePage } from "../types/projects-types.ts";
import {
	buildRows,
	estimateRowSize,
	type FeedRow,
	rowIndexOfMessage,
} from "../core/message-model.ts";
import { MessagesService } from "../core/MessagesService.ts";
import { MessageBubble } from "../components/MessageBubble.tsx";
import { SystemMessage } from "../components/SystemMessage.tsx";
import { PinnedBanner } from "../components/PinnedBanner.tsx";
import { ChatEmptyState } from "../components/ChatEmptyState.tsx";

/**
 * ChatFeed — the bottom-up, virtualized message stream for a channel's Chat tab
 * (`/projects/[projectId]/[channelId]/chat`). The one island the Chat page mounts; every message
 * component renders inside it (one hydration boundary, root CLAUDE.md §2).
 *
 * Scroll + virtualization (task §1):
 *   - It virtualizes against the NATIVE WINDOW scroll ({@link useVirtualScroll} `useWindow`, Decision
 *     #31) — never an inner scroll container — rendering only the rows in view (+ overscan) over a
 *     full-height sizer, so DOM cost stays fixed for an unbounded history. Variable message heights are
 *     measured at runtime; rows are keyed by message id so a head-prepend never corrupts the offset table.
 *   - It OPENS at the bottom (newest) and loads OLDER history as the viewer scrolls up: a top sentinel
 *     (IntersectionObserver) fetches the previous page via the thin {@link MessagesService}, prepends it,
 *     and a layout-effect re-anchors the scroll by the exact height the document grew, so the viewed
 *     message stays put (no jump).
 *
 * THIN: first paint is the SSR-resolved latest page; the island owns view state (loaded window, pins,
 * reactions/favourites) and paginates via the API. Sends/pins/reactions are optimistic — persistence
 * lands with the messaging backend behind `PROJECTS_BACKEND_LIVE`.
 */

export interface ChatFeedProps {
	projectId: string;
	channelId: string;
	/** SSR-resolved latest page, or null when the channel resolved to nothing. */
	initial: MessagePage | null;
}

/** Sticky chrome to clear when jumping to a message (top bar + header band + pinned banner). */
const JUMP_CLEARANCE = 150;

export default function ChatFeed({ projectId, channelId, initial }: ChatFeedProps): JSX.Element {
	// #region State
	const messages = useSignal<ChatMessage[]>(initial?.messages ?? []);
	const hasMore = useSignal<boolean>(initial?.hasMore ?? false);
	const cursor = useSignal<string | null>(initial?.nextCursor ?? null);
	const loadingOlder = useSignal(false);
	const highlightId = useSignal<string | null>(null);
	const canPin = initial?.permissions.canPin ?? false;
	const total = initial?.total ?? 0;

	const viewportRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	// The document scrollHeight captured just before a prepend, to re-anchor after the reflow.
	const anchorRef = useRef<number | null>(null);
	// #endregion

	const rows = buildRows(messages.value);
	const pinned = messages.value.filter((m) => m.pinned).slice(-3).reverse();

	// #region Virtualization (window scroll, variable heights, id-keyed)
	const vs = useVirtualScroll({
		count: rows.length,
		itemSize: (i) => estimateRowSize(rows[i]),
		useWindow: true,
		parentRef: viewportRef,
		getItemKey: (i) => rows[i].key,
		overscan: 6,
	});
	// #endregion

	// #region Load older (top sentinel → prepend → re-anchor)
	const topVisible = useIntersectionObserver({
		targetRef: sentinelRef,
		rootMargin: "600px 0px 0px 0px",
	}).visible;

	async function loadOlder(): Promise<void> {
		if (loadingOlder.value || !hasMore.value || !cursor.value) return;
		loadingOlder.value = true;
		const doc = document.scrollingElement ?? document.documentElement;
		anchorRef.current = doc.scrollHeight;
		try {
			const res = await MessagesService.page(projectId, channelId, cursor.value);
			if (res.ok && res.data) {
				messages.value = [...res.data.page.messages, ...messages.value];
				hasMore.value = res.data.page.hasMore;
				cursor.value = res.data.page.nextCursor;
			} else {
				anchorRef.current = null;
			}
		} catch {
			anchorRef.current = null;
		} finally {
			loadingOlder.value = false;
		}
	}

	useSignalEffect(() => {
		if (topVisible.value) void loadOlder();
	});

	// After a prepend grows the document above the viewport, add the delta back so the view stays put.
	useLayoutEffect(() => {
		if (anchorRef.current == null) return;
		const doc = document.scrollingElement ?? document.documentElement;
		const delta = doc.scrollHeight - anchorRef.current;
		anchorRef.current = null;
		if (delta !== 0) globalThis.scrollBy(0, delta);
	}, [messages.value.length]);
	// #endregion

	// #region Open at the bottom (re-pin as measurements settle)
	useEffect(() => {
		vs.scrollToEnd("auto");
		const timers = [60, 220, 480].map((ms) => setTimeout(() => vs.scrollToEnd("auto"), ms));
		return () => timers.forEach(clearTimeout);
	}, []);
	// #endregion

	// #region Message actions (optimistic, immutable)
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
					: m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
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
	function reply(_id: string): void {
		// STUB: threaded reply lands with the messaging backend (the composer is a separate footer island).
	}
	function report(_id: string): void {
		// STUB: report/flag routes to moderation once the backend lands.
	}
	// #endregion

	// #region Jump to a (pinned) message
	function jumpTo(id: string): void {
		const idx = rowIndexOfMessage(buildRows(messages.value), id);
		if (idx < 0) return;
		vs.scrollToIndex(idx, -JUMP_CLEARANCE);
		highlightId.value = id;
		setTimeout(() => {
			if (highlightId.value === id) highlightId.value = null;
		}, 1800);
	}
	// #endregion

	// #region Empty state
	if (total === 0 || (messages.value.length === 0 && !hasMore.value)) {
		return (
			<div class="chat-feed chat-feed--empty">
				<ChatEmptyState />
			</div>
		);
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
				canPin={canPin}
				onReply={reply}
				onReact={react}
				onTogglePin={togglePin}
				onToggleFavorite={toggleFavorite}
				onReport={report}
			/>
		);
	}

	return (
		<div class="chat-feed">
			<PinnedBanner pinned={pinned} onJump={jumpTo} />

			<div class="chat-feed__viewport" ref={viewportRef}>
				<div class="chat-feed__sentinel" ref={sentinelRef} aria-hidden="true" />
				{loadingOlder.value && (
					<div class="chat-feed__older" role="status" aria-live="polite">
						<span class="chat-feed__spinner" aria-hidden="true" />
						<span class="ui-visually-hidden">Loading earlier messages…</span>
					</div>
				)}

				<div class="chat-feed__sizer" style={`height:${vs.totalSize}px`}>
					{vs.virtualItems.map((vi) => {
						const row = rows[vi.index];
						if (!row) return null;
						const highlight = row.kind === "message" && highlightId.value === row.message.id;
						return (
							<div
								key={row.key}
								class="chat-feed__row"
								data-index={vi.index}
								data-highlight={highlight ? "true" : undefined}
								ref={vs.measureElement}
								style={`--v-start:${vi.start}px`}
							>
								{renderRow(row)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
