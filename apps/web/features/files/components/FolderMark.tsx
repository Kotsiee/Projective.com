import type { JSX } from "preact";
import { styleVars } from "@ui/core/style.ts";
import "../styles/files-hub.css";
import { folderColorPreview } from "../core/files-state.ts";

export interface FolderMarkProps {
	/** The folder's colour, or `null` for the neutral default. */
	color?: string | null;
	/** The folder drawn, so a colour being tried on it (`folderColorPreview`) shows here live. */
	folderId?: string | null;
	/** Rendered width in px; omit to fill the box it sits in. */
	size?: number;
	class?: string;
}

/**
 * FolderMark — the one drawing of a folder: a tabbed back panel with a front panel over it, which is
 * what tells a folder from a file at any size, on a card, a table row or a tree row. The colour arrives
 * as a custom property, so the stylesheet decides how each panel shades it against the theme's surface.
 * Given its `folderId`, it draws the colour the wheel is trying on that folder while the wheel is open.
 */
export function FolderMark(
	{ color: stored, folderId, size, class: className }: FolderMarkProps,
): JSX.Element {
	const preview = folderColorPreview.value;
	const color = folderId && preview?.folderId === folderId ? preview.color : stored;
	return (
		<svg
			class={`fh-foldermark${className ? ` ${className}` : ""}`}
			viewBox="0 0 120 96"
			width={size}
			height={size === undefined ? undefined : size * 0.8}
			style={styleVars({ "--fh-folder": color ?? undefined })}
			aria-hidden="true"
		>
			<path
				class="fh-foldermark__back"
				d="M8 16a8 8 0 0 1 8-8h28.7a8 8 0 0 1 5.66 2.34l7.3 7.32A8 8 0 0 0 63.3 20H104a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z"
			/>
			<path
				class="fh-foldermark__front"
				d="M8 38a8 8 0 0 1 8-8h88a8 8 0 0 1 8 8v42a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z"
			/>
		</svg>
	);
}
