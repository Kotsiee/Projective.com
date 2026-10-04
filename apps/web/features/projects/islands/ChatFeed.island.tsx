import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import "../styles/chat-feed.css";
import { useIntersectionObserver, useIsMobile, useVirtualScroll } from "@projective/ui/hooks";
import { InlineNotice } from "@projective/ui/feedback";
import { OFFLINE_NOTICE_TEXT } from "@web/utils/offline.ts";
import { useOfflineStall } from "@web/utils/use-offline-stall.ts";
import type { ChatMessage, MessagePage } from "../types/projects-types.ts";
import {
	buildRows,
	estimateRowSize,
	type FeedRow,
	rowIndexOfMessage,
} from "../core/message-model.ts";
import { MessagesService } from "../core/MessagesService.ts";
import { MESSAGE_SENT_EVENT, type MessageSentDetail } from "@web/utils/lane-events.ts";
import { ChatMessageSchema } from "@projective/types/projects";
import { ProjectSkeleton, useSkeletonDelay } from "../components/ProjectSkeletons.tsx";
import { MessageBubble } from "../components/MessageBubble.tsx";
import { SystemMessage } from "../components/SystemMessage.tsx";
import { PinnedBanner } from "../components/PinnedBanner.tsx";
import { ChatEmptyState } from "../components/ChatEmptyState.tsx";
import { MessageSelectionBar } from "../components/MessageSelectionBar.tsx";
import { ReactionBubble } from "../components/ReactionBubble.tsx";
import { useMessageSelection } from "../hooks/useMessageSelection.ts";

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
 * Highlight mode, selection, the unfocused-composer shortcuts and the touch gestures come from
 * {@link useMessageSelection} as the `page` surface; this island supplies how a message is revealed
 * in a window-virtualized list, and renders the count pill (or, on a phone, the header action bar)
 * and the long-press reaction bubble. A reply is handed to the footer composer on
 * `MESSAGE_REPLY_EVENT`, and a reply's quote jumps to its original — loading earlier pages first when
 * the original is above the loaded window.
 *
 * THIN: first paint is the SSR-resolved latest page; the island owns view state (loaded window, pins,
 * reactions/favourites) and paginates via the API. Pins/reactions are optimistic — persistence lands
 * with the messaging backend behind `PROJECTS_BACKEND_LIVE`.
 */

export interface ChatFeedProps {
	projectId: string;
	channelId: string;
	/** SSR-resolved latest page, or null when the channel resolved to nothing. */
	initial: MessagePage | null;
	/**
	 * Optional custom older-page loader. When set, load-on-scroll-up calls this instead of the default
	 * project-channel pager (`MessagesService.page`) — so the SAME feed drives both a project channel
	 * (`/projects/…/chat`) and a global inbox conversation (`/messages/[id]/chat`, unified by `chatId`).
	 * Returns the strictly-older page for the cursor, or `null` on failure/exhaustion.
	 */
	loadOlder?: (cursor: string) => Promise<MessagePage | null>;
}

/** Sticky chrome to clear when jumping to a message (top bar + header band + pinned banner). */
const JUMP_CLEARANCE = 150;
/** How many earlier pages a reply quote may load while looking for its original. */
const JUMP_PAGE_BUDGET = 8;

export default function ChatFeed(
	{ projectId, channelId, initial, loadOlder: customLoadOlder }: ChatFeedProps,
): JSX.Element {
	// #region State
	const messages = useSignal<ChatMessage[]>(initial?.messages ?? []);
	const hasMore = useSignal<boolean>(initial?.hasMore ?? false);
	const cursor = useSignal<string | null>(initial?.nextCursor ?? null);
	const loadingOlder = useSignal(false);
	/**
	 * The placeholder gate, kept separate from {@link loadingOlder} on purpose: that flag is the
	 * re-entrancy guard and has to flip the instant a fetch starts, while this one only decides
	 * whether the wait has lasted long enough to be worth drawing.
	 */
	const skeleton = useSkeletonDelay();
	const highlightId = useSignal<string | null>(null);
	const canPin = initial?.permissions.canPin ?? false;
	const mobile = useIsMobile();

	const rootRef = useRef<HTMLDivElement>(null);
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

	/**
	 * Re-measure a row whenever its height changes after it mounted.
	 *
	 * The virtualizer measures a row when it is first drawn and never again, and a row's height moves
	 * after that more often than it looks: a long message's Show more, an image finishing loading, a
	 * reaction row appearing. Without this the next row keeps its old offset and the grown one slides
	 * underneath it. One observer for the whole feed; a row is observed while it is drawn.
	 */
	const resizeRef = useRef<ResizeObserver | null>(null);
	const measureRef = useRef(vs.measureElement);
	measureRef.current = vs.measureElement;
	useEffect(() => () => resizeRef.current?.disconnect(), []);
	const measureRow = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		measureRef.current(el);
		// Created on the first row rather than in an effect: the rows drawn by the first render mount
		// before any effect runs, and would otherwise never be observed.
		if (!resizeRef.current && typeof ResizeObserver !== "undefined") {
			resizeRef.current = new ResizeObserver((entries) => {
				for (const entry of entries) {
					// A row the virtualizer has scrolled away is let go rather than held for the session.
					if (!entry.target.isConnected) resizeRef.current?.unobserve(entry.target);
					else measureRef.current(entry.target as HTMLElement);
				}
			});
		}
		resizeRef.current?.observe(el);
	}, []);
	// #endregion

	// #region Load older (top sentinel → prepend → re-anchor)
	const topVisible = useIntersectionObserver({
		targetRef: sentinelRef,
		rootMargin: "600px 0px 0px 0px",
	}).visible;

	/** Fetch the next-older page. Resolves whether a page actually landed. */
	async function loadOlder(): Promise<boolean> {
		// A stalled feed waits for Retry (or the reconnection): the top sentinel stays in view after a
		// failed page, and without this guard every intersection change would re-fire the request.
		if (loadingOlder.value || stall.blocked.value || !hasMore.value || !cursor.value) return false;
		loadingOlder.value = true;
		skeleton.begin();
		const doc = document.scrollingElement ?? document.documentElement;
		anchorRef.current = doc.scrollHeight;
		let landed = false;
		try {
			const page = customLoadOlder
				? await customLoadOlder(cursor.value)
				: await MessagesService.page(projectId, channelId, cursor.value).then((res) =>
					res.ok && res.data ? res.data.page : null
				);
			if (page) {
				landed = true;
				messages.value = [...page.messages, ...messages.value];
				hasMore.value = page.hasMore;
				cursor.value = page.nextCursor;
			} else {
				anchorRef.current = null;
			}
		} catch {
			anchorRef.current = null;
		} finally {
			loadingOlder.value = false;
			skeleton.end();
			stall.settle(landed);
		}
		return landed;
	}
	/** The offline stall for the OLDER edge — this feed loads upward, so its notice sits at the top. */
	const stall = useOfflineStall(async () => {
		await loadOlder();
	});

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
	// The feed opens on the NEWEST message. Every navigation is a full page load, so this mounts fresh
	// each time; we pin to the end immediately and again as the variable-height rows measure in, on the
	// SAME window scroller the feed virtualizes against (`vs.scrollToEnd`, `useWindow`).
	useEffect(() => {
		vs.scrollToEnd("auto");
		const timers = [60, 220, 480].map((ms) => setTimeout(() => vs.scrollToEnd("auto"), ms));
		return () => timers.forEach(clearTimeout);
	}, []);
	// #endregion

	// #region Appending what the composer just sent
	/**
	 * The composer lives in the footer BAND and this feed in the body, so they are separate hydration
	 * roots that cannot call each other. It announces a persisted message on `window`; this appends it
	 * and re-pins to the bottom, which is what makes a send visible without a reload.
	 *
	 * Guarded three ways, because the event is global: the channel must match (a pop-out chat on
	 * another conversation is on the same page), the payload must actually parse as a message (it
	 * crosses an untyped `CustomEvent` boundary), and an id already present is ignored — a re-send or
	 * a second listener must not double the row.
	 */
	useEffect(() => {
		function onSent(event: Event): void {
			const detail = (event as CustomEvent<MessageSentDetail>).detail;
			if (!detail || detail.channelId !== channelId) return;
			const parsed = ChatMessageSchema.safeParse(detail.message);
			if (!parsed.success) return;
			if (messages.value.some((m) => m.id === parsed.data.id)) return;
			messages.value = [...messages.value, parsed.data];
			// After the row has been laid out, not before — the feed virtualizes against the window, so
			// pinning in the same tick scrolls to where the end USED to be.
			requestAnimationFrame(() => vs.scrollToEnd("auto"));
		}
		globalThis.addEventListener(MESSAGE_SENT_EVENT, onSent);
		return () => globalThis.removeEventListener(MESSAGE_SENT_EVENT, onSent);
	}, [channelId]);
	// #endregion

	// #region Reveal (keyboard cursor) — window-virtualized
	/**
	 * Bring a message fully into the readable band — below the sticky header chrome and above the
	 * footer composer — moving the window only as far as needed. A row the virtualizer has not drawn
	 * is scrolled to by index instead, which also draws it.
	 */
	function reveal(id: string): void {
		const el = rootRef.current?.querySelector<HTMLElement>(
			`[data-message-id="${CSS.escape(id)}"]`,
		);
		if (!el) {
			const idx = rowIndexOfMessage(buildRows(messages.value), id);
			if (idx >= 0) vs.scrollToIndex(idx, -JUMP_CLEARANCE);
			return;
		}
		const rect = el.getBoundingClientRect();
		const footer = document.querySelector(".ui-middle-nav__footer")?.getBoundingClientRect();
		const bottom = footer && footer.top > 0 ? footer.top : globalThis.innerHeight;
		if (rect.top < JUMP_CLEARANCE) globalThis.scrollBy(0, rect.top - JUMP_CLEARANCE);
		else if (rect.bottom > bottom) globalThis.scrollBy(0, rect.bottom - bottom + 12);
	}

	const sel = useMessageSelection({
		surface: "page",
		channelId,
		rootRef,
		messages,
		reveal,
		scrollBy: (dy) => globalThis.scrollBy(0, dy),
	});
	// #endregion

	// #region Message actions (optimistic, immutable)
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
					: m.reactions.map((
						r,
					) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
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
	/** Copy: the whole selection when this message is part of it, else just this message. */
	function copy(id: string): void {
		const ids = sel.active.value && sel.selected.value.includes(id) ? sel.selected.value : [id];
		void sel.copy(ids);
		done();
	}
	function report(_id: string): void {
		// STUB: report/flag routes to moderation once the backend lands.
		done();
	}
	// #endregion

	// #region Jump to a (pinned or quoted) message
	function flash(id: string): void {
		highlightId.value = id;
		setTimeout(() => {
			if (highlightId.value === id) highlightId.value = null;
		}, 1800);
	}

	/**
	 * Scroll to a message and flash it. A reply's original can be older than anything loaded, so this
	 * pages backward — within a budget, so a quote of a very old message cannot pull a whole history —
	 * until it lands, and says so when it cannot.
	 */
	async function jumpTo(id: string): Promise<void> {
		let idx = rowIndexOfMessage(buildRows(messages.value), id);
		for (let page = 0; idx < 0 && page < JUMP_PAGE_BUDGET && hasMore.value; page++) {
			if (!(await loadOlder())) break;
			idx = rowIndexOfMessage(buildRows(messages.value), id);
		}
		if (idx < 0) {
			sel.status.value = "That message is too far back to jump to — scroll up to find it.";
			return;
		}
		vs.scrollToIndex(idx, -JUMP_CLEARANCE);
		flash(id);
	}
	// #endregion

	// #region Empty state
	/*
	 * Decided by the LIVE list, never by the page's `total`. The SSR page of a brand-new conversation
	 * reports `total: 0`, and a check on that constant kept the empty state on screen after the first
	 * message had been sent and announced — the row was in the list and the feed still said "quiet".
	 * The first message in a fresh thread is exactly the send a person watches for.
	 */
	if (messages.value.length === 0 && !hasMore.value) {
		return (
			<div class="chat-feed chat-feed--empty">
				<ChatEmptyState />
			</div>
		);
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
			<MessageBubble
				row={row}
				canPin={canPin}
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
		);
	}

	const reactFor = sel.reactFor.value;

	return (
		<div
			class="chat-feed"
			ref={rootRef}
			data-msg-highlight={sel.active.value ? "true" : undefined}
			data-msg-shift={sel.shift.value ? "true" : undefined}
			data-msg-touch={sel.touch.value ? "true" : undefined}
			data-has-pinned={pinned.length > 0 ? "true" : undefined}
		>
			<PinnedBanner pinned={pinned} onJump={(id) => void jumpTo(id)} />

			<MessageSelectionBar
				selection={sel}
				messages={messages.value}
				canPin={canPin}
				mobile={mobile}
				onReply={(m) => sel.reply(m)}
				onTogglePin={togglePin}
				onToggleFavorite={toggleFavorite}
				onReport={report}
			/>

			<div
				class="chat-feed__viewport"
				ref={viewportRef}
				role="feed"
				aria-label="Messages"
				aria-busy={loadingOlder.value ? "true" : "false"}
			>
				<div class="chat-feed__sentinel" ref={sentinelRef} aria-hidden="true" />
				{
					/* The loading edge of this list is its TOP, so the offline notice lands there rather
					   than at the foot beside the composer. In flow, not an overlay: its Retry must be
					   clickable, which the pointer-transparent skeleton beneath deliberately is not. */
				}
				{stall.stalled.value && (
					<InlineNotice
						class="chat-feed__stall"
						text={OFFLINE_NOTICE_TEXT}
						actionLabel="Retry"
						onAction={stall.retry}
						busy={stall.retrying.value}
					/>
				)}
				{
					/*
					 * `.chat-feed__older` is an absolutely-positioned, pointer-transparent overlay, so the
					 * placeholder costs the stream no height: the document grows only by the prepended
					 * messages, and the layout effect below re-anchors by exactly that delta.
					 */
				}
				{skeleton.visible.value && (
					<div class="chat-feed__older">
						<ProjectSkeleton shape="chat" label="Loading earlier messages…" />
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
								ref={measureRow}
								style={`--v-start:${vi.start}px`}
							>
								{renderRow(row)}
							</div>
						);
					})}
				</div>
			</div>

			{reactFor && sel.touch.value && (
				<ReactionBubble
					messageId={reactFor}
					rootRef={rootRef}
					onReact={(emoji) => react(reactFor, emoji)}
				/>
			)}

			<p class="chat-feed__sr" role="status" aria-live="polite">{sel.status.value}</p>
		</div>
	);
}
