import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
	bareLetterOf,
	isEditableTarget,
	isOpenFeedbackShortcut,
	type ShortcutTarget,
} from "@features/shell/core/shortcuts.ts";
import { onOpenFeedback } from "../core/feedback-bridge.ts";
import {
	FEEDBACK_HOME,
	type FeedbackLocation,
	feedbackOverlayAllowed,
	isFeedbackOverlayOpen,
	readFeedbackLocation,
	withFeedbackLocation,
	withoutFeedbackOverlay,
} from "../core/feedback-url.ts";
import {
	currentHref,
	pinHistoryEntry,
	pushFeedbackHref,
	replaceFeedbackHref,
} from "../core/feedback-history.ts";
import type { FeedbackDrawerProps } from "../components/FeedbackDrawer.tsx";

/** Props for {@link FeedbackHost}. */
export interface FeedbackHostProps {
	/** Whether the reader is signed in — a guest reads the board and is offered sign-in to take part. */
	signedIn: boolean;
}

/** The previous bare letter, kept as the event itself: whether a handler took it is read later. */
interface PendingKey {
	key: string;
	at: number;
	event: KeyboardEvent;
}

/** Whether a keystroke happened inside an open overlay — the shortcut never opens one over another. */
function insideOverlay(target: EventTarget | null): boolean {
	return target instanceof Element &&
		target.closest("[role='dialog'], [aria-modal='true'], [data-ui-portal]") !== null;
}

/**
 * FeedbackHost — the ONE owner of `?feedback=open` (Decision #272), mounted in the public, profile
 * (`[handle]`) and dashboard layouts so the board opens over any page. It is small on purpose: its
 * imports are Zod-free (`feedback-url.ts` reads the `feedback-constants` sub-path), and the drawer
 * and the board are imported the first time they are asked for, so a page that never opens them
 * pays for neither.
 *
 * - **URL → drawer.** On load and on every `popstate` it reads the URL; `feedback=open` opens the
 *   drawer at `idea` / `compose` (and an arrival's `status` / `sort`), its absence closes it. The
 *   URL is the source of truth. On `/feedback` itself the page is the board, so the request is left
 *   to the page.
 * - **Drawer → URL.** Opening from the shortcut or a menu entry PUSHES an entry, so Back closes the
 *   drawer; moving inside it rewrites `idea` / `compose` in place (never the host page's own
 *   `status` / `sort`); closing removes the drawer's parameters with `replaceState`.
 * - **The shortcut.** `g` then `f` (`isOpenFeedbackShortcut`), never while typing in a field or inside
 *   another overlay, and never from a `g` another handler took.
 */
export default function FeedbackHost(props: FeedbackHostProps): JSX.Element | null {
	const open = useSignal(false);
	const where = useSignal<FeedbackLocation>(FEEDBACK_HOME);
	const href = useSignal("");
	const Drawer = useSignal<((p: FeedbackDrawerProps) => JSX.Element) | null>(null);
	const pending = useRef<PendingKey | null>(null);

	async function ensureDrawer(): Promise<void> {
		if (Drawer.peek()) return;
		const mod = await import("../components/FeedbackDrawer.tsx");
		Drawer.value = mod.default;
	}

	function show(location: FeedbackLocation): void {
		where.value = location;
		href.value = currentHref();
		void ensureDrawer();
		open.value = true;
	}

	// #region URL → drawer
	function syncFromUrl(): void {
		if (!feedbackOverlayAllowed(location.pathname)) return;
		if (isFeedbackOverlayOpen(location.search)) {
			if (!open.peek()) pinHistoryEntry();
			show(readFeedbackLocation(location.search));
		} else if (open.peek()) {
			open.value = false;
		}
	}
	// #endregion

	// #region Drawer → URL
	function openFrom(view: "board" | "compose"): boolean {
		if (!feedbackOverlayAllowed(location.pathname)) return false;
		const next = { ...where.peek(), view, idea: null };
		if (open.peek()) {
			navigate(next, "replace");
			return true;
		}
		pushFeedbackHref(withFeedbackLocation(currentHref(), next, { overlay: true }));
		show(next);
		return true;
	}

	function navigate(next: FeedbackLocation, how: "push" | "replace"): void {
		const nextHref = withFeedbackLocation(currentHref(), next, { overlay: true });
		if (how === "push") pushFeedbackHref(nextHref);
		else replaceFeedbackHref(nextHref);
		where.value = next;
		href.value = currentHref();
	}

	function close(): void {
		if (open.peek()) open.value = false;
		replaceFeedbackHref(withoutFeedbackOverlay(currentHref()));
		href.value = currentHref();
	}
	// #endregion

	useEffect(() => {
		syncFromUrl();
		const onPop = () => syncFromUrl();
		globalThis.addEventListener("popstate", onPop);
		const unsubscribe = onOpenFeedback((detail) => openFrom(detail.view));

		function onKey(event: KeyboardEvent): void {
			const now = event.timeStamp || performance.now();
			if (isEditableTarget(event.target as ShortcutTarget | null) || insideOverlay(event.target)) {
				pending.current = null;
				return;
			}
			const previous = pending.current
				? {
					key: pending.current.key,
					at: pending.current.at,
					taken: pending.current.event.defaultPrevented,
				}
				: null;
			if (isOpenFeedbackShortcut(event, previous, now)) {
				pending.current = null;
				if (openFrom("board")) event.preventDefault();
				return;
			}
			const key = bareLetterOf(event);
			pending.current = key ? { key, at: now, event } : null;
		}
		document.addEventListener("keydown", onKey);
		return () => {
			globalThis.removeEventListener("popstate", onPop);
			document.removeEventListener("keydown", onKey);
			unsubscribe();
		};
	}, []);

	const Loaded = Drawer.value;
	if (!Loaded) return null;
	return (
		<Loaded
			open={open}
			location={where.value}
			navigate={navigate}
			currentHref={href.value}
			signedIn={props.signedIn}
			onClose={close}
		/>
	);
}
