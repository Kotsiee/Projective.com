import type { JSX } from "preact";
import "@web/features/projects/styles/file-card.css";
import "../styles/files-hub.css";
import type { AssetItem, LinkAttachment } from "../types/file-types.ts";
import { ScanMark } from "./file-hub-glyphs.tsx";
import { FileTypeIcon } from "@web/features/projects/components/FileTypeIcon.tsx";
import { ProgressiveImage } from "@projective/ui/display/image";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { fileDateLabel } from "@web/features/projects/core/file-model.ts";

/**
 * LinkCard — the grid cell for a web link stored as a first-class asset (`source === "link"`).
 *
 * It deliberately reuses the `.fx-card` skeleton rather than inventing one. Two reasons, and the
 * second is the load-bearing one:
 *
 *  1. A link sits in the same grid as files and folders, so it must read as a sibling of them.
 *  2. `.fx-card__meta` is exactly 62px, and the shared grid's `rowHeight` formula
 *     (`cellWidth + 62 + gap`) is written against that constant. A bespoke card with its own caption
 *     height would desynchronise the virtualizer's row maths from what is actually painted, which is
 *     how a grid ends up overlapping its own rows.
 *
 * What differs is only what fills the thumb frame: the page's own share image when it has one, else
 * the origin's identity — its re-hosted favicon over the registrable domain — plus the link-safety
 * verdict, which is the one fact about a link a reader cannot get by looking at it.
 *
 * **Both pictures are always the platform's re-hosted copies** (`LinkAttachment.imageUrl` and
 * `faviconUrl` point into our own public bucket). Hotlinking `https://origin/favicon.ico` would leak
 * every viewer's IP address to a host the link's author chose, which turns pasting a link into an
 * IP-harvesting primitive. When the re-hosted copy is missing the card falls back to the link tile
 * and never to the origin.
 *
 * A `blocked` or `suspicious` verdict is shown as a mark plus a caption, and never as the ONLY
 * difference in tone: the state has to survive a colour-blindness overlay.
 */
export interface LinkCardProps {
	asset: AssetItem;
	/** The link facet. Passed separately so the non-null narrowing happens at the call site. */
	link: LinkAttachment;
	/** A single activation — the hub's select. */
	onOpen: (asset: AssetItem) => void;
}

/** Human copy for a link-safety verdict — the reader's question is "is this safe to open?". */
function scanNote(status: LinkAttachment["scanStatus"]): string | null {
	switch (status) {
		case "safe":
			return null;
		case "pending":
			return "Checking this link";
		case "suspicious":
			return "This link looks suspicious";
		case "blocked":
			return "This link is blocked";
		case "unscannable":
			return "This link could not be checked";
	}
}

export function LinkCard({ asset, link, onOpen }: LinkCardProps): JSX.Element {
	const note = scanNote(link.scanStatus);
	const title = asset.name || link.title || link.domain;
	const identity = (
		<>
			<span class="fh-linkcard__favicon">
				{link.faviconUrl
					? <img src={link.faviconUrl} alt="" loading="lazy" draggable={false} />
					: <FileTypeIcon file={asset} />}
			</span>
			<span class="fh-linkcard__domain">{link.domain}</span>
		</>
	);

	return (
		<button
			type="button"
			class="fx-card fh-linkcard"
			data-scan={link.scanStatus}
			onClick={() => onOpen(asset)}
			aria-label={`${title} — web link on ${link.domain}${note ? `. ${note}` : ""}`}
		>
			<span class="fx-card__thumb fh-linkcard__thumb" data-kind="link">
				{link.imageUrl
					? (
						<>
							<ProgressiveImage
								imgClass="fx-card__img"
								src={link.imageUrl}
								fit="contain"
								alt=""
								loading="lazy"
								draggable={false}
								fallback={identity}
							/>
							<FileTypeIcon file={asset} size={22} class="fx-card__family" />
						</>
					)
					: identity}
				{link.scanStatus !== "safe"
					? (
						<span class="fh-linkcard__scan" data-scan={link.scanStatus}>
							<ScanMark status={link.scanStatus} />
						</span>
					)
					: null}
				<span class="fx-card__badge fx-card__badge--ext">LINK</span>
			</span>

			<span class="fx-card__meta">
				<Tooltip content={title} whenTruncated>
					<span class="fx-card__name">{title}</span>
				</Tooltip>
				<span class="fx-card__by">
					<span class="fx-card__srcmark" aria-hidden="true">
						<Icon name="external-link" />
					</span>
					<span class="fx-card__sender">{link.domain}</span>
				</span>
				<span class="fx-card__date">{note ?? fileDateLabel(asset)}</span>
			</span>
		</button>
	);
}
