import { fileFamily, type FileFamilySource } from "./families.ts";

/**
 * files.software — the application a person recognises a file by (Decision #397). A family says what
 * a file is and the software says what opens it: a `.psd` stays an `image` to everything that asks
 * for its family, and only its tile is Photoshop's. These formats reach us as
 * `application/octet-stream` almost without exception, so the extension is the only evidence there is.
 */

// #region Software

/** The extensions each application owns. An extension belongs to one application. */
const EXTENSIONS = {
	photoshop: "psd psb",
	illustrator: "ai ait",
	premiere: "prproj",
	aftereffects: "aep aet",
	indesign: "indd indt",
	lightroom: "lrcat",
	figma: "fig jam",
	sketch: "sketch",
	blender: "blend blend1",
	maya: "mb ma",
	max: "max",
	autocad: "dwg dxf",
	cinema4d: "c4d",
	zbrush: "zpr ztl",
	unity: "unity prefab asset",
	unreal: "uproject uasset",
	resolve: "drp",
	ableton: "als",
	protools: "ptx",
} as const;

/** The applications a file tile can name. */
export type FileSoftware = keyof typeof EXTENSIONS;

const BY_EXTENSION: ReadonlyMap<string, FileSoftware> = new Map(
	(Object.entries(EXTENSIONS) as [FileSoftware, string][]).flatMap(([software, list]) =>
		list.split(" ").map((ext): [string, FileSoftware] => [ext, software])
	),
);

/** The application a file belongs to, or null. A link is a link, whatever its address ends in. */
export function fileSoftware(file: FileFamilySource): FileSoftware | null {
	if (fileFamily(file) === "link") return null;
	return BY_EXTENSION.get(file.ext.trim().toLowerCase()) ?? null;
}

// #endregion
