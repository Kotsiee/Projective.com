import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { useIntersectionObserver, useVirtualScroll } from "@projective/ui/hooks";
import { styleVars } from "@ui/core/style.ts";
import { OFFLINE_NOTICE_TEXT } from "@web/utils/offline.ts";
import type { LedgerLine } from "../types/wallet-types.ts";
import { ledgerFeed, type LedgerFeedItem } from "../core/wallet-home.ts";
import { LedgerRow } from "./LedgerRow.tsx";

// #region Preview (the overview's section)
/** Props for {@link LedgerPreview}. */
export interface LedgerPreviewProps {
	lines: readonly LedgerLine[];
	/** How many of the newest lines to draw. */
	limit: number;
	/** The full ledger's address. */
	href: string;
	error: string | null;
	loading: boolean;
	mounted: boolean;
	onOpen: (line: LedgerLine) => void;
	onRetry: () => void;
}

/** The overview's newest lines, grouped as the full ledger groups them, with a link to the rest. */
export function LedgerPreview(props: LedgerPreviewProps): JSX.Element {
	const items = ledgerFeed(props.lines.slice(0, props.limit));
	return (
		<section class="wlt-section wlt-ledger" id="transactions" aria-labelledby="wlt-ledger-title">
			<header class="wlt-section__head">
				<h2 id="wlt-ledger-title" class="wlt-section__title">Recent transactions</h2>
				{props.lines.length > 0 && (
					<a class="wlt-textlink" href={props.href}>
						View all
						<Icon name="chevron-right" size="xs" class="wlt-mirror" />
					</a>
				)}
			</header>
			{items.length > 0 && (
				<ol class="wlt-feed wlt-feed--static" aria-label="Recent transactions">
					{items.map((item) => (
						<FeedEntry key={item.key} item={item} mounted={props.mounted} onOpen={props.onOpen} />
					))}
				</ol>
			)}
			{props.lines.length === 0 && !props.error && (
				<p class="wlt-empty">
					No transactions yet. Money in and out of this wallet will appear here.
				</p>
			)}
			{props.error && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.loading}
					align="start"
					class="wlt-notice"
				/>
			)}
		</section>
	);
}
// #endregion

function FeedEntry(
	{ item, mounted, onOpen }: {
		item: LedgerFeedItem;
		mounted: boolean;
		onOpen: (line: LedgerLine) => void;
	},
): JSX.Element {
	return item.type === "group"
		? (
			<li class="wlt-feed__group">
				<h3 class="wlt-feed__heading">{item.label}</h3>
			</li>
		)
		: (
			<li class="wlt-feed__line">
				<LedgerRow line={item.line} mounted={mounted} onOpen={onOpen} />
			</li>
		);
}

// #region Feed (the Transactions page)
/** Props for {@link LedgerFeed}. */
export interface LedgerFeedProps {
	lines: readonly LedgerLine[];
	hasMore: boolean;
	/** A page is being fetched (the first, after a filter change, or the next). */
	loading: boolean;
	/** The last page failed while online, with the sentence to show. */
	error: string | null;
	/** The last page failed while OFFLINE (`useOfflineStall`): the tail shows the offline notice. */
	stalled: boolean;
	retrying: boolean;
	/** Whether any filter narrows the ledger — decides what an empty ledger says. */
	filtered: boolean;
	mounted: boolean;
	onOpen: (line: LedgerLine) => void;
	/** Fetch the next keyset page; the caller guards against double fetches and a stalled tail. */
	onMore: () => void;
	onRetry: () => void;
	onStallRetry: () => void;
	onClearFilters: () => void;
}

/** Estimated heights (px) the window is laid out with until each entry is measured. */
const ROW_ESTIMATE = 72;
const GROUP_ESTIMATE = 44;
/** Placeholder rows held at the tail while a page is in flight, so the next rows land where they were. */
const TAIL_PLACEHOLDERS = 3;
/** Placeholder rows while the first page of a (re)filtered ledger is in flight. */
const FIRST_PLACEHOLDERS = 6;

type Entry = LedgerFeedItem | { type: "placeholder"; key: string };

/**
 * The full ledger as a windowed feed: only the entries near the viewport are in the DOM
 * (`useVirtualScroll` over the WINDOW's scroll — the sheet scrolls with the page), each absolutely
 * placed at its offset and measured once it renders, so a ledger of thousands of lines costs the same
 * as one of forty. Pages are keyset pages: a sentinel past the last entry (`useIntersectionObserver`,
 * with a generous margin, so the next page is usually in before the reader reaches the end) asks for
 * the next one.
 *
 * No layout shift while pages arrive: a page in flight holds {@link TAIL_PLACEHOLDERS} placeholder rows
 * of the estimated height at the tail, and the rows that replace them take the same slots; entries
 * above the viewport never change height once measured. A page that failed offline stalls the tail
 * with the app's one offline notice and a Retry (`useOfflineStall`); any other failure says so in its
 * own words with Try again.
 */
export function LedgerFeed(props: LedgerFeedProps): JSX.Element {
	const listRef = useRef<HTMLOListElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const first = props.loading && props.lines.length === 0;
	const tail = props.loading && props.hasMore;
	// Rebuilt only when the lines or the loading shape change, so the window's offset table (keyed on
	// these callbacks) is not recomputed on every render.
	const entries = useMemo<Entry[]>(() => {
		const placeholders = (n: number): Entry[] =>
			Array.from({ length: n }, (_, i) => ({ type: "placeholder" as const, key: `p${i}` }));
		if (first) return placeholders(FIRST_PLACEHOLDERS);
		const feed = ledgerFeed(props.lines);
		return tail ? [...feed, ...placeholders(TAIL_PLACEHOLDERS)] : feed;
	}, [props.lines, first, tail]);
	const itemSize = useCallback(
		(i: number) => (entries[i]?.type === "group" ? GROUP_ESTIMATE : ROW_ESTIMATE),
		[entries],
	);
	const itemKey = useCallback((i: number) => entries[i]?.key ?? i, [entries]);

	// ONE list element from the first render on: the window measures the list's page offset from it, so
	// it must never be swapped for another element after mount.
	const virtual = useVirtualScroll({
		count: entries.length,
		itemSize,
		overscan: 6,
		useWindow: true,
		parentRef: listRef,
		getItemKey: itemKey,
	});

	const { visible } = useIntersectionObserver({
		targetRef: sentinelRef,
		rootMargin: "0px 0px 900px 0px",
	});
	const near = visible.value;
	useEffect(() => {
		if (near && props.hasMore && !props.loading && !props.error && !props.stalled) props.onMore();
	}, [near, props.lines.length, props.hasMore, props.loading, props.error, props.stalled]);

	return (
		<div class="wlt-feedbox">
			<ol
				ref={listRef}
				class="wlt-feed wlt-feed--virtual"
				aria-label="Transactions"
				aria-busy={props.loading ? "true" : "false"}
				style={styleVars({ "--wlt-feed-h": `${virtual.totalSize}px` })}
			>
				{virtual.virtualItems.map((v) => {
					const entry = entries[v.index];
					if (!entry) return null;
					return (
						<li
							key={entry.key}
							ref={virtual.measureElement}
							data-index={v.index}
							class={entry.type === "group"
								? "wlt-feed__slot wlt-feed__group"
								: "wlt-feed__slot wlt-feed__line"}
							style={styleVars({ "--wlt-feed-y": `${v.start}px` })}
						>
							{entry.type === "group" && <h3 class="wlt-feed__heading">{entry.label}</h3>}
							{entry.type === "line" && (
								<LedgerRow line={entry.line} mounted={props.mounted} onOpen={props.onOpen} />
							)}
							{entry.type === "placeholder" && (
								<span class="wlt-lrow wlt-lrow--placeholder" aria-hidden="true" />
							)}
						</li>
					);
				})}
			</ol>
			<div ref={sentinelRef} class="wlt-feed__sentinel" aria-hidden="true" />

			{props.lines.length === 0 && !props.loading && !props.error && !props.stalled && (
				props.filtered
					? (
						<div class="wlt-feed__empty">
							<p class="wlt-empty">No transactions match these filters.</p>
							<Button
								variant="text"
								size="sm"
								label="Clear filters"
								onClick={props.onClearFilters}
							/>
						</div>
					)
					: (
						<p class="wlt-empty">
							No transactions yet. Money in and out of this wallet will appear here.
						</p>
					)
			)}
			{props.stalled && (
				<InlineNotice
					text={OFFLINE_NOTICE_TEXT}
					actionLabel="Retry"
					onAction={props.onStallRetry}
					busy={props.retrying}
					class="wlt-feed__notice"
				/>
			)}
			{props.error && !props.stalled && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.loading}
					class="wlt-feed__notice"
				/>
			)}
			{!props.hasMore && props.lines.length > 0 && !props.error && !props.stalled && (
				<p class="wlt-feed__end">
					{props.filtered
						? "That's every matching transaction."
						: "That's every transaction in this window."}
				</p>
			)}
		</div>
	);
}
// #endregion
