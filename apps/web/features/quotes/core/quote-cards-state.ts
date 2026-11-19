import { signal } from "@preact/signals";
import type { QuoteCardView } from "@projective/types/services";
import { QuoteService } from "./QuoteService.ts";

/**
 * quote-cards-state — the quote cards a conversation has asked for, by event id (Decision #522). A
 * thread renders one card per quote message; each asks for its own id, and every id asked for in one
 * turn of the event loop goes out as ONE read, so a thread of twenty cards is one request.
 */

/** Every card read so far, by event id. `null` marks an id the viewer may not read. */
export const quoteCards = signal<Readonly<Record<string, QuoteCardView | null>>>({});

let queued = new Set<string>();
let flushing = false;

/** Ask for a card; a no-op once it has been read or is on its way. */
export function requestQuoteCard(eventId: string): void {
	if (eventId in quoteCards.peek() || queued.has(eventId)) return;
	queued.add(eventId);
	if (flushing) return;
	flushing = true;
	queueMicrotask(() => void flush());
}

/** Read the named cards again (after an act moved their offer), replacing what was held. */
export async function refreshQuoteCards(eventIds: readonly string[]): Promise<void> {
	if (eventIds.length === 0) return;
	await load([...new Set(eventIds)]);
}

async function flush(): Promise<void> {
	const ids = [...queued];
	queued = new Set();
	flushing = false;
	for (let i = 0; i < ids.length; i += 100) await load(ids.slice(i, i + 100));
}

async function load(ids: readonly string[]): Promise<void> {
	const res = await QuoteService.cards(ids);
	if (!res.ok || !res.data) {
		const next = { ...quoteCards.peek() };
		for (const id of ids) delete next[id];
		quoteCards.value = next;
		return;
	}
	const next: Record<string, QuoteCardView | null> = { ...quoteCards.peek() };
	for (const id of ids) next[id] = null;
	for (const card of res.data.cards) next[card.eventId] = card;
	quoteCards.value = next;
}
