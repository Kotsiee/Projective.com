import type { ComponentChildren, JSX } from "preact";
import type { MessageAttachment } from "../types/projects-types.ts";
import { FileTypeGlyph } from "./composer-glyphs.tsx";
import { PlayIcon } from "./chat-glyphs.tsx";

/**
 * MessageMedia — the attachment layout for a chat bubble (task §4):
 *
 *   - A set of pure visual media (images/videos), up to {@link ROW_MAX}, lays out in a **single row** in
 *     true aspect ratio (each cell's flex weight ∝ its aspect ratio, shared row height).
 *   - Anything else — more media than fit a row, OR a MIXED set (images + pdfs + videos + files) —
 *     condenses into a **grid of rounded squares** (slightly larger than the composer's 4rem previews).
 *   - A strict maximum of **4** squares is shown: past that, 3 asset squares + a 4th `+N` overlay.
 *
 * Zero-JS server-safe (plain lazy `<img>`). A tile with an address is a real link that opens the
 * asset in a new tab — the full original for an image (the bubble draws a rendition), the object
 * route's own disposition for everything else, which downloads a type that is not safe to show
 * inline. A tile with no address is not a control at all: a button that does nothing is a defect
 * here (root CLAUDE.md §3 gate 11), and before tiles were links every attachment rendered as one.
 */

export interface MessageMediaProps {
	attachments: MessageAttachment[];
}

/** Max visual-media tiles that lay out as a single aspect-ratio row before condensing to a grid. */
const ROW_MAX = 3;
/** Hard cap on visible grid squares (the 4th may be a `+N` overlay). */
const GRID_MAX = 4;

/**
 * Where a tile opens: the asset itself, without the rendition size the bubble asked for — a reader
 * opening a photo wants the photo, not the `md` WebP drawn in the bubble. `null` when there is no
 * address to open.
 */
function openHref(att: MessageAttachment): string | null {
	if (!att.url || att.url === "#") return null;
	if (!att.url.startsWith("/")) return att.url;
	const parsed = new URL(att.url, "https://projective.invalid");
	parsed.searchParams.delete("tier");
	const qs = parsed.searchParams.toString();
	return `${parsed.pathname}${qs ? `?${qs}` : ""}`;
}

interface TileProps {
	/** Where the tile opens; `null` renders a non-interactive tile. */
	href: string | null;
	class: string;
	label: string;
	style?: string;
	kind?: string;
	children: ComponentChildren;
}

/** A tile: a new-tab link when the asset has an address, otherwise inert content. */
function Tile({ href, class: cls, label, style, kind, children }: TileProps): JSX.Element {
	if (href) {
		return (
			<a
				class={cls}
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={label}
				style={style}
				data-kind={kind}
			>
				{children}
			</a>
		);
	}
	return <span class={cls} style={style} data-kind={kind}>{children}</span>;
}

/** A visual medium renders its image (videos use the poster + a play badge). */
function isVisual(a: MessageAttachment): boolean {
	return a.kind === "image" || a.kind === "video";
}

/** One aspect-ratio row cell (image or video poster). */
function RowCell({ att }: { att: MessageAttachment }): JSX.Element {
	const ratio = att.width && att.height ? att.width / att.height : 1;
	return (
		<Tile
			href={openHref(att)}
			class="msg-media__cell"
			style={`--cell-ratio:${ratio.toFixed(4)}`}
			label={att.name}
		>
			<img class="msg-media__img" src={att.url} alt={att.name} loading="lazy" />
			{att.kind === "video" && <span class="msg-media__play" aria-hidden="true">{PlayIcon}</span>}
		</Tile>
	);
}

/** One grid square — image/video poster, or a file/pdf tile; `overlay` shows the `+N` remainder. */
function GridSquare(
	{ att, overlay }: { att: MessageAttachment; overlay?: number },
): JSX.Element {
	const visual = isVisual(att);
	return (
		<Tile
			// The `+N` square stands for several files, so it does not link to the one it happens to show.
			href={overlay ? null : openHref(att)}
			class={overlay ? "msg-media__square msg-media__square--overlay" : "msg-media__square"}
			kind={att.kind}
			label={overlay ? `${overlay} more attachments` : att.name}
		>
			{visual
				? <img class="msg-media__img" src={att.url} alt={att.name} loading="lazy" />
				: (
					<span class="msg-media__file" aria-hidden="true">
						<FileTypeGlyph ext={att.ext} />
						{att.ext && <span class="msg-media__ext">{att.ext}</span>}
					</span>
				)}
			{att.kind === "video" && !overlay && (
				<span class="msg-media__play msg-media__play--sm" aria-hidden="true">{PlayIcon}</span>
			)}
			{!visual && !overlay && <span class="msg-media__name">{att.name}</span>}
			{overlay ? <span class="msg-media__more">+{overlay}</span> : null}
		</Tile>
	);
}

export function MessageMedia({ attachments }: MessageMediaProps): JSX.Element | null {
	if (attachments.length === 0) return null;

	const allVisual = attachments.every(isVisual);

	// Single visual medium — show it large at its true aspect ratio (capped).
	if (allVisual && attachments.length === 1) {
		return (
			<div class="msg-media msg-media--single">
				<RowCell att={attachments[0]} />
			</div>
		);
	}

	// A small set of pure visual media → a single aspect-ratio row.
	if (allVisual && attachments.length <= ROW_MAX) {
		return (
			<div class="msg-media msg-media--row" role="group" aria-label="Attachments">
				{attachments.map((att) => <RowCell key={att.id} att={att} />)}
			</div>
		);
	}

	// Otherwise (mixed media, or more media than a row) → a grid of squares, max 4 visible.
	const total = attachments.length;
	const overflow = total > GRID_MAX;
	const shown = overflow ? attachments.slice(0, GRID_MAX - 1) : attachments.slice(0, GRID_MAX);
	const overlayAtt = overflow ? attachments[GRID_MAX - 1] : null;
	return (
		<div
			class="msg-media msg-media--grid"
			data-count={shown.length + (overlayAtt ? 1 : 0)}
			role="group"
			aria-label="Attachments"
		>
			{shown.map((att) => <GridSquare key={att.id} att={att} />)}
			{overlayAtt
				? <GridSquare key={overlayAtt.id} att={overlayAtt} overlay={total - (GRID_MAX - 1)} />
				: null}
		</div>
	);
}
