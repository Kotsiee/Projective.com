import type { RefObject } from "preact";
import {
	type ReadonlySignal,
	type Signal,
	useComputed,
	useSignal,
	useSignalEffect,
} from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ChatMessage } from "../types/projects-types.ts";
import {
	findAnnouncement,
	findMatches,
	type FindPosition,
	needsEarlier,
	stepMatch,
} from "../core/chat-find.ts";
import { clearFindHighlights, paintFindHighlights } from "../core/chat-find-highlights.ts";

/** How many earlier pages one step may load while looking for an older match. */
const FIND_PAGE_BUDGET = 8;
/** How long typing rests before the finder scrolls to the newest match. */
const TYPING_REST_MS = 180;

export interface ChatFindOptions {
	messages: ReadonlySignal<ChatMessage[]>;
	hasMore: ReadonlySignal<boolean>;
	/** Load the next-older page; resolves whether one landed. */
	loadOlder: () => Promise<boolean>;
	/** Scroll a loaded message into view and flash it. */
	jumpTo: (id: string) => void;
	/** The element holding the drawn rows, for the match paint. */
	viewportRef: RefObject<HTMLElement>;
	/** The feed's polite live region. */
	status: Signal<string>;
}

/** The finder's state and actions, as `ChatFindBar` and the feed use them. */
export interface ChatFind {
	open: ReadonlySignal<boolean>;
	query: Signal<string>;
	matches: ReadonlySignal<string[]>;
	activeId: ReadonlySignal<string | null>;
	position: ReadonlySignal<FindPosition>;
	/** Bumped on every open, so the bar focuses its field again. */
	focusRequest: ReadonlySignal<number>;
	/** Earlier history is loading for a step. */
	searching: ReadonlySignal<boolean>;
	/** Open the finder, or focus it again. */
	show: () => void;
	/** Close it and give focus back to where it was taken from. */
	close: () => void;
	/** Step to the next older (`1`) or newer (`-1`) match. */
	step: (delta: 1 | -1) => Promise<void>;
}

/**
 * useChatFind — the in-thread message finder (Decision #418): searches the loaded messages, walks
 * the matches newest to oldest, loads earlier history when stepping past the oldest loaded match,
 * and paints the matches in the drawn rows. Reads nothing during render, so typing never re-renders
 * the feed.
 */
export function useChatFind(options: ChatFindOptions): ChatFind {
	const live = useRef(options);
	live.current = options;
	const { messages, hasMore } = options;

	const open = useSignal(false);
	const query = useSignal("");
	const activeId = useSignal<string | null>(null);
	const focusRequest = useSignal(0);
	const searching = useSignal(false);
	const returnTo = useRef<HTMLElement | null>(null);
	const restTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const matches = useComputed(() => (open.value ? findMatches(messages.value, query.value) : []));
	const position = useComputed<FindPosition>(() => {
		const list = matches.value;
		return {
			active: activeId.value === null ? -1 : list.indexOf(activeId.value),
			total: list.length,
			more: hasMore.value,
		};
	});

	function announce(): void {
		live.current.status.value = findAnnouncement(position.peek());
	}

	function land(id: string): void {
		activeId.value = id;
		live.current.jumpTo(id);
		announce();
	}

	useSignalEffect(() => {
		const q = query.value;
		if (!open.peek()) return;
		clearTimeout(restTimer.current);
		const newest = findMatches(messages.peek(), q)[0] ?? null;
		activeId.value = newest;
		if (!q.trim()) return;
		restTimer.current = setTimeout(() => {
			if (newest) land(newest);
			else announce();
		}, TYPING_REST_MS);
	});

	useSignalEffect(() => {
		const root = live.current.viewportRef.current;
		const q = query.value;
		const id = activeId.value;
		if (!open.value || !root || !q.trim()) {
			clearFindHighlights();
			return;
		}
		let frame = 0;
		const paint = () => {
			frame = 0;
			paintFindHighlights(root, q, id);
		};
		paint();
		const observer = new MutationObserver(() => {
			if (!frame) frame = requestAnimationFrame(paint);
		});
		observer.observe(root, { childList: true, subtree: true, characterData: true });
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});

	useEffect(() => () => {
		clearTimeout(restTimer.current);
		clearFindHighlights();
	}, []);

	function show(): void {
		if (!open.value) {
			const active = document.activeElement;
			returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
			open.value = true;
		}
		focusRequest.value++;
	}

	function close(): void {
		clearTimeout(restTimer.current);
		open.value = false;
		searching.value = false;
		const target = returnTo.current;
		returnTo.current = null;
		setTimeout(() => {
			if (target?.isConnected && !target.closest("[inert]")) target.focus();
		}, 0);
	}

	async function step(delta: 1 | -1): Promise<void> {
		if (searching.value || !query.value.trim()) return;
		clearTimeout(restTimer.current);
		if (delta === 1 && needsEarlier(matches.value, activeId.value, hasMore.value)) {
			const before = matches.value.length;
			searching.value = true;
			try {
				for (let page = 0; page < FIND_PAGE_BUDGET && hasMore.value; page++) {
					if (!(await live.current.loadOlder())) break;
					if (matches.value.length > before) break;
				}
			} finally {
				searching.value = false;
			}
			if (matches.value.length > before) {
				land(matches.value[before]);
				return;
			}
		}
		const next = stepMatch(matches.value, activeId.value, delta);
		if (next) land(next);
		else announce();
	}

	return { open, query, matches, activeId, position, focusRequest, searching, show, close, step };
}
