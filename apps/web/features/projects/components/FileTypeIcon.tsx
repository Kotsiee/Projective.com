import type { JSX } from "preact";
import { fileFamily, type FileFamilySource, fileSoftware } from "@projective/types/files";
import { styleVars } from "@ui/core/style.ts";
import { SoftwareMark } from "@features/shell/components/software-marks.tsx";
import { FileFamilyGlyph } from "./file-glyphs.tsx";
import "../styles/file-type-icon.css";

/** The smallest tile that can carry a readable banner. The card's fluid tile never drops below it. */
const BANNER_MIN = 44;

/** Props for {@link FileTypeIcon}. */
export interface FileTypeIconProps {
	/** The row's own facts; {@link fileFamily} decides the rest. */
	file: FileFamilySource;
	/** Tile edge in px. Omit to let the stylesheet size it (the card's container-relative size). */
	size?: number;
	class?: string;
}

/**
 * FileTypeIcon — the coloured tile a file is recognised by, on a card, in a list row and in the
 * inspector. Decorative by construction: a file's name and type are always in the text beside it, so
 * the tile is hidden from assistive technology and the type is never carried by colour alone.
 *
 * A file an application owns takes that application's fill and mark over its family's, and a tile big
 * enough to read one prints the extension on a banner, which is what tells a `.unity` from a `.prefab`.
 */
export function FileTypeIcon({ file, size, class: className }: FileTypeIconProps): JSX.Element {
	const family = fileFamily(file);
	const software = fileSoftware(file);
	const banner = software && (size === undefined || size >= BANNER_MIN)
		? file.ext.trim().toUpperCase()
		: null;
	return (
		<span
			class={`fx-type${banner ? " fx-type--banner" : ""}${className ? ` ${className}` : ""}`}
			data-family={family}
			data-software={software ?? undefined}
			style={styleVars({
				"--fx-type-size": size === undefined ? undefined : `${size}px`,
				"--fx-type-fill": software ? `var(--file-${software})` : undefined,
				"--fx-type-ink": software ? `var(--on-file-${software})` : undefined,
			})}
			aria-hidden="true"
		>
			{software
				? <SoftwareMark software={software} class="fx-type__mark" />
				: <FileFamilyGlyph family={family} class="fx-type__glyph" />}
			{banner ? <span class="fx-type__banner">{banner}</span> : null}
		</span>
	);
}
