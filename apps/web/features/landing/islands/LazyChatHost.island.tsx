/// <reference lib="dom" />
import type { ComponentType, JSX } from "preact";
import { useEffect } from "preact/hooks";
import { effect, useSignal } from "@preact/signals";
import { readStored, SessionKeys } from "@web/utils/storage-keys.ts";
import { popout } from "@features/messaging/core/popout-state.ts";

// #region Contract
/** Props for {@link LazyChatHost}: what the real host takes. */
export interface LazyChatHostProps {
	/** The page's pathname, handed to `ChatPopoutHost` for its route reconciliation. */
	path: string;
}

/** The global floating-chat host's component. */
type ChatHost = ComponentType<{ path: string }>;
// #endregion

// #region Loader
let pending: Promise<ChatHost> | null = null;

/**
 * Fetch (or re-use) `ChatPopoutHost`. The promise is memoised and cleared on failure, so a transient
 * network error is retried on the next wake instead of poisoning the page.
 */
function loadChatHost(): Promise<ChatHost> {
	pending ??= import("@features/messaging/islands/ChatPopoutHost.island.tsx")
		.then((mod) => mod.default)
		.catch((error: unknown) => {
			pending = null;
			throw error;
		});
	return pending;
}

/** Whether this tab holds an open floating chat: the live store, or the blob a page before persisted. */
function chatIsOpen(): boolean {
	return popout.peek() !== null || readStored("session", SessionKeys.CHAT_POPOUT) !== null;
}
// #endregion

// #region Island
/**
 * LazyChatHost — the landing pages' stand-in for the global `ChatPopoutHost` (Decision #286
 * (A), owner ruling 2026-10-18). The `(public)` layout mounts it on `LANDING_PATHS` for a signed-in
 * visitor only, in place of the 222 kB host. It renders nothing and loads nothing until this tab
 * actually has a floating chat open: the window's state persisted in `sessionStorage` by the page
 * it was opened on (`popout-state.ts`), or the shared `popout` signal turning non-null when
 * `openPopout` runs on this page. Then it imports the real host once and renders it with the same
 * `path`, and the host takes over exactly as it does on every other page (its mount reconciles the
 * route, it renders nothing below 768px). A back/forward-cache restore and a `popstate` look again,
 * as the host itself does.
 */
export default function LazyChatHost({ path }: LazyChatHostProps): JSX.Element | null {
	const host = useSignal<ChatHost | null>(null);

	useEffect(() => {
		let live = true;
		function wake(): void {
			if (host.peek() !== null || !chatIsOpen()) return;
			loadChatHost().then(
				(loaded) => {
					if (live) host.value = loaded;
				},
				() => {},
			);
		}
		function onPageShow(event: PageTransitionEvent): void {
			if (event.persisted) wake();
		}
		const stopWatching = effect(() => {
			if (popout.value !== null) wake();
		});
		wake();
		globalThis.addEventListener("pageshow", onPageShow);
		globalThis.addEventListener("popstate", wake);
		return () => {
			live = false;
			stopWatching();
			globalThis.removeEventListener("pageshow", onPageShow);
			globalThis.removeEventListener("popstate", wake);
		};
	}, []);

	const Host = host.value;
	return Host === null ? null : <Host path={path} />;
}
// #endregion
