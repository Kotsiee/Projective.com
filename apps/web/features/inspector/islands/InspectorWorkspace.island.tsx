import type { JSX } from "preact";
import { effect, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/inspector.css";
import "../styles/viewer-image.css";
import "../styles/viewer-media.css";
import "../styles/viewer-text.css";
import "../styles/code-theme.css";
import "../styles/viewer-pdf.css";
import "../styles/inspector-print.css";
import "../styles/viewer-model.css";
import "../styles/viewer-document.css";
import type { InspectAsset } from "@projective/types/files";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { useIsMobile } from "@projective/ui/hooks";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { initialPanelOpen, workspaceCommand } from "../core/inspector-model.ts";
import { useInspectorHost } from "../hooks/use-inspector-host.ts";
import { InspectorActionsContext } from "../components/InspectorContext.ts";
import { InspectorBar } from "../components/InspectorBar.tsx";
import { InspectorLiveRegion } from "../components/InspectorLiveRegion.tsx";
import { InspectorPanel } from "../components/InspectorPanel.tsx";
import { InspectorSheet } from "../components/InspectorSheet.tsx";
import { InspectorStage } from "../components/InspectorStage.tsx";

/** Props for {@link InspectorWorkspace}. */
export interface InspectorWorkspaceProps {
	asset: InspectAsset;
	signedIn: boolean;
}

const PANEL_ID = "ins-panel";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement;
}

/**
 * The shell-free inspector: a bar, the canvas for this file, and a resizable details panel (a
 * bottom sheet below `--bp-md`). Hosts the inspector through {@link useInspectorHost} and adds the
 * page's own parts: the Fullscreen API binding, the workspace shortcuts and the panel preference.
 */
export default function InspectorWorkspace(
	{ asset, signedIn }: InspectorWorkspaceProps,
): JSX.Element {
	const { shell, viewer, actions } = useInspectorHost(asset, { signedIn });
	const mobile = useIsMobile();
	const shortcutsOpen = useSignal(false);
	const shortcutsRef = useRef<HTMLElement>(null);

	// #region Panel state
	useEffect(() => {
		shell.panelOpen.value = initialPanelOpen(
			readStored("local", LocalKeys.INSPECTOR_PANEL_OPEN),
			mobile,
		);
		if (mobile) return;
		return effect(() => {
			writeStored("local", LocalKeys.INSPECTOR_PANEL_OPEN, shell.panelOpen.value ? "1" : "0");
		});
	}, [shell, mobile]);
	// #endregion

	// #region Fullscreen
	useEffect(() => {
		const doc = document;
		const target = doc.documentElement;
		shell.fullscreenSupported.value = doc.fullscreenEnabled === true &&
			typeof target.requestFullscreen === "function";
		const sync = () => (shell.fullscreen.value = doc.fullscreenElement !== null);
		sync();
		doc.addEventListener("fullscreenchange", sync);
		shell.setFullscreenHandler(() => {
			const change = doc.fullscreenElement ? doc.exitFullscreen() : target.requestFullscreen();
			change.catch(() => shell.announce("Fullscreen isn't available right now."));
		});
		return () => {
			doc.removeEventListener("fullscreenchange", sync);
			shell.setFullscreenHandler(null);
		};
	}, [shell]);
	// #endregion

	// #region Workspace shortcuts
	useEffect(() => {
		const revealShortcuts = () => {
			shell.panelOpen.value = true;
			shortcutsOpen.value = true;
			setTimeout(() => {
				const summary = shortcutsRef.current;
				if (summary && document.activeElement !== summary) summary.focus();
			}, 0);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.repeat || isTypingTarget(e.target)) return;
			const command = workspaceCommand(e);
			if (command === "fullscreen" && shell.fullscreenSupported.peek()) {
				e.preventDefault();
				shell.toggleFullscreen();
			} else if (command === "panel") {
				e.preventDefault();
				shell.togglePanel();
			} else if (command === "shortcuts") {
				e.preventDefault();
				revealShortcuts();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [shell]);
	// #endregion

	const panelOpen = shell.panelOpen.value;
	const desktopPanel = panelOpen && !mobile;
	const panel = (
		<InspectorPanel
			id={PANEL_ID}
			shell={shell}
			viewer={viewer}
			shortcutsOpen={shortcutsOpen}
			shortcutsRef={shortcutsRef}
		/>
	);

	return (
		<InspectorActionsContext.Provider value={actions}>
			<div class="ins" data-fullscreen={shell.fullscreen.value ? "true" : undefined}>
				<InspectorBar shell={shell} compact={mobile} panelId={PANEL_ID} />
				<main class="ins__body">
					<Splitter layout="horizontal" class="ins__split" stateKey="inspector-panel">
						<SplitterPanel size={desktopPanel ? 74 : 100} minSize={45}>
							<InspectorStage shell={shell} viewer={viewer} />
						</SplitterPanel>
						{desktopPanel
							? (
								<SplitterPanel size={26} minSize={18} maxSize={45} class="ins__panel-pane">
									{panel}
								</SplitterPanel>
							)
							: null}
					</Splitter>
					{mobile
						? (
							<InspectorSheet open={shell.panelOpen} label="File details" scrim="glass">
								{panel}
							</InspectorSheet>
						)
						: null}
				</main>
				<InspectorLiveRegion shell={shell} />
			</div>
		</InspectorActionsContext.Provider>
	);
}
