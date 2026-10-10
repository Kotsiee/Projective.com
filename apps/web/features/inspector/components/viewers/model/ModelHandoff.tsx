import { h, type JSX } from "preact";
import { fileInspectHref } from "@projective/types/files";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { useInspectorActions } from "../../InspectorContext.ts";
import { defineViewer } from "../viewer.ts";

/** Props for {@link ModelHandoff}. */
export interface ModelHandoffProps {
	shell: InspectorShell;
}

/**
 * The embedded stand-in for the 3D canvas: the model's name and a link that opens it in the
 * inspector, whose page alone may run the WebGL decoders (Decision #161).
 */
export function ModelHandoff({ shell }: ModelHandoffProps): JSX.Element {
	const { asset } = shell;
	const actions = useInspectorActions();
	const share = asset.access === "share" ? asset.share : null;
	return (
		<div class="ins-fallback ins-handoff">
			<span class="ins-fallback__glyph" aria-hidden="true">
				<Icon name="cube-3d" size="xl" />
			</span>
			<p class="ins-fallback__name">{asset.name}</p>
			<p class="ins-fallback__reason">
				3D models open in the inspector, where you can orbit, light and measure them.
			</p>
			<div class="ins-fallback__actions">
				<a
					class="ins-handoff__link"
					href={fileInspectHref(asset.id, { share })}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Icon name="external-link" size="sm" />
					<span>Open in inspector</span>
				</a>
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					icon={<Icon name="download" size="sm" />}
					label="Download"
					onClick={actions.download}
				/>
			</div>
		</div>
	);
}

/** The model viewer an embedding host mounts instead of the WebGL canvas. */
export const embedModelHandoff = defineViewer<null>({
	createTools(shell) {
		if (shell.status.peek() === "loading") shell.status.value = "ready";
		return null;
	},
	Stage: ({ shell }) => h(ModelHandoff, { shell }),
	Controls: null,
	shortcuts: [],
});
