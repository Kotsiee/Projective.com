import type { JSX } from "preact";
import "@web/features/projects/styles/file-card.css";
import "../styles/files-hub.css";
import type { AssetItem, LinkAttachment } from "../types/file-types.ts";
import { ScanMark } from "./file-hub-glyphs.tsx";
import { Icon } from "@projective/ui/icons";

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
 * What differs is only what fills the thumb frame: not a file preview but the origin's identity — its
 * re-hosted favicon over the registrable domain — plus the link-safety verdict, which is the one fact
 * about a link a reader cannot get by looking at it.
 *
 * **The favicon is always the platform's re-hosted copy** (`LinkAttachment.faviconUrl` points into our
 * own public bucket). Hotlinking `https://origin/favicon.ico` would leak every viewer's IP address to
 * a host the link's author chose, which turns pasting a link into an IP-harvesting primitive. When the
 * re-hosted copy is missing the card falls back to the generic link glyph and never to the origin.
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
	const title = link.title || link.domain;

	return (
		<button
			type="button"
			class="fx-card fh-linkcard"
			data-scan={link.scanStatus}
			onClick={() => onOpen(asset)}
			aria-label={`${title} — web link on ${link.domain}${note ? `. ${note}` : ""}`}
		>
			<span class="fx-card__thumb fh-linkcard__thumb" data-kind="link">
				<span class="fh-linkcard__favicon">
					{link.faviconUrl
						? <img src={link.faviconUrl} alt="" loading="lazy" draggable={false} />
						: <Icon name="link" size="lg" aria-hidden="true" />}
				</span>
				<span class="fh-linkcard__domain">{link.domain}</span>
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
				<span class="fx-card__name" title={title}>{title}</span>
				<span class="fx-card__by">
					<span class="fx-card__srcmark" aria-hidden="true">
						<Icon name="external-link" />
					</span>
					<span class="fx-card__sender">{link.domain}</span>
				</span>
				<span class="fx-card__date">{note ?? asset.dateLabel}</span>
			</span>
		</button>
	);
}
