import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { styleVars } from "@ui/core/style.ts";
import { Loader } from "@projective/ui/feedback";
import { useDismiss, useOverlayStack } from "@projective/ui/hooks";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { useNativeFullscreen } from "../hooks/use-native-fullscreen.ts";
import type { MountedViewer } from "./viewers/viewer.ts";
import { UnsupportedFallback } from "./viewers/unsupported/UnsupportedFallback.tsx";
import { StageMenu, TheaterChrome } from "./StageMenu.tsx";

/** Props for {@link InspectorStage}. */
export interface InspectorStageProps {
	shell: InspectorShell;
	viewer: MountedViewer;
}

/**
 * The canvas region. It hosts the viewer's Stage, covers it with a loader until the canvas reports
 * ready, and swaps it for the unsupported fallback when the canvas fails. A right-click opens the
 * canvas's menu ({@link StageMenu}) on every host.
 *
 * In fullscreen (the theater, Decision #400) the frame covers the viewport in place, so the canvas
 * keeps its state and a host's overlays still stack above it, and the whole document goes fullscreen
 * through the Fullscreen API where the browser allows it (Decision #401), which hides the browser's
 * own chrome without moving the canvas. It takes a slot on the overlay stack, which makes Escape
 * leave the theater before it closes a preview modal underneath.
 */
export function InspectorStage({ shell, viewer }: InspectorStageProps): JSX.Element {
	const { asset } = shell;
	const status = shell.status.value;
	const theater = shell.fullscreen.value;
	const Stage = viewer.Stage;
	const frame = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	useNativeFullscreen(shell);
	const layer = useOverlayStack({ active: theater, layer: "modal" });
	useDismiss({
		open: theater,
		enabled: layer.isTop,
		onDismiss: () => (shell.fullscreen.value = false),
		panelRef: frame,
		closeOnOutside: false,
	});

	return (
		<div
			class="ins-stage-frame"
			ref={frame}
			data-theater={theater ? "true" : undefined}
			style={theater ? styleVars({ "--ins-theater-z": String(layer.zIndex) }) : undefined}
		>
			<div
				ref={stage}
				class="ins-stage"
				data-viewer={asset.viewer}
				data-status={status}
				role="region"
				aria-label={`${asset.name} preview`}
				aria-busy={status === "loading" || undefined}
				tabIndex={0}
			>
				{status === "error" ? <UnsupportedFallback shell={shell} /> : <Stage />}
				{status === "loading"
					? (
						<div class="ins-stage__loading">
							<Loader label="Loading preview…" />
						</div>
					)
					: null}
			</div>
			<StageMenu shell={shell} viewer={viewer} stage={stage} />
			{theater ? <TheaterChrome shell={shell} viewer={viewer} frame={frame} /> : null}
		</div>
	);
}
