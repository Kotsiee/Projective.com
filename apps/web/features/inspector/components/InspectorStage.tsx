import type { JSX } from "preact";
import { Loader } from "@projective/ui/feedback";
import type { InspectorShell } from "../core/inspector-shell.ts";
import type { MountedViewer } from "./viewers/viewer.ts";
import { UnsupportedFallback } from "./viewers/unsupported/UnsupportedFallback.tsx";

/** Props for {@link InspectorStage}. */
export interface InspectorStageProps {
	shell: InspectorShell;
	viewer: MountedViewer;
}

/**
 * The canvas region. It hosts the viewer's Stage, covers it with a loader until the canvas reports
 * ready, and swaps it for the unsupported fallback when the canvas fails.
 */
export function InspectorStage({ shell, viewer }: InspectorStageProps): JSX.Element {
	const { asset } = shell;
	const status = shell.status.value;
	const Stage = viewer.Stage;
	return (
		<div class="ins-stage-frame">
			<div
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
		</div>
	);
}
