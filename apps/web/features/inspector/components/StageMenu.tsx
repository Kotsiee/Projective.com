import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { InspectViewer } from "@projective/types/files";
import { ActionMenu, type MenuItem } from "@projective/ui/navigation";
import { isApplePlatform } from "@features/projects/core/chat-keyboard.ts";
import { isActionKey } from "@features/files/core/files-keyboard.ts";
import { shareRow } from "@features/share/core/share-menu.ts";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { type InspectorActions, useInspectorActions } from "./InspectorContext.ts";
import { CanvasToolbar } from "./CanvasToolbar.tsx";
import { inspectShareTarget } from "./inspect-share.ts";
import type { MountedViewer } from "./viewers/viewer.ts";

/**
 * StageMenu — the canvas's right-click menu and its theater chrome (Decision #400).
 *
 * The rows are the canvas's own (zoom on a picture, playback on media, camera on a model), then the
 * text rows on a canvas that reads as text, then the rows every file has: Fullscreen, Download and
 * Share. Labels that name a state (Play or Pause, Mute or Unmute) are read when the menu opens, so the
 * menu re-renders on open. A text canvas's menu opens over a live selection, because Copy is on it.
 */

// #region Text canvases
/** Canvases that read as text: their menu copies and selects, and their download is the raw file. */
export const TEXT_VIEWERS: ReadonlySet<InspectViewer> = new Set<InspectViewer>([
	"code",
	"text",
	"markdown",
	"table",
	"sheet",
	"pdf",
	"docx",
	"presentation",
]);

/** The text selected inside `stage`, or `""`. */
export function selectedTextIn(stage: Element | null): string {
	const selection = globalThis.getSelection?.();
	if (!stage || !selection || selection.isCollapsed || selection.rangeCount === 0) return "";
	return stage.contains(selection.getRangeAt(0).commonAncestorContainer)
		? selection.toString()
		: "";
}

/** Select everything the canvas shows, and nothing around it. */
export function selectAllIn(stage: Element | null): void {
	const selection = globalThis.getSelection?.();
	if (!stage || !selection) return;
	const range = document.createRange();
	range.selectNodeContents(stage);
	selection.removeAllRanges();
	selection.addRange(range);
}

function textRows(
	stage: HTMLElement | null,
	actions: InspectorActions,
	apple: boolean,
): MenuItem[] {
	const picked = selectedTextIn(stage);
	return [
		{
			key: "copy-text",
			label: "Copy selected text",
			icon: "copy",
			shortcut: apple ? "⌘C" : "Ctrl+C",
			disabled: picked === "",
			disabledReason: "Select some text first.",
			command: () => void actions.copy(picked, "Copied the selected text"),
		},
		{
			key: "select-all",
			label: "Select all",
			icon: "list",
			shortcut: apple ? "⌘A" : "Ctrl+A",
			command: () => selectAllIn(stage),
		},
	];
}
// #endregion

// #region Rows
function downloadLabel(viewer: InspectViewer): string {
	if (TEXT_VIEWERS.has(viewer)) return "Download raw";
	return viewer === "model" ? "Download asset" : "Download";
}

function stageRows(
	shell: InspectorShell,
	viewer: MountedViewer,
	actions: InspectorActions,
	stage: HTMLElement | null,
): MenuItem[] {
	const kind = shell.asset.viewer;
	const ready = shell.status.value === "ready";
	const apple = isApplePlatform();
	const lead = [
		...(ready && viewer.menu ? viewer.menu({ stage, actions }) : []),
		...(ready && TEXT_VIEWERS.has(kind) ? textRows(stage, actions, apple) : []),
	];
	const theater = shell.fullscreen.value;
	return [
		...lead,
		...(lead.length > 0 ? [{ separator: true }] : []),
		{
			key: "fullscreen",
			label: theater ? "Exit fullscreen" : "Fullscreen",
			icon: theater ? "collapse" : "expand",
			shortcut: "F",
			command: () => shell.toggleFullscreen(),
		},
		{
			key: "download",
			label: downloadLabel(kind),
			icon: "download",
			command: () => actions.download(),
		},
		shareRow(inspectShareTarget(shell), actions.signedIn),
	];
}
// #endregion

// #region Menu
/** Props for {@link StageMenu}. */
export interface StageMenuProps {
	shell: InspectorShell;
	viewer: MountedViewer;
	/** The canvas region the menu opens on. */
	stage: RefObject<HTMLDivElement>;
}

function editable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement &&
		(target.isContentEditable || target.closest("input, textarea, select") !== null);
}

/**
 * The canvas's right-click menu, and the two keys that go with it: `Ctrl`/`⌘`+A selects the canvas's
 * text rather than the page's, and inside a host (the preview modal) `F` toggles fullscreen, which the
 * standalone page binds for itself.
 */
export function StageMenu({ shell, viewer, stage }: StageMenuProps): JSX.Element {
	const actions = useInspectorActions();
	const open = useSignal(false);
	void open.value;

	useEffect(() => {
		const el = stage.current;
		if (!el) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.repeat || editable(e.target)) return;
			const text = TEXT_VIEWERS.has(shell.asset.viewer);
			if (text && e.key.toLowerCase() === "a" && !e.shiftKey && isActionKey(e, isApplePlatform())) {
				e.preventDefault();
				selectAllIn(el);
				return;
			}
			const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
			if (shell.options.embedded && plain && (e.key === "f" || e.key === "F")) {
				e.preventDefault();
				shell.toggleFullscreen();
			}
		};
		el.addEventListener("keydown", onKey);
		return () => el.removeEventListener("keydown", onKey);
	}, [shell]);

	return (
		<ActionMenu
			model={stageRows(shell, viewer, actions, stage.current)}
			aria-label={`Actions for ${shell.asset.name}`}
			surface={stage}
			surfaceSelection={TEXT_VIEWERS.has(shell.asset.viewer)}
			onOpenChange={(next) => (open.value = next)}
		/>
	);
}
// #endregion

// #region Theater
/** Props for {@link TheaterChrome}. */
export interface TheaterChromeProps {
	shell: InspectorShell;
	viewer: MountedViewer;
	/** The fullscreen frame: pointer movement over it wakes the toolbar. */
	frame: RefObject<HTMLDivElement>;
}

/**
 * The floating toolbar of the theater: the canvas's footer toolbar ({@link CanvasToolbar}) woken by
 * the whole fullscreen frame, so a person can always reach Exit.
 */
export function TheaterChrome({ shell, viewer, frame }: TheaterChromeProps): JSX.Element {
	return <CanvasToolbar shell={shell} viewer={viewer} surface={frame} />;
}
// #endregion
