// The changelog's stylesheets travel with this island: every changelog page renders it (a page with
// no pictures too), and a server component's CSS import never reaches the page. The tier-4 button
// sheet is here because the server-rendered RSS, pager and sibling links wear its classes.
import "../styles/changelog.css";
import "@ui/fields/styles/button.css";
import type { JSX } from "preact";
import { batch, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { type LightboxMedia, MediaLightbox } from "@features/view/components/MediaLightbox.tsx";
import {
	formatImageParam,
	IMAGE_PARAM,
	type ImageRef,
	parseImageParam,
	withImageParam,
} from "../core/image-param.ts";
import type { ChangelogGallery } from "../types/gallery.ts";

// #region Props
/** Props for {@link ChangelogLightbox}. */
export interface ChangelogLightboxProps {
	/** Every gallery on the page; empty on a page with no pictures (the island still carries the CSS). */
	galleries: ChangelogGallery[];
}
// #endregion

// #region History
/**
 * The history entry marker. `fClientNav` is Fresh's flag: its client runtime treats an entry carrying
 * `true` as a partial navigation and reloads on traversal (partials are off, Decision #52), so every
 * entry written here — and the page's own entry, before anything is pushed on top — carries `false`
 * (the `TicketDeepLinkHost` / `useDetailRoute` contract).
 */
interface LightboxHistoryState {
	chlImage?: string;
	fClientNav?: boolean;
}

function historyState(): LightboxHistoryState {
	const state = history.state;
	return state && typeof state === "object" ? (state as LightboxHistoryState) : {};
}

function currentHref(): string {
	return location.pathname + location.search + location.hash;
}

function shownParam(): string | null {
	return new URLSearchParams(location.search).get(IMAGE_PARAM);
}

/** Put `value` in the address bar — a NEW entry when none is shown (so Back closes), else a replace. */
function writeImage(value: string): void {
	const shown = shownParam();
	if (shown === value) return;
	const current = historyState();
	const next = withImageParam(currentHref(), value);
	if (shown !== null) {
		history.replaceState({ ...current, fClientNav: false, chlImage: value }, "", next);
		return;
	}
	history.replaceState({ ...current, fClientNav: false }, "", currentHref());
	history.pushState({ ...current, fClientNav: false, chlImage: value }, "", next);
}

/** Remove the parameter, keeping every other one and the fragment. Always a replace. */
function stripImage(): void {
	if (shownParam() === null) return;
	const { chlImage: _dropped, ...rest } = historyState();
	history.replaceState({ ...rest, fClientNav: false }, "", withImageParam(currentHref(), null));
}
// #endregion

/**
 * ChangelogLightbox — the ONE owner of the changelog's `?image=<entry>:<n>` ⇄ lightbox relationship,
 * drawn with the app's one media lightbox (`MediaLightbox`, Decision #184: fit / zoom / pan, a
 * thumbnail tray, Escape, a focus trap that returns focus to the picture it opened from).
 *
 * **Picture → URL.** A picture tile is a real link to the image (it works with no JavaScript). A
 * plain click on one is intercepted by its `data-chl-image` address: the lightbox opens on that
 * picture of that release and PUSHES `?image=`, so the browser's Back closes it; stepping replaces
 * the value; closing from inside (×, Escape, the scrim) strips it in place. A modified click (new
 * tab, new window) is left to the browser.
 *
 * **URL → picture.** On load and on every `popstate` the parameter is read: none closes the lightbox,
 * a picture on this page opens it, anything else is stripped. So a shared `?image=v0-12-0:2` link
 * opens straight onto that picture.
 */
export default function ChangelogLightbox({ galleries }: ChangelogLightboxProps): JSX.Element {
	const open = useSignal(false);
	const active = useSignal(0);
	const entry = useSignal<string | null>(null);
	const ready = useRef(false);
	const galleriesRef = useRef(galleries);
	galleriesRef.current = galleries;

	function galleryOf(id: string | null): ChangelogGallery | null {
		return id ? galleriesRef.current.find((g) => g.entry === id) ?? null : null;
	}

	/** Open on `ref` when this page has that picture; `false` when it does not. */
	function show(ref: ImageRef): boolean {
		const gallery = galleryOf(ref.entry);
		if (!gallery || ref.index > gallery.images.length) return false;
		batch(() => {
			entry.value = ref.entry;
			active.value = ref.index - 1;
			open.value = true;
		});
		return true;
	}

	function close(): void {
		open.value = false;
		stripImage();
	}

	useEffect(() => {
		const sync = () => {
			const raw = shownParam();
			const ref = parseImageParam(raw);
			if (ref && show(ref)) return;
			open.value = false;
			if (raw !== null) stripImage();
		};
		const onClick = (event: MouseEvent) => {
			if (
				event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
				event.shiftKey || event.altKey
			) return;
			const target = event.target instanceof Element ? event.target : null;
			const link = target?.closest<HTMLAnchorElement>("a[data-chl-image]");
			const ref = parseImageParam(link?.dataset.chlImage);
			if (!link || !ref || !show(ref)) return;
			event.preventDefault();
			writeImage(formatImageParam(ref.entry, ref.index));
		};
		sync();
		ready.current = true;
		addEventListener("popstate", sync);
		document.addEventListener("click", onClick);
		return () => {
			removeEventListener("popstate", sync);
			document.removeEventListener("click", onClick);
		};
	}, []);

	// Stepping inside the lightbox (arrows, the tray, a swipe) moves `active`: keep the address on it.
	useSignalEffect(() => {
		const index = active.value;
		const id = entry.value;
		const shown = open.value;
		if (!ready.current || !shown || !id || shownParam() === null) return;
		writeImage(formatImageParam(id, index + 1));
	});

	const gallery = galleryOf(entry.value);
	const media: LightboxMedia[] = gallery
		? gallery.images.map((image) => ({
			src: image.src,
			alt: image.alt,
			caption: image.caption,
		}))
		: [];
	return (
		<MediaLightbox
			open={open}
			active={active}
			gallery={media}
			title={gallery?.title ?? "Release pictures"}
			onClose={close}
		/>
	);
}
