import type { ComponentChildren, JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display/image";
import { Icon } from "@projective/ui/icons";
import type { MessageAttachment } from "../types/projects-types.ts";
import {
	attachmentOpenHref,
	attachmentPicture,
	attachmentPlaceholder,
} from "../core/chat-attachments.ts";
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
 * Pictures are `ProgressiveImage` frames: a stored image reads the media proxy's `md` rendition over
 * its BlurHash, and a stored video draws its poster's BlurHash under the play mark (its bytes are
 * never put in an `<img>`).
 *
 * With `onOpen`, a plain click on a tile opens the file preview on that attachment, and the `+N`
 * square opens it on the first file it stands for. A tile with an address stays a real link, so a
 * middle or modified click (or a click before the feed hydrates) opens the inspector, or the tile's
 * own address, in a new tab. Without `onOpen` a tile is only that link, and a tile with neither is
 * inert content (root CLAUDE.md §3 gate 11).
 */

export interface MessageMediaProps {
	attachments: MessageAttachment[];
	/** Open the file preview on attachment `index`; `trigger` is the tile focus returns to. */
	onOpen?: (index: number, trigger: HTMLElement) => void;
}

/** Max visual-media tiles that lay out as a single aspect-ratio row before condensing to a grid. */
const ROW_MAX = 3;
/** Hard cap on visible grid squares (the 4th may be a `+N` overlay). */
const GRID_MAX = 4;

const SIZES = {
	single: "auto, 28rem",
	row: "auto, 14rem",
	square: "auto, 5rem",
} as const;

type TileLayout = keyof typeof SIZES;

// #region Tile
interface TileProps {
	/** Where the tile opens in a new tab; `null` when it has no address. */
	href: string | null;
	/** Opens the preview from this tile; absent leaves the tile a plain link (or inert). */
	onOpen?: (trigger: HTMLElement) => void;
	/** The BEM element the tile is. */
	element: "cell" | "square";
	/** Extra modifiers of that element. */
	modifiers?: readonly string[];
	label: string;
	style?: string;
	kind?: string;
	children: ComponentChildren;
}

function isPlainClick(e: JSX.TargetedMouseEvent<HTMLElement>): boolean {
	return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

function tileClass(element: TileProps["element"], modifiers: readonly string[]): string {
	const base = `msg-media__${element}`;
	return [base, ...modifiers.map((m) => `${base}--${m}`)].join(" ");
}

function Tile(
	{ href, onOpen, element, modifiers = [], label, style, kind, children }: TileProps,
): JSX.Element {
	if (onOpen && !href) {
		return (
			<button
				type="button"
				class={tileClass(element, [...modifiers, "action"])}
				aria-label={label}
				aria-haspopup="dialog"
				style={style}
				data-kind={kind}
				onClick={(e) => onOpen(e.currentTarget)}
			>
				{children}
			</button>
		);
	}
	if (href) {
		return (
			<a
				class={tileClass(element, [...modifiers, "action"])}
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={label}
				aria-haspopup={onOpen ? "dialog" : undefined}
				style={style}
				data-kind={kind}
				onClick={onOpen
					? (e) => {
						if (!isPlainClick(e)) return;
						e.preventDefault();
						onOpen(e.currentTarget);
					}
					: undefined}
			>
				{children}
			</a>
		);
	}
	return (
		<span class={tileClass(element, [...modifiers, "inert"])} style={style} data-kind={kind}>
			{children}
		</span>
	);
}
// #endregion

// #region Picture
/** A visual medium renders its picture (a video its poster placeholder + a play badge). */
function isVisual(a: MessageAttachment): boolean {
	return a.kind === "image" || a.kind === "video";
}

function Picture({ att, layout }: { att: MessageAttachment; layout: TileLayout }): JSX.Element {
	const picture = attachmentPicture(att);
	return (
		<ProgressiveImage
			class="msg-media__picture"
			src={picture.src}
			srcset={picture.srcset ?? undefined}
			sizes={SIZES[layout]}
			placeholder={attachmentPlaceholder(att)}
			loading="lazy"
			width={att.width ?? undefined}
			height={att.height ?? undefined}
			fallback={<Icon name={att.kind === "video" ? "video" : "image"} size="md" />}
		/>
	);
}
// #endregion

// #region Cells
/** One aspect-ratio row cell (image or video poster). */
function RowCell(
	{ att, layout, onOpen }: {
		att: MessageAttachment;
		layout: TileLayout;
		onOpen?: (trigger: HTMLElement) => void;
	},
): JSX.Element {
	const ratio = att.width && att.height ? att.width / att.height : 1;
	return (
		<Tile
			href={attachmentOpenHref(att)}
			onOpen={onOpen}
			element="cell"
			style={`--cell-ratio:${ratio.toFixed(4)}`}
			label={att.name}
		>
			<Picture att={att} layout={layout} />
			{att.kind === "video" && <span class="msg-media__play" aria-hidden="true">{PlayIcon}</span>}
		</Tile>
	);
}

/** One grid square — image/video poster, or a file/pdf tile; `overlay` shows the `+N` remainder. */
function GridSquare(
	{ att, overlay, onOpen }: {
		att: MessageAttachment;
		overlay?: number;
		onOpen?: (trigger: HTMLElement) => void;
	},
): JSX.Element {
	const visual = isVisual(att);
	return (
		<Tile
			// The `+N` square stands for several files, so it does not link to the one it happens to show.
			href={overlay ? null : attachmentOpenHref(att)}
			onOpen={onOpen}
			element="square"
			modifiers={overlay ? ["overlay"] : []}
			kind={att.kind}
			label={overlay ? `${overlay} more attachments` : att.name}
		>
			{visual
				? <Picture att={att} layout="square" />
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
// #endregion

export function MessageMedia({ attachments, onOpen }: MessageMediaProps): JSX.Element | null {
	if (attachments.length === 0) return null;

	const opener = (index: number) =>
		onOpen ? (trigger: HTMLElement) => onOpen(index, trigger) : undefined;
	const allVisual = attachments.every(isVisual);

	// Single visual medium — show it large at its true aspect ratio (capped).
	if (allVisual && attachments.length === 1) {
		return (
			<div class="msg-media msg-media--single">
				<RowCell att={attachments[0]} layout="single" onOpen={opener(0)} />
			</div>
		);
	}

	// A small set of pure visual media → a single aspect-ratio row.
	if (allVisual && attachments.length <= ROW_MAX) {
		return (
			<div class="msg-media msg-media--row" role="group" aria-label="Attachments">
				{attachments.map((att, i) => (
					<RowCell key={att.id} att={att} layout="row" onOpen={opener(i)} />
				))}
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
			{shown.map((att, i) => <GridSquare key={att.id} att={att} onOpen={opener(i)} />)}
			{overlayAtt
				? (
					<GridSquare
						key={overlayAtt.id}
						att={overlayAtt}
						overlay={total - (GRID_MAX - 1)}
						onOpen={opener(GRID_MAX - 1)}
					/>
				)
				: null}
		</div>
	);
}
