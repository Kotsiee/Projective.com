import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ModalStack } from "@projective/ui/overlay";
import type { AssetItem } from "../types/projects-types.ts";
import { fileOpenIntent, takeFileTrigger, type TileClick } from "../core/file-frame.ts";
import { previewInspectHref } from "../components/preview/preview-model.ts";

/**
 * useFileTiles — what a grid or list of file tiles does when a tile is clicked inside a modal:
 * a plain click opens the in-app preview (as a frame that replaces the modal), a middle or modified
 * click opens the file in a new tab, and when the modal is restored focus returns to the tile the
 * preview was opened from.
 *
 * The tiles are the shared `FileCard` / `FileTable` rows, which report only which file was opened,
 * so the click's modifiers are read from a capture listener on their container and a tile is found
 * by its position among the container's tiles.
 */

// #region Shapes
/** A modal-stack frame a surface renders as. */
export interface TileFrame {
	stack: ModalStack<string, unknown>;
	uid: number;
}

/** Options for {@link useFileTiles}. */
export interface FileTilesOptions {
	/** The files the tiles show, in tile order. */
	files: readonly AssetItem[];
	/** Open the in-app preview. Returns `false` when this surface cannot, and a tab opens instead. */
	preview: (file: AssetItem) => boolean;
	/** The frame the tiles render in, for focus return; `null` outside a modal stack. */
	frame: TileFrame | null;
	/** Resolve a recorded trigger that is not one of the files (a control token such as "From library"). */
	locateTrigger?: (trigger: string) => HTMLElement | null;
}

/** Handlers to spread over the tiles' container, and the `onOpen` the tiles take. */
export interface FileTiles {
	onOpen: (file: AssetItem) => void;
	onClickCapture: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
	onAuxClick: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
}
// #endregion

// #region Helpers
const TILE_SELECTOR = ".fx-card, .fx-row";
const FOCUS_WATCHDOG_MS = 160;

function tilesIn(container: HTMLElement | null): HTMLElement[] {
	return container ? Array.from(container.querySelectorAll<HTMLElement>(TILE_SELECTOR)) : [];
}

/**
 * The address a new tab opens for a file: the inspector for stored bytes, else the file's own
 * address; `null` when it has none.
 */
export function fileTabHref(file: AssetItem): string | null {
	const inspect = previewInspectHref(file);
	if (inspect) return inspect;
	const own = (file.link?.url ?? file.url).trim();
	return own === "" || own === "#" ? null : own;
}

/** Open a file in a new tab without an opener or referrer. */
export function openFileInTab(file: AssetItem): void {
	const href = fileTabHref(file);
	if (href) globalThis.open(href, "_blank", "noopener,noreferrer");
}
// #endregion

// #region Focus return
/**
 * When a frame is restored with a recorded trigger (a file id or a control token), focus the element
 * `locate` finds for it once the frame's focus trap has placed its initial focus, unless focus has
 * since left the dialog.
 */
export function useFileTriggerFocus(
	frame: TileFrame | null,
	locate: (trigger: string) => HTMLElement | null,
): void {
	const locateRef = useRef(locate);
	locateRef.current = locate;

	useEffect(() => {
		if (!frame) return;
		const trigger = takeFileTrigger(frame.stack, frame.uid);
		if (trigger === null) return;

		let done = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const apply = () => {
			if (done) return;
			done = true;
			const target = locateRef.current(trigger);
			if (!target?.isConnected) return;
			const active = document.activeElement;
			const dialog = target.closest<HTMLElement>("[role='dialog']");
			if (active && active !== document.body && !dialog?.contains(active)) return;
			target.focus({ preventScroll: true });
		};
		const raf = requestAnimationFrame(() => {
			timer = setTimeout(apply, 0);
		});
		const watchdog = setTimeout(apply, FOCUS_WATCHDOG_MS);
		return () => {
			done = true;
			cancelAnimationFrame(raf);
			clearTimeout(timer);
			clearTimeout(watchdog);
		};
	}, [frame?.stack, frame?.uid]);
}
// #endregion

// #region Tiles
/** Wire a container of file tiles to the preview, new-tab and focus-return behaviour. */
export function useFileTiles(
	containerRef: RefObject<HTMLElement>,
	options: FileTilesOptions,
): FileTiles {
	const { files, preview, frame, locateTrigger } = options;
	const lastClick = useRef<TileClick | null>(null);

	useFileTriggerFocus(frame, (trigger) => {
		const index = files.findIndex((f) => f.id === trigger);
		if (index < 0) return locateTrigger?.(trigger) ?? null;
		return tilesIn(containerRef.current)[index] ?? null;
	});

	const tileFile = (target: EventTarget | null): AssetItem | null => {
		if (!(target instanceof Element)) return null;
		const tile = target.closest<HTMLElement>(TILE_SELECTOR);
		if (!tile) return null;
		const index = tilesIn(containerRef.current).indexOf(tile);
		return index < 0 ? null : files[index] ?? null;
	};

	return {
		onOpen(file) {
			const click = lastClick.current ??
				{ button: 0, ctrlKey: false, metaKey: false, shiftKey: false };
			lastClick.current = null;
			const intent = fileOpenIntent(click);
			if (intent === "preview" && preview(file)) return;
			if (intent !== null) openFileInTab(file);
		},
		onClickCapture(e) {
			if (!(e.target instanceof Element) || !e.target.closest(TILE_SELECTOR)) return;
			lastClick.current = {
				button: e.button,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				shiftKey: e.shiftKey,
			};
			setTimeout(() => (lastClick.current = null), 0);
		},
		onAuxClick(e) {
			if (e.button !== 1) return;
			const file = tileFile(e.target);
			if (!file) return;
			e.preventDefault();
			openFileInTab(file);
		},
	};
}
// #endregion
