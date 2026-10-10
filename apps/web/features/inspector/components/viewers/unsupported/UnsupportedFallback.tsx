import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { FileKindIcon } from "@features/projects/components/file-glyphs.tsx";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { useInspectorActions } from "../../InspectorContext.ts";

/** Props for {@link UnsupportedFallback}. */
export interface UnsupportedFallbackProps {
	shell: InspectorShell;
}

/**
 * The calm stage for a file no canvas can draw, or one whose canvas gave up: the file's glyph and
 * name, why there is no preview, a download, and the stored preview image when one exists.
 */
export function UnsupportedFallback({ shell }: UnsupportedFallbackProps): JSX.Element {
	const { asset } = shell;
	const actions = useInspectorActions();
	const showPreview = useSignal(false);
	const reason = shell.error.value ??
		`Preview isn't available for ${asset.categoryLabel.toLowerCase()} files.`;

	if (showPreview.value && asset.previewSrc) {
		return (
			<div class="ins-fallback ins-fallback--preview">
				<img
					class="ins-fallback__image"
					src={asset.previewSrc}
					alt={`Preview of ${asset.name}`}
					decoding="async"
					draggable={false}
				/>
				<Button
					size="sm"
					severity="neutral"
					variant="outlined"
					icon={<Icon name="close" size="sm" />}
					label="Hide preview image"
					onClick={() => (showPreview.value = false)}
				/>
			</div>
		);
	}

	return (
		<div class="ins-fallback">
			<span class="ins-fallback__glyph" aria-hidden="true">
				<FileKindIcon kind={asset.kind} size={48} />
			</span>
			<p class="ins-fallback__name">{asset.name}</p>
			<p class="ins-fallback__reason">{reason}</p>
			<div class="ins-fallback__actions">
				<Button
					size="sm"
					severity="neutral"
					variant="outlined"
					icon={<Icon name="download" size="sm" />}
					label="Download"
					onClick={actions.download}
				/>
				{asset.previewSrc
					? (
						<Button
							size="sm"
							variant="text"
							severity="secondary"
							icon={<Icon name="image" size="sm" />}
							label="Show preview image"
							onClick={() => (showPreview.value = true)}
						/>
					)
					: null}
			</div>
		</div>
	);
}
