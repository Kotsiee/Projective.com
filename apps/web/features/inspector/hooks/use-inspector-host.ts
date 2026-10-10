import { useMemo } from "preact/hooks";
import type { InspectAsset } from "@projective/types/files";
import { createInspectorShell, type InspectorShellHost } from "../core/inspector-shell.ts";
import { downloadAsset } from "../core/inspector-download.ts";
import type { InspectorActions } from "../components/InspectorContext.ts";
import { mountViewer } from "../components/viewers/registry.ts";
import type { MountedViewer } from "../components/viewers/viewer.ts";

/** Options for {@link useInspectorHost}. */
export interface InspectorHostOptions {
	/** Whether the viewer is signed in; decides whether a download is recorded. */
	signedIn: boolean;
	/**
	 * Host the inspector inside another surface: no URL fragment writes, no printing, keys scoped
	 * to the host, 3D models handed off to `/inspect`. Default `false` (the standalone page).
	 */
	embedded?: boolean;
}

/** Everything a surface needs to show one file through the inspector's canvases. */
export interface InspectorHost {
	shell: InspectorShellHost;
	viewer: MountedViewer;
	actions: InspectorActions;
}

/**
 * Create the inspector for one asset: its shell, the mounted canvas and the workspace actions
 * (download, copy). Recreated when the asset id or the embedding changes; key the consumer by the
 * asset id as well so every canvas effect restarts cleanly.
 */
export function useInspectorHost(asset: InspectAsset, opts: InspectorHostOptions): InspectorHost {
	const { signedIn } = opts;
	const embedded = opts.embedded ?? false;

	const shell = useMemo(
		() =>
			createInspectorShell(
				asset,
				embedded ? { urlSync: false, print: false, embedded: true } : undefined,
			),
		[asset.id, embedded],
	);
	const viewer = useMemo(() => mountViewer(shell), [shell]);

	const actions = useMemo<InspectorActions>(() => {
		const fallback = embedded ? "" : " Copy it from the address bar instead.";
		return {
			signedIn,
			download: () => void downloadAsset(shell.asset, signedIn),
			copy: async (text, confirmation) => {
				const clipboard = globalThis.navigator?.clipboard;
				if (!clipboard || text.length === 0) {
					shell.announce(`Copying isn't available here.${fallback}`);
					return false;
				}
				try {
					await clipboard.writeText(text);
					shell.announce(confirmation);
					return true;
				} catch {
					shell.announce(`Couldn't copy that.${fallback}`);
					return false;
				}
			},
		};
	}, [shell, signedIn, embedded]);

	return useMemo(() => ({ shell, viewer, actions }), [shell, viewer, actions]);
}
