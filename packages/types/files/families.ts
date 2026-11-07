import type { FileCategory } from "./categories.ts";
import { CODE_LANGUAGES } from "./inspect.ts";
import type { FileKind } from "./kinds.ts";

/**
 * files.families — the type a person recognises a file by: the colour and tile on its card, in its
 * list row and in the inspector (Decision #396). {@link FileKind} says which renderer draws a file and
 * {@link FileCategory} is the search taxonomy; neither lines up with how people sort files by eye. A
 * `.csv` is `Data` and a `.pdf` a `Document` to the taxonomy, and both of those read wrong on a card,
 * so the family is decided by extension first and only then falls back to the row's own category.
 */

// #region Family

/** The families a file is coloured by. `other` is the neutral tile: no colour claims a file it can't. */
export type FileFamily =
	| "spreadsheet"
	| "document"
	| "presentation"
	| "pdf"
	| "image"
	| "video"
	| "audio"
	| "code"
	| "model"
	| "archive"
	| "link"
	| "other";

/** Code is not listed: every language the inspector highlights ({@link CODE_LANGUAGES}) is code. */
const EXTENSIONS: Readonly<Record<Exclude<FileFamily, "code" | "link" | "other">, string>> = {
	spreadsheet: "xlsx xlsm xltx xlsb xls ods numbers csv tsv tab",
	document: "docx doc dotx odt rtf txt text md markdown mdown mkd mdx pages tex rst adoc",
	presentation: "pptx pptm ppsx potx ppt pps odp key",
	pdf: "pdf",
	image:
		"png jpg jpeg jfif webp svg svgz hdr exr gif avif bmp ico heic heif tif tiff psd ai eps tga dds",
	video: "mp4 m4v webm mov mkv avi ogv wmv mpg mpeg",
	audio: "mp3 wav wave ogg oga opus m4a aac flac weba aiff",
	model: "obj stl gltf glb fbx ply dae 3mf usdz usd blend",
	archive: "zip tar gz tgz bz2 xz 7z rar",
};

const BY_EXTENSION: ReadonlyMap<string, FileFamily> = new Map(
	(Object.entries(EXTENSIONS) as [FileFamily, string][]).flatMap(([family, list]) =>
		list.split(" ").map((ext): [string, FileFamily] => [ext, family])
	),
);

const BY_CATEGORY: Readonly<Partial<Record<FileCategory, FileFamily>>> = {
	Document: "document",
	Ebook: "document",
	Presentation: "presentation",
	Spreadsheet: "spreadsheet",
	Audio: "audio",
	Video: "video",
	Image: "image",
	Vector: "image",
	Compression: "archive",
	ContainerImage: "archive",
	Code: "code",
	Config: "code",
	"3D": "model",
};

const BY_KIND: Readonly<Partial<Record<FileKind, FileFamily>>> = {
	image: "image",
	video: "video",
	audio: "audio",
	pdf: "pdf",
	doc: "document",
	code: "code",
	archive: "archive",
	link: "link",
};

/** The slice of a row {@link fileFamily} reads; every field is one a row always carries. */
export interface FileFamilySource {
	ext: string;
	source?: string;
	kind?: FileKind;
	category?: FileCategory;
}

/** The family a file belongs to: a link is always a link, then its extension, category and kind. */
export function fileFamily(file: FileFamilySource): FileFamily {
	if (file.source === "link" || file.kind === "link") return "link";
	const ext = file.ext.trim().toLowerCase();
	const known = BY_EXTENSION.get(ext) ?? (CODE_LANGUAGES[ext] ? "code" : undefined);
	if (known) return known;
	return (file.category && BY_CATEGORY[file.category]) ??
		(file.kind && BY_KIND[file.kind]) ?? "other";
}

// #endregion
