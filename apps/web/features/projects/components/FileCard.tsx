import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { type AssetItem, sourceLabel } from "../types/projects-types.ts";
import { FileKindIcon, PlayIcon } from "./file-glyphs.tsx";

/**
 * FileCard — one grid cell. A forced rounded-SQUARE thumbnail frame (1:1, never the media's native
 * ratio) holding either the image/video preview or a centered category glyph, with the filename, a
 * small sender avatar + name beneath, and the date/time revealed ONLY on hover (its space is always
 * reserved so the reveal can never clip or overlap adjacent cards). Transparent border + background at
 * rest; hover paints a subtle surface highlight (full border allowed — the card is interactive, §B.4).
 *
 * Takes the widened {@link AssetItem}, so the same cell serves a channel attachment (which has a
 * sender) and a `/files` hub or drive-mounted asset (which does not). When `sender` is null the
 * byline falls back to the storage SOURCE — the row is never dropped, because `.fx-card__meta` is
 * exactly 62px and the shared grid's `rowHeight` formula is written against that constant.
 */
export interface FileCardProps {
	file: AssetItem;
	onOpen: (file: AssetItem) => void;
}

export function FileCard({ file, onOpen }: FileCardProps): JSX.Element {
	const hasThumb = file.thumbnailUrl !== null && (file.kind === "image" || file.kind === "video");

	return (
		<button
			type="button"
			class="fx-card"
			onClick={() => onOpen(file)}
			aria-label={`${file.name} — ${file.sizeLabel}, from ${
				file.sender?.name ?? sourceLabel(file.source)
			}`}
		>
			<span class="fx-card__thumb" data-kind={file.kind}>
				{hasThumb
					? (
						<img
							class="fx-card__img"
							src={file.thumbnailUrl ?? file.url}
							alt=""
							loading="lazy"
							draggable={false}
						/>
					)
					: (
						<span class="fx-card__glyph" aria-hidden="true">
							<FileKindIcon kind={file.kind} size={30} />
						</span>
					)}
				{file.kind === "video"
					? (
						<span class="fx-card__play" aria-hidden="true">
							<PlayIcon size={20} />
						</span>
					)
					: null}
				{file.durationLabel
					? <span class="fx-card__badge">{file.durationLabel}</span>
					: <span class="fx-card__badge fx-card__badge--ext">{file.ext.toUpperCase()}</span>}
			</span>

			<span class="fx-card__meta">
				<span class="fx-card__name" title={file.name}>{file.name}</span>
				<span class="fx-card__by">
					{file.sender
						? (
							<>
								<Avatar
									image={file.sender.avatar ?? undefined}
									label={file.sender.name}
									size={16}
									alt=""
								/>
								<span class="fx-card__sender">{file.sender.name}</span>
							</>
						)
						: (
							<>
								<span class="fx-card__srcmark" aria-hidden="true">
									<FileKindIcon kind={file.kind} size={12} />
								</span>
								<span class="fx-card__sender">{sourceLabel(file.source)}</span>
							</>
						)}
				</span>
				<span class="fx-card__date">{file.dateLabel}</span>
			</span>
		</button>
	);
}
