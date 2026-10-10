import { type ReadonlySignal, type Signal, signal } from "@preact/signals";
import type { InspectAsset } from "@projective/types/files";

/**
 * inspector-shell — the one object every inspector canvas talks to. The workspace owns it; a viewer
 * reads the asset, reports its load state and canvas-only facts, and asks for fullscreen, the panel
 * or a live announcement through it. Pure signals: no DOM, so it is safe to create during SSR.
 */

// #region Contract
/** How the host page embeds the inspector. Every flag keeps the standalone page's behaviour by default. */
export interface InspectorShellOptions {
	/** Mirror state into the page URL (the `#L12` line fragment). Default `true`. */
	urlSync?: boolean;
	/** Offer printing: the PDF print dialog, Ctrl+P and the Word print hooks. Default `true`. */
	print?: boolean;
	/**
	 * Hosted inside another surface (the file preview modal): document-wide keys stay inside the
	 * host's `[data-ins-key-scope]` element (else the stage), and canvases leave their floating bars
	 * to the host's chip bar. Default `false`.
	 */
	embedded?: boolean;
}

/** {@link InspectorShellOptions} with every default applied. */
export function resolveShellOptions(
	options: InspectorShellOptions = {},
): Readonly<Required<InspectorShellOptions>> {
	return Object.freeze({
		urlSync: options.urlSync ?? true,
		print: options.print ?? true,
		embedded: options.embedded ?? false,
	});
}

/** Where the canvas is in drawing the file. */
export type StageStatus = "loading" | "ready" | "error";

/** One fact only the canvas can learn, shown in the panel's Details. */
export interface StageFact {
	label: string;
	value: string;
}

/** What a viewer may read and drive in the surrounding workspace. */
export interface InspectorShell {
	readonly asset: InspectAsset;
	/** How the host embeds this inspector; fixed for the shell's lifetime. */
	readonly options: Readonly<Required<InspectorShellOptions>>;
	/**
	 * Whether the details panel shows. A viewer sets it to `true` to ask for the panel (find, filter);
	 * an embedding host binds it to its own aside or sheet.
	 */
	readonly panelOpen: Signal<boolean>;
	readonly fullscreen: Signal<boolean>;
	readonly fullscreenSupported: Signal<boolean>;
	readonly status: Signal<StageStatus>;
	readonly error: Signal<string | null>;
	/** Facts only the canvas can learn (page count, triangle count, natural size, codec…), shown in Details. */
	readonly facts: Signal<readonly StageFact[]>;
	/** Short live-region announcement (zoom level, page change). */
	announce(message: string): void;
	/** Give up on the canvas and show the unsupported fallback with the reason. */
	fail(reason: string): void;
	toggleFullscreen(): void;
	togglePanel(): void;
}
// #endregion

// #region Host
/** One announcement; `id` changes on every call so a repeated message is spoken again. */
export interface Announcement {
	id: number;
	message: string;
}

/** The workspace's side of the shell: the live-region feed and the fullscreen binding. */
export interface InspectorShellHost extends InspectorShell {
	readonly announcement: ReadonlySignal<Announcement | null>;
	/** Route {@link InspectorShell.toggleFullscreen} to the workspace's Fullscreen API binding. */
	setFullscreenHandler(handler: (() => void) | null): void;
}

/**
 * Create the shell for one asset. The panel starts open (the desktop default) on the standalone page
 * and closed when embedded, so a viewer's request for it is always a change the host can observe.
 */
export function createInspectorShell(
	asset: InspectAsset,
	options?: InspectorShellOptions,
): InspectorShellHost {
	const resolved = resolveShellOptions(options);
	const announcement = signal<Announcement | null>(null);
	const status = signal<StageStatus>("loading");
	const error = signal<string | null>(null);
	const panelOpen = signal(!resolved.embedded);
	let fullscreenHandler: (() => void) | null = null;
	let sequence = 0;

	return {
		asset,
		options: resolved,
		panelOpen,
		fullscreen: signal(false),
		fullscreenSupported: signal(false),
		status,
		error,
		facts: signal<readonly StageFact[]>([]),
		announcement,
		announce(message: string): void {
			const text = message.trim();
			if (text.length === 0) return;
			sequence += 1;
			announcement.value = { id: sequence, message: text };
		},
		fail(reason: string): void {
			error.value = reason.trim().length > 0 ? reason.trim() : "This preview couldn't be shown.";
			status.value = "error";
		},
		toggleFullscreen(): void {
			fullscreenHandler?.();
		},
		togglePanel(): void {
			panelOpen.value = !panelOpen.value;
		},
		setFullscreenHandler(handler: (() => void) | null): void {
			fullscreenHandler = handler;
		},
	};
}
// #endregion
