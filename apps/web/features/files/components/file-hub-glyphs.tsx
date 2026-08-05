import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { sourceGlyphKey } from "../core/asset-model.ts";
import type {
	AssetNodeKind,
	AssetSource,
	AssetVisibility,
	FileStatus,
	LinkScanStatus,
} from "../types/file-types.ts";
import "../styles/files-hub.css";

/**
 * file-hub-glyphs — the `/files` hub's glyph layer.
 *
 * Two populations live here and they follow different contracts on purpose:
 *
 *  1. **Brand marks** (Google Drive · Dropbox · Frame.io · Amazon S3). §B.7 quarantines these OUT of
 *     the shared `@projective/ui/icons` registry: a brand mark is not an icon in the design system's
 *     sense — it cannot be restyled, re-weighted or recoloured without ceasing to be the mark — so it
 *     must not inherit `--icon-stroke`. They are therefore plain filled `<svg>`s inheriting
 *     `currentColor` only, exactly like `marketing/components/footer-icons.tsx`.
 *  2. **Semantic marks** (visibility · link-safety · file status · tree node kind). These are ordinary
 *     icons and route through the shared {@link Icon} registry, so one stylesheet governs their weight
 *     and a call site cannot opt one into a different one.
 *
 * Every export is a COMPONENT returning a fresh VNode rather than a shared constant, so rendering the
 * same mark across hundreds of grid cells and tree rows never trips the Preact VNode-reuse hazard and
 * needs no `cloneElement` (matching `file-glyphs.tsx` / `submission-glyphs.tsx`).
 *
 * Nothing here is ever the accessible name of a control: every glyph is `aria-hidden`, and the name
 * lives on the wrapping button plus its portal `Tooltip` (§B.6).
 */

// #region Brand marks (quarantined — NOT registry icons)
interface BrandProps {
	/** Pixel size. Sized on the SVG box, never through `--icon-stroke` (a mark has no stroke ramp). */
	size?: number;
	class?: string;
}

/** Google Drive — the three-tile triangle. */
export function GoogleDriveMark({ size = 16, class: c }: BrandProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M8.4 2.5h7.2l7.15 12.4h-7.2L8.4 2.5Z" opacity="0.55" />
			<path d="M1.25 14.9 4.86 8.6l7.19 12.45H4.86L1.25 14.9Z" opacity="0.8" />
			<path d="M12.05 21.05h10.7l-3.6-6.15H8.45l3.6 6.15Z" opacity="0.35" />
		</svg>
	);
}

/** Dropbox — the four-diamond box. */
export function DropboxMark({ size = 16, class: c }: BrandProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M6.4 2.7 0.9 6.3l5.5 3.6L12 6.3 6.4 2.7Zm11.2 0L12 6.3l5.6 3.6 5.5-3.6-5.5-3.6ZM0.9 13.4l5.5 3.6 5.6-3.6-5.6-3.5-5.5 3.5Zm22.2 0-5.5-3.5-5.6 3.5 5.6 3.6 5.5-3.6ZM6.4 18.2l5.6 3.6 5.6-3.6L12 14.7l-5.6 3.5Z" />
		</svg>
	);
}

/** Frame.io — the shutter square. */
export function FrameioMark({ size = 16, class: c }: BrandProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2.6 3.1v3h3v-3h-3Zm7.8 0v3h3v-3h-3ZM6.6 15v3h3v-3h-3Zm7.8 0v3h3v-3h-3Z" />
			<path d="M10 10.4v3.2l3.6-1.6L10 10.4Z" opacity="0.7" />
		</svg>
	);
}

/** Amazon S3 — the storage bucket. */
export function AmazonS3Mark({ size = 16, class: c }: BrandProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M4.6 3h14.8l-1.5 15.4a2 2 0 0 1-1.3 1.7l-4.2 1.5a1.2 1.2 0 0 1-.8 0l-4.2-1.5a2 2 0 0 1-1.3-1.7L4.6 3Z" />
			<path d="M12 4.6v15.9" stroke="var(--surface-1)" stroke-width="1.2" opacity="0.5" />
		</svg>
	);
}
// #endregion

// #region Source
/**
 * The storage-source mark for an asset or a folder.
 *
 * `supabase` returns `null` rather than a "platform" mark: the library IS the default place, and a
 * badge on every one of its assets would spend the card's one overlay slot saying nothing. A mark
 * appears exactly when the asset came from somewhere the reader might not expect.
 */
export function SourceMark(
	{ source, size = 14, class: c }: { source: AssetSource; size?: number; class?: string },
): JSX.Element | null {
	switch (sourceGlyphKey(source)) {
		case "library":
			return null;
		case "google-drive":
			return <GoogleDriveMark size={size} class={c} />;
		case "dropbox":
			return <DropboxMark size={size} class={c} />;
		case "frameio":
			return <FrameioMark size={size} class={c} />;
		case "amazon-s3":
			return <AmazonS3Mark size={size} class={c} />;
		case "link":
			return <Icon name="link" class={c} aria-hidden="true" />;
	}
}
// #endregion

// #region Semantic marks (shared registry)
/**
 * The privacy-scope mark.
 *
 * Phrased from the reader's point of view the way `visibilityLabel` is: a closed lock is "only you", a
 * chain link is "anyone holding the link", a globe is "the world". The three are distinguishable by
 * SHAPE and not only by tone, so the state survives a colour-blindness overlay.
 */
export function VisibilityMark(
	{ visibility, class: c }: { visibility: AssetVisibility; class?: string },
): JSX.Element {
	const name = visibility === "private" ? "lock" : visibility === "link" ? "link" : "globe";
	return <Icon name={name} class={c} aria-hidden="true" />;
}

/**
 * The link-safety mark.
 *
 * `unscannable` deliberately does NOT share a glyph with `suspicious`: "we could not reach it" is not
 * "we found something", and one mark for both would either cry wolf on every transient timeout or wave
 * through a host that refuses inspection.
 */
export function ScanMark(
	{ status, class: c }: { status: LinkScanStatus; class?: string },
): JSX.Element {
	const name = status === "safe"
		? "shield"
		: status === "suspicious"
		? "warning"
		: status === "blocked"
		? "error"
		: status === "unscannable"
		? "help"
		: "clock";
	return <Icon name={name} class={c} aria-hidden="true" />;
}

/**
 * The stored-bytes lifecycle mark.
 *
 * A distinct axis from {@link ScanMark}: this is about bytes the platform HOLDS (in flight, in
 * quarantine, settled), while a link scan is a reputation check on a URL whose bytes we never possess.
 * An asset can be `uploaded` with a `pending` link scan, so collapsing the two would make one of the
 * states unshowable.
 */
export function StatusMark(
	{ status, class: c }: { status: FileStatus; class?: string },
): JSX.Element {
	const name = status === "uploaded"
		? "success"
		: status === "pending_upload"
		? "clock"
		: status === "scanning"
		? "shield"
		: status === "quarantined"
		? "lock"
		: "error";
	return <Icon name={name} class={c} aria-hidden="true" />;
}

/** The tree's node-kind mark — what the node IS, not how its card is treated. */
export function NodeMark(
	{ nodeKind, class: c }: { nodeKind: AssetNodeKind; class?: string },
): JSX.Element {
	const name = nodeKind === "project"
		? "projects"
		: nodeKind === "channel"
		? "channel"
		: nodeKind === "drive"
		? "box"
		: "folder";
	return <Icon name={name} class={c} aria-hidden="true" />;
}
// #endregion
