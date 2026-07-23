import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/devtools.css";
import { DraggablePopover, type PopoverPosition } from "@projective/ui/overlay";
import { type MenuAction, SpeedDial } from "@projective/ui/fields";
import type { UserContext } from "@projective/types/auth";
import { logger } from "@web/utils/logger.ts";
import { LocalKeys, readStored, type StorageKey, writeStored } from "@web/utils/storage-keys.ts";
import { devOverrides, hydrateDevContext, patchDevContext } from "../core/dev-context.ts";
import { DevContextPanel } from "../components/DevContextPanel.tsx";
import { LogInspector } from "../components/LogInspector.tsx";
import {
	IconClearCache,
	IconDevTools,
	IconInspector,
	IconInvites,
	IconOwnership,
	IconSwitch,
} from "../components/dev-glyphs.tsx";

// #region Props
/** Props for {@link DevTools}. */
export interface DevToolsProps {
	/** The developer's real (hydrated) context, surfaced in the Context Switcher's effective summary. */
	context?: UserContext;
}
// #endregion

// #region Position persistence
/** Read a persisted `{x,y}` window position, or `undefined` when unset/invalid. */
function readPos(key: StorageKey): PopoverPosition | undefined {
	const raw = readStored("local", key);
	if (!raw) return undefined;
	try {
		const p = JSON.parse(raw) as PopoverPosition;
		if (typeof p?.x === "number" && typeof p?.y === "number") return p;
	} catch {
		// invalid blob
	}
	return undefined;
}

/** Persist a window position under `key`. */
function savePos(key: StorageKey): (p: PopoverPosition) => void {
	return (p) => writeStored("local", key, JSON.stringify(p));
}

/** Read a persisted window OPEN flag (`"1"` = open). */
function readOpen(key: StorageKey): boolean {
	return readStored("local", key) === "1";
}

/** Persist a window OPEN flag so it survives a navigation / refresh. */
function writeOpen(key: StorageKey, open: boolean): void {
	writeStored("local", key, open ? "1" : "0");
}
// #endregion

/**
 * DevTools — the root Developer-Tools island. Renders the reused `@projective/ui/fields`
 * {@link SpeedDial} — a corner FAB that fans round, icon-only, tooltip-labelled actions out on a
 * quarter-circle arc — that open the Context Switcher and the Log & API Inspector (each a non-modal
 * {@link DraggablePopover}), plus quick "Toggle Ownership" and "Clear Cache" actions. On mount it
 * hydrates the dev-context store and installs the dev-only network + global-error capture (uninstalled
 * on unmount).
 *
 * **Production guardrail.** This island is mounted only through {@link DevMount}, which renders `null`
 * when `!IS_DEV`, and the Vite config drops `features/devtools/**` from the island manifest in
 * production — so the whole subtree (this island, its DraggablePopover windows, and the logger's dev
 * branches) is absent from the shipped client bundle. No listeners are installed and no log cache is
 * allocated in production.
 */
export default function DevTools(props: DevToolsProps): JSX.Element {
	const contextOpen = useSignal(false);
	const inspectorOpen = useSignal(false);

	useEffect(() => {
		hydrateDevContext();
		// Restore any window the developer left open, so a page switch or hard refresh reopens the
		// Context Switcher / Log Inspector in the same (already position-persisted) spot. Done here in an
		// effect — never during render — so it can't cause a hydration mismatch against the SSR markup.
		if (readOpen(LocalKeys.DEV_CONTEXT_WINDOW_OPEN)) contextOpen.value = true;
		if (readOpen(LocalKeys.DEV_INSPECTOR_WINDOW_OPEN)) inspectorOpen.value = true;
		const offNetwork = logger.installNetworkCapture();
		const offErrors = logger.installGlobalErrorCapture();
		logger.info("Dev Tools ready", { context: props.context?.contextType ?? "guest" });
		return () => {
			offNetwork();
			offErrors();
		};
	}, []);

	const toggleOwnership = () => {
		patchDevContext({ enabled: true, isOwner: !devOverrides.value.isOwner });
	};

	const togglePendingInvites = () => {
		patchDevContext({ enabled: true, hasPendingInvites: !devOverrides.value.hasPendingInvites });
	};

	const clearCaches = () => {
		try {
			if (typeof caches !== "undefined") {
				caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
			}
		} catch {
			// CacheStorage unavailable — non-fatal.
		}
		logger.warn("Dev: cleared CacheStorage buckets");
	};

	/** Open a window and persist its open flag (so it reopens after a navigation / refresh). */
	const openWindow = (open: typeof contextOpen, key: StorageKey) => {
		open.value = true;
		writeOpen(key, true);
	};

	const actions: MenuAction[] = [
		{
			label: "Switch Context",
			icon: <IconSwitch />,
			onClick: () => openWindow(contextOpen, LocalKeys.DEV_CONTEXT_WINDOW_OPEN),
		},
		{
			label: "Open Log Inspector",
			icon: <IconInspector />,
			onClick: () => openWindow(inspectorOpen, LocalKeys.DEV_INSPECTOR_WINDOW_OPEN),
		},
		{ label: "Toggle Ownership", icon: <IconOwnership />, onClick: toggleOwnership },
		{ label: "Toggle Pending Invites", icon: <IconInvites />, onClick: togglePendingInvites },
		{ label: "Clear Cache", icon: <IconClearCache />, onClick: clearCaches },
	];

	const vw = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1280;

	return (
		<>
			<SpeedDial
				model={actions}
				ariaLabel="Developer tools"
				icon={<IconDevTools />}
				type="quarter-circle"
				direction="up-left"
				radius={132}
				buttonSeverity="primary"
				class="dev-fab"
			/>
			<DraggablePopover
				open={contextOpen}
				onOpenChange={(o) => writeOpen(LocalKeys.DEV_CONTEXT_WINDOW_OPEN, o)}
				title="Context Switcher"
				icon={<IconSwitch />}
				width="20rem"
				defaultPosition={readPos(LocalKeys.DEV_CONTEXT_WINDOW_POS) ?? { x: 24, y: 96 }}
				onPositionChange={savePos(LocalKeys.DEV_CONTEXT_WINDOW_POS)}
				class="dev-window"
			>
				<DevContextPanel baseContext={props.context} />
			</DraggablePopover>
			<DraggablePopover
				open={inspectorOpen}
				onOpenChange={(o) => writeOpen(LocalKeys.DEV_INSPECTOR_WINDOW_OPEN, o)}
				title="Log & API Inspector"
				icon={<IconInspector />}
				width="27rem"
				height="27rem"
				defaultPosition={readPos(LocalKeys.DEV_INSPECTOR_WINDOW_POS) ?? { x: vw - 460, y: 96 }}
				onPositionChange={savePos(LocalKeys.DEV_INSPECTOR_WINDOW_POS)}
				class="dev-window"
			>
				<LogInspector />
			</DraggablePopover>
		</>
	);
}
