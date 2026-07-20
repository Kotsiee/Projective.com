import type { JSX } from "preact";
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
 * Zero-JS server-safe (plain lazy `<img>`); the lightbox/gallery open is deferred (the tiles are
 * buttons so it wires in without markup churn).
 */

export interface MessageMediaProps {
	attachments: MessageAttachment[];
}

/** Max visual-media tiles that lay out as a single aspect-ratio row before condensing to a grid. */
const ROW_MAX = 3;
/** Hard cap on visible grid squares (the 4th may be a `+N` overlay). */
const GRID_MAX = 4;

/** A visual medium renders its image (videos use the poster + a play badge). */
function isVisual(a: MessageAttachment): boolean {
	return a.kind === "image" || a.kind === "video";
}

/** One aspect-ratio row cell (image or video poster). */
function RowCell({ att }: { att: MessageAttachment }): JSX.Element {
	const ratio = att.width && att.height ? att.width / att.height : 1;
	return (
		<button
			type="button"
			class="msg-media__cell"
			style={`--cell-ratio:${ratio.toFixed(4)}`}
			aria-label={att.name}
		>
			<img class="msg-media__img" src={att.url} alt={att.name} loading="lazy" />
			{att.kind === "video" && <span class="msg-media__play" aria-hidden="true">{PlayIcon}</span>}
		</button>
	);
}

/** One grid square — image/video poster, or a file/pdf tile; `overlay` shows the `+N` remainder. */
function GridSquare(
	{ att, overlay }: { att: MessageAttachment; overlay?: number },
): JSX.Element {
	const visual = isVisual(att);
	return (
		<button
			type="button"
			class="msg-media__square"
			data-kind={att.kind}
			data-overlay={overlay ? "true" : undefined}
			aria-label={overlay ? `${overlay} more attachments` : att.name}
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
		</button>
	);
}

export function MessageMedia({ attachments }: MessageMediaProps): JSX.Element | null {
	if (attachments.length === 0) return null;

	const allVisual = attachments.every(isVisual);

	// Single visual medium — show it large at its true aspect ratio (capped).
	if (allVisual && attachments.length === 1) {
		const a = attachments[0];
		const ratio = a.width && a.height ? a.width / a.height : 1;
		return (
			<div class="msg-media msg-media--single">
				<button
					type="button"
					class="msg-media__cell"
					style={`--cell-ratio:${ratio.toFixed(4)}`}
					aria-label={a.name}
				>
					<img class="msg-media__img" src={a.url} alt={a.name} loading="lazy" />
					{a.kind === "video" && <span class="msg-media__play" aria-hidden="true">{PlayIcon}</span>}
				</button>
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
