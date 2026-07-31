import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * composer-glyphs — inline 1em `currentColor` line icons for the channel Chat composer (mic · send ·
 * stop · upload · library · file-type marks). Co-located with the feature, same `<Svg>` base as
 * `glyphs.tsx`/`detail-glyphs.tsx` (the package has no icon registry — root CLAUDE.md §3). Reuse
 * `PlusIcon`, `CloseIcon`, `TrashIcon` from `glyphs.tsx`; this file only adds the composer's own set.
 */

// #region Base
function Svg(props: JSX.SVGAttributes<SVGSVGElement>): JSX.Element {
	return <IconShell {...props} />;
}
// #endregion

// #region Controls
/** Microphone — the idle right-side control (start a voice memo). */
export const MicIcon = (
	<Svg>
		<rect x="9" y="3" width="6" height="11" rx="3" />
		<path d="M5 11a7 7 0 0 0 14 0" />
		<path d="M12 18v3" />
	</Svg>
);

/** Paper plane — send the draft. */
export const SendIcon = (
	<Svg>
		<path d="M5 12 20 5l-4 15-4.5-5.5z" />
		<path d="M11.5 14.5 20 5" />
	</Svg>
);

/** Rounded square — stop the active recording. */
export const StopIcon = (
	<Svg fill="currentColor" stroke="none">
		<rect x="6" y="6" width="12" height="12" rx="3" />
	</Svg>
);
// #endregion

// #region Plus-menu leading icons
/** Tray with an up-arrow — "Upload from Device". */
export const UploadIcon = (
	<Svg>
		<path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
		<path d="M12 15V4M8 8l4-4 4 4" />
	</Svg>
);

/** Stacked media — "Attach from Library". */
export const LibraryIcon = (
	<Svg>
		<rect x="7" y="3" width="14" height="14" rx="2.2" />
		<path d="M17 20.5H5a1.5 1.5 0 0 1-1.5-1.5V7" />
		<circle cx="11" cy="8" r="1.6" />
		<path d="m8 15 3-2.5 4 3 2-1.5" />
	</Svg>
);
// #endregion

// #region File-type marks (attachment cards, non-media)
function FileFrame(props: { children: JSX.Element | JSX.Element[] }): JSX.Element {
	return (
		<Svg>
			<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
			<path d="M14 3v4h4" />
			{props.children}
		</Svg>
	);
}

const FILE_PDF = (
	<FileFrame>
		<path d="M9 13h1.4a1.3 1.3 0 0 1 0 2.6H9zM9 13v4M14.5 13H13v4M13 15.2h1.2" />
	</FileFrame>
);
const FILE_DOC = (
	<FileFrame>
		<path d="M8.5 12.5 10 17l1.5-3 1.5 3 1.5-4.5" />
	</FileFrame>
);
const FILE_SHEET = (
	<FileFrame>
		<path d="M9 12v5M12 12v5M9 14.5h3M9 12h3" />
	</FileFrame>
);
const FILE_ARCHIVE = (
	<FileFrame>
		<path d="M11 3v2M11 6v2M11 9v2M11 12h1.6l-.3 3.4a1.3 1.3 0 0 1-2.6 0z" />
	</FileFrame>
);
const FILE_GENERIC = (
	<FileFrame>
		<path d="M9 13h6M9 16h4" />
	</FileFrame>
);

/** The glyph for a non-media attachment, chosen from its extension. */
export function FileTypeGlyph({ ext }: { ext: string }): JSX.Element {
	switch (ext) {
		case "pdf":
			return FILE_PDF;
		case "doc":
		case "docx":
		case "rtf":
		case "txt":
		case "md":
			return FILE_DOC;
		case "xls":
		case "xlsx":
		case "csv":
		case "tsv":
			return FILE_SHEET;
		case "zip":
		case "rar":
		case "7z":
		case "gz":
		case "tar":
			return FILE_ARCHIVE;
		default:
			return FILE_GENERIC;
	}
}
// #endregion
