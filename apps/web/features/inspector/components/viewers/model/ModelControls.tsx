import type { JSX } from "preact";
import type { ViewerProps } from "../viewer.ts";
import type { ModelTools } from "./model-tools.ts";
import { ModelCameraTools } from "./ModelCameraTools.tsx";
import { ModelSceneTools } from "./ModelSceneTools.tsx";
import { ModelDisplayTools } from "./ModelDisplayTools.tsx";
import { ModelAnimationTools } from "./ModelAnimationTools.tsx";

/** The model canvas's panel controls, shown once the scene is live. */
export function ModelControls({ tools }: ViewerProps<ModelTools>): JSX.Element | null {
	if (!tools.ready.value) return null;
	return (
		<div class="ins-model-tools">
			<ModelCameraTools tools={tools} />
			<ModelSceneTools tools={tools} />
			<ModelDisplayTools tools={tools} />
			<ModelAnimationTools tools={tools} />
		</div>
	);
}
