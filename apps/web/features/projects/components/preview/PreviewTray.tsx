import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { ProgressiveImage } from "@projective/ui/display/image";
import { Icon } from "@projective/ui/icons";
import { assetMediaSrc, assetPlaceholder } from "@features/files/core/asset-media.ts";
import type { AssetItem } from "../../types/projects-types.ts";
import { previewIconName } from "./preview-model.ts";
import { PreviewAction } from "./PreviewAction.tsx";

/** Props for {@link PreviewTray}. */
export interface PreviewTrayProps {
	files: readonly AssetItem[];
	index: number;
	onSelect: (index: number) => void;
	/** Arrow keys page through the group while focus is in the tray. */
	onKeyDown?: (event: JSX.TargetedKeyboardEvent<HTMLElement>) => void;
}

function Thumb({ file }: { file: AssetItem }): JSX.Element {
	const glyph = (
		<span class="fx-tray__glyph" aria-hidden="true">
			<Icon name={previewIconName(file.kind)} size="sm" />
		</span>
	);
	const visual = file.kind === "image" || file.kind === "video";
	const src = visual ? assetMediaSrc(file, "sm") : null;
	if (!src) return glyph;
	return (
		<ProgressiveImage
			class="fx-tray__img"
			src={src}
			placeholder={assetPlaceholder(file)}
			loading="lazy"
			draggable={false}
			fallback={glyph}
		/>
	);
}

/** The group's thumbnail strip between previous and next; nothing for a single file. */
export function PreviewTray(
	{ files, index, onSelect, onKeyDown }: PreviewTrayProps,
): JSX.Element | null {
	const stripRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const active = stripRef.current?.querySelector<HTMLElement>("[aria-current='true']");
		active?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [index]);

	if (files.length < 2) return null;
	const last = files.length - 1;
	return (
		<nav class="fx-tray" aria-label="Files in this message" onKeyDown={onKeyDown}>
			<PreviewAction
				icon="chevron-left"
				label="Previous file"
				disabled={index === 0}
				onClick={() => onSelect(index - 1)}
			/>
			<div ref={stripRef} class="fx-tray__strip">
				{files.map((file, i) => (
					<button
						key={file.id}
						type="button"
						class="fx-tray__thumb"
						aria-label={`${file.name} (${i + 1} of ${files.length})`}
						aria-current={i === index ? "true" : undefined}
						onClick={() => onSelect(i)}
					>
						<Thumb file={file} />
					</button>
				))}
			</div>
			<PreviewAction
				icon="chevron-right"
				label="Next file"
				disabled={index === last}
				onClick={() => onSelect(index + 1)}
			/>
		</nav>
	);
}
