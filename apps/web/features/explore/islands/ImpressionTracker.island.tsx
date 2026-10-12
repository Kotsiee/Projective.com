import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import type {
	DiscoveryEvent,
	DiscoveryEventBatch,
	DiscoverySurface,
	ExploreEntity,
} from "@projective/types/explore";
import { DISCOVERY_BATCH_MAX } from "@projective/types/explore";
import { logger } from "@web/utils/logger.ts";
import { readStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import {
	depthAdvanced,
	DISCOVERY_EVENTS_URL,
	FLUSH_AT,
	FLUSH_EVERY_MS,
	IMPRESSION_DWELL_MS,
	IMPRESSION_RATIO,
	placementKey,
	railDepth,
} from "../core/discovery-telemetry.ts";

const CARD = "[data-item-id][data-item-type]";
const RAIL = "[data-rail-id]";
const CARD_LINK_CLASS = "ex-card__link";

/**
 * ImpressionTracker — the page-level writer behind discovery telemetry. Renders NOTHING.
 *
 * Like `ViewHistory`, it finds its subjects by attribute so the cards stay server components:
 *
 * - **Impressions** — ONE `IntersectionObserver` over every `[data-item-id]` card on the page
 *   (including cards a results refinement adds later, via a `MutationObserver`). A card that stays
 *   at least half visible for a full second, in a visible tab, is one impression per placement.
 * - **Clicks** — a bubble-phase listener records a press on a card's own stretched link, the same
 *   rule `ViewHistory` applies, and flushes immediately because navigation follows.
 * - **Rail depth** — one capturing `scroll` listener keeps the furthest point reached in each
 *   `[data-rail-id]` track and reports it when it grows.
 *
 * Events are batched and sent with `navigator.sendBeacon` to `POST /api/explore/events` — at
 * {@link FLUSH_AT} events, on a {@link FLUSH_EVERY_MS} heartbeat, and when the page is hidden.
 */
export interface ImpressionTrackerProps {
	/** Which discovery surface this page is. */
	surface: DiscoverySurface;
}

export default function ImpressionTracker({ surface }: ImpressionTrackerProps): JSX.Element | null {
	useEffect(() => track(surface), [surface]);
	return null;
}

function sessionId(): string {
	const stored = readStored("session", SessionKeys.DISCOVERY_SESSION);
	if (stored) return stored;
	const fresh = crypto.randomUUID();
	writeStored("session", SessionKeys.DISCOVERY_SESSION, fresh);
	return fresh;
}

function slotOf(card: HTMLElement): { rail?: string; position?: number } {
	const track = card.closest<HTMLElement>(RAIL);
	if (!track) {
		const loose = Array.from(document.querySelectorAll<HTMLElement>(CARD))
			.filter((el) => !el.closest(RAIL));
		const position = loose.indexOf(card);
		return position >= 0 ? { position } : {};
	}
	let cell: HTMLElement = card;
	while (cell.parentElement && cell.parentElement !== track) cell = cell.parentElement;
	const position = Array.prototype.indexOf.call(track.children, cell);
	return { rail: track.dataset.railId, position: position >= 0 ? position : undefined };
}

function send(body: DiscoveryEventBatch): void {
	const json = JSON.stringify(body);
	if (
		navigator.sendBeacon?.(DISCOVERY_EVENTS_URL, new Blob([json], { type: "application/json" }))
	) {
		return;
	}
	fetch(DISCOVERY_EVENTS_URL, {
		method: "POST",
		body: json,
		keepalive: true,
		headers: { "content-type": "application/json", "x-pj-background": "1" },
	}).catch((error: unknown) =>
		logger.warn("Discovery telemetry could not be sent", {
			events: body.events.length,
			reason: error instanceof Error ? error.message : String(error),
		})
	);
}

function track(surface: DiscoverySurface): () => void {
	const session = sessionId();
	const queue: DiscoveryEvent[] = [];
	const seen = new Set<string>();
	const visible = new Set<HTMLElement>();
	const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
	const rails = new Map<string, { depth: number; sent: number; items: number }>();

	function flush(): void {
		for (const [rail, state] of rails) {
			if (!depthAdvanced(state.depth, state.sent)) continue;
			queue.push({
				name: "discovery.rail_depth",
				rail,
				depth: state.depth,
				items: state.items,
				at: Date.now(),
			});
			state.sent = state.depth;
		}
		const query = new URL(location.href).searchParams.get("q")?.trim().slice(0, 200) || undefined;
		while (queue.length > 0) {
			send({ sessionId: session, surface, query, events: queue.splice(0, DISCOVERY_BATCH_MAX) });
		}
	}

	function push(event: DiscoveryEvent): void {
		queue.push(event);
		if (queue.length >= FLUSH_AT) flush();
	}

	function impress(card: HTMLElement): void {
		const itemId = card.dataset.itemId;
		const itemType = card.dataset.itemType as ExploreEntity | undefined;
		if (!itemId || !itemType) return;
		const slot = slotOf(card);
		const key = placementKey(itemId, slot.rail);
		if (seen.has(key)) return;
		seen.add(key);
		push({ name: "discovery.impression", itemId, itemType, ...slot, at: Date.now() });
	}

	function arm(card: HTMLElement): void {
		if (document.visibilityState !== "visible" || timers.has(card)) return;
		timers.set(
			card,
			setTimeout(() => {
				timers.delete(card);
				if (card.isConnected && visible.has(card)) impress(card);
			}, IMPRESSION_DWELL_MS),
		);
	}

	function disarm(card: HTMLElement): void {
		const timer = timers.get(card);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(card);
	}

	const io = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			const card = entry.target as HTMLElement;
			if (entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_RATIO) {
				visible.add(card);
				arm(card);
			} else {
				visible.delete(card);
				disarm(card);
			}
		}
	}, { threshold: [0, IMPRESSION_RATIO] });

	const cardsIn = (node: Node): HTMLElement[] => {
		if (!(node instanceof HTMLElement)) return [];
		const found = Array.from(node.querySelectorAll<HTMLElement>(CARD));
		return node.matches(CARD) ? [node, ...found] : found;
	};

	for (const card of cardsIn(document.body)) io.observe(card);

	const mo = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of Array.from(record.addedNodes)) {
				for (const card of cardsIn(node)) io.observe(card);
			}
			for (const node of Array.from(record.removedNodes)) {
				for (const card of cardsIn(node)) {
					io.unobserve(card);
					visible.delete(card);
					disarm(card);
				}
			}
		}
	});
	mo.observe(document.body, { childList: true, subtree: true });

	const onPress = (e: MouseEvent) => {
		if (e.type === "auxclick" && e.button !== 1) return;
		const target = e.target;
		if (!(target instanceof Element)) return;
		if (!target.closest("a[href]")?.classList.contains(CARD_LINK_CLASS)) return;
		const card = target.closest<HTMLElement>(CARD);
		const itemId = card?.dataset.itemId;
		const itemType = card?.dataset.itemType as ExploreEntity | undefined;
		if (!card || !itemId || !itemType) return;
		queue.push({ name: "discovery.click", itemId, itemType, ...slotOf(card), at: Date.now() });
		flush();
	};

	const onScroll = (e: Event) => {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		const rail = target.dataset.railId;
		if (!rail) return;
		const depth = railDepth(target.scrollLeft, target.clientWidth, target.scrollWidth);
		const state = rails.get(rail) ?? { depth: 0, sent: 0, items: target.children.length };
		state.depth = Math.max(state.depth, depth);
		state.items = target.children.length;
		rails.set(rail, state);
	};

	const onVisibility = () => {
		if (document.visibilityState === "hidden") {
			for (const card of Array.from(timers.keys())) disarm(card);
			flush();
			return;
		}
		for (const card of visible) arm(card);
	};

	document.addEventListener("click", onPress);
	document.addEventListener("auxclick", onPress);
	document.addEventListener("scroll", onScroll, { capture: true, passive: true });
	document.addEventListener("visibilitychange", onVisibility);
	globalThis.addEventListener("pagehide", flush);
	const heartbeat = setInterval(flush, FLUSH_EVERY_MS);

	return () => {
		flush();
		clearInterval(heartbeat);
		io.disconnect();
		mo.disconnect();
		for (const card of Array.from(timers.keys())) disarm(card);
		document.removeEventListener("click", onPress);
		document.removeEventListener("auxclick", onPress);
		document.removeEventListener("scroll", onScroll, { capture: true });
		document.removeEventListener("visibilitychange", onVisibility);
		globalThis.removeEventListener("pagehide", flush);
	};
}
