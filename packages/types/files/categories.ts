import { z } from "zod";
import type { FileKind } from "../projects/files.ts";

/**
 * files.categories — the Zod SSOT for classifying an uploaded file into a rich, searchable category.
 *
 * This is the *taxonomy* layer that sits above the File Explorer's coarse {@link FileKind} (the 8
 * rendering buckets that pick a glyph + inline preview renderer). Where `FileKind` answers "how do I
 * draw / preview this?", `FileCategory` answers "what KIND of thing is this?" for search, filtering,
 * faceting, analytics, and metadata — and every category maps to exactly one `FileKind` via
 * {@link CATEGORY_META}, so the two never fork.
 *
 * Isomorphic + pure: {@link categorizeFile} / {@link describeFile} take a filename + optional MIME
 * string (never a DOM `File`), so the fat backend can classify authoritatively on upload (the
 * server-of-record for search/analytics) and an island can classify the same way for instant UI.
 * Store the result on the file row — `category` for faceting, `application` in metadata for the
 * human-readable source app ("Adobe Photoshop Document"), `kind` for rendering.
 *
 * Classification order: **extension first** (the strongest signal), then exact MIME, then a MIME
 * top-level fallback (`image/*`, `video/*`, `audio/*`, `text/*`, `font/*`, `model/*`), else `Other`.
 * When one extension appears under several categories, the FIRST category in enum order wins
 * (deterministic; see the tie notes at the bottom).
 *
 * Only enum/primitive Zod is used so the module is stable across Zod majors (matching
 * `files/storage.ts`, `explore/items.ts`).
 */

// #region Taxonomy

/** The rich file category. `Other` is the catch-all when nothing matches. */
export const FileCategory = z.enum([
	"Document",
	"Presentation",
	"Spreadsheet",
	"Audio",
	"Video",
	"Image",
	"Vector",
	"Medical",
	"Scientific",
	"Compression",
	"Executable",
	"Code",
	"3D",
	"Database",
	"Data",
	"Font",
	"Security",
	"System",
	"Email",
	"DiskImage",
	"VMImage",
	"ContainerImage",
	"CAD",
	"GIS",
	"Ebook",
	"Config",
	"Package",
	"Other",
]);
export type FileCategory = z.infer<typeof FileCategory>;

/** One extension definition: the bare extension, an optional source application, optional MIMEs. */
export interface FileDefinition {
	extension: string;
	application?: string;
	validMimeTypes?: string[];
}

/**
 * Per-category display + routing metadata.
 * - `label` — human-facing category name (facet labels, tooltips).
 * - `kind`  — the coarse {@link FileKind} this category renders as (glyph + preview renderer).
 * - `icon`  — a semantic icon slug. Today the UI resolves it via `kind` to the existing 8-glyph set;
 *   when a per-file-type icon pack lands (e.g. VSCode Material Icons), map that pack to this slug (or
 *   to the raw extension) without touching call sites.
 */
export interface CategoryMeta {
	label: string;
	kind: FileKind;
	icon: string;
}

/** The authoritative category → (label, kind, icon) map. Every `FileCategory` has an entry. */
export const CATEGORY_META: Readonly<Record<FileCategory, CategoryMeta>> = {
	Document: { label: "Document", kind: "doc", icon: "document" },
	Presentation: { label: "Presentation", kind: "doc", icon: "presentation" },
	Spreadsheet: { label: "Spreadsheet", kind: "doc", icon: "spreadsheet" },
	Audio: { label: "Audio", kind: "audio", icon: "audio" },
	Video: { label: "Video", kind: "video", icon: "video" },
	Image: { label: "Image", kind: "image", icon: "image" },
	Vector: { label: "Vector", kind: "image", icon: "vector" },
	Medical: { label: "Medical imaging", kind: "file", icon: "medical" },
	Scientific: { label: "Scientific", kind: "file", icon: "scientific" },
	Compression: { label: "Archive", kind: "archive", icon: "archive" },
	Executable: { label: "Executable", kind: "file", icon: "executable" },
	Code: { label: "Code", kind: "code", icon: "code" },
	"3D": { label: "3D model", kind: "file", icon: "cube" },
	Database: { label: "Database", kind: "file", icon: "database" },
	Data: { label: "Data", kind: "file", icon: "data" },
	Font: { label: "Font", kind: "file", icon: "font" },
	Security: { label: "Security / keys", kind: "file", icon: "shield" },
	System: { label: "System", kind: "file", icon: "system" },
	Email: { label: "Email / contact", kind: "file", icon: "email" },
	DiskImage: { label: "Disk image", kind: "file", icon: "disk" },
	VMImage: { label: "VM image", kind: "file", icon: "vm" },
	ContainerImage: { label: "Container image", kind: "archive", icon: "container" },
	CAD: { label: "CAD", kind: "file", icon: "cad" },
	GIS: { label: "Geospatial", kind: "file", icon: "map" },
	Ebook: { label: "eBook", kind: "doc", icon: "book" },
	Config: { label: "Config", kind: "code", icon: "config" },
	Package: { label: "Package", kind: "archive", icon: "package" },
	Other: { label: "Other", kind: "file", icon: "file" },
};

/** The extension-map shape: every category EXCEPT the `Other` catch-all owns a definition list. */
export type ExtensionMap = Record<Exclude<FileCategory, "Other">, FileDefinition[]>;

// #endregion

// #region Extension → category data (the curated taxonomy)

export const EXTENSION_CATEGORIES: Readonly<ExtensionMap> = {
	Document: [
		{ extension: "doc", application: "Microsoft Word", validMimeTypes: ["application/msword"] },
		{
			extension: "docx",
			application: "Microsoft Word",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
		},

		{
			extension: "docm",
			application: "Microsoft Word Macro-Enabled Document",
			validMimeTypes: ["application/vnd.ms-word.document.macroEnabled.12"],
		},
		{
			extension: "dot",
			application: "Microsoft Word Template",
			validMimeTypes: ["application/msword"],
		},
		{
			extension: "dotx",
			application: "Microsoft Word Template",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.template"],
		},

		{
			extension: "dotm",
			application: "Microsoft Word Macro-Enabled Template",
			validMimeTypes: ["application/vnd.ms-word.template.macroEnabled.12"],
		},
		{ extension: "pdf", application: "Adobe Acrobat", validMimeTypes: ["application/pdf"] },
		{ extension: "txt", application: "Plain Text", validMimeTypes: ["text/plain"] },
		{ extension: "rtf", application: "Rich Text Format", validMimeTypes: ["application/rtf"] },
		{
			extension: "odt",
			application: "OpenDocument Text",
			validMimeTypes: ["application/vnd.oasis.opendocument.text"],
		},
		{
			extension: "fodt",
			application: "Flat OpenDocument Text",
			validMimeTypes: ["application/vnd.oasis.opendocument.text-flat-xml"],
		},
		{
			extension: "wpd",
			application: "WordPerfect Document",
			validMimeTypes: ["application/wordperfect"],
		},
		{
			extension: "wps",
			application: "Microsoft Works Document",
			validMimeTypes: ["application/vnd.ms-works"],
		},
		{ extension: "abw", application: "AbiWord Document" },
		{ extension: "md", application: "Markdown", validMimeTypes: ["text/markdown"] },
		{ extension: "rst", application: "reStructuredText", validMimeTypes: ["text/x-rst"] },
		{ extension: "adoc", application: "AsciiDoc" },
		{ extension: "tex", application: "LaTeX Document" },
		{ extension: "ltx", application: "LaTeX Source File" },
		{ extension: "bib", application: "BibTeX Bibliography File" },

		{ extension: "sty", application: "LaTeX Style File" },
		{ extension: "cls", application: "LaTeX Class File" },

		{ extension: "epub", application: "EPUB eBook", validMimeTypes: ["application/epub+zip"] },
		{ extension: "mobi", application: "Mobipocket eBook" },
		{ extension: "azw", application: "Amazon Kindle eBook" },
		{ extension: "azw3", application: "Amazon Kindle eBook" },
		{ extension: "fb2", application: "FictionBook eBook" },

		{
			extension: "cbr",
			application: "Comic Book RAR Archive",
			validMimeTypes: ["application/vnd.comicbook-rar"],
		},
		{
			extension: "cbz",
			application: "Comic Book ZIP Archive",
			validMimeTypes: ["application/vnd.comicbook+zip"],
		},

		{ extension: "cb7", application: "Comic Book 7-Zip Archive" },

		{ extension: "gov", application: "Government Document" },
		{ extension: "legx", application: "Legal XML Format" },
		{ extension: "xfdl", application: "Extensible Forms Description Language" },
		{ extension: "djvu", application: "DjVu Scanned Document", validMimeTypes: ["image/vnd.djvu"] },
		{
			extension: "xps",
			application: "Microsoft XPS Document",
			validMimeTypes: ["application/vnd.ms-xpsdocument"],
		},
		{ extension: "oxps", application: "OpenXPS Document", validMimeTypes: ["application/oxps"] },
		{
			extension: "one",
			application: "Microsoft OneNote",
			validMimeTypes: ["application/msonenote"],
		},
		{ extension: "note", application: "Evernote Note File" },
		{ extension: "jnt", application: "Windows Journal Note" },
		{ extension: "gdoc", application: "Google Docs File" },
		{ extension: "pages", application: "Apple Pages Document" },
		{ extension: "indd", application: "Adobe InDesign Document" },
		{ extension: "indt", application: "Adobe InDesign Template" },
		{ extension: "pmd", application: "Adobe PageMaker Document" },
		{ extension: "pub", application: "Microsoft Publisher Document" },
		{ extension: "sla", application: "Scribus Document" },
		{ extension: "mml", application: "Mathematical Markup Language" },

		{ extension: "url", application: "Internet Shortcut" },
		{ extension: "webloc", application: "Mac Web Shortcut" },
		{ extension: "desktop", application: "Linux Desktop Shortcut" },
		{ extension: "nfo", application: "Information File" },
		{ extension: "readme", application: "ReadMe File" },
		{ extension: "ami", application: "Amiga AmigaGuide" },
		{ extension: "wp", application: "WordPerfect" },
		{ extension: "602", application: "T602 Text Document" },
		{ extension: "p7s", application: "Secure Signed Email File" },
		{ extension: "fax", application: "Fax Image Format" },
	],

	Spreadsheet: [
		{
			extension: "xls",
			application: "Microsoft Excel",
			validMimeTypes: ["application/vnd.ms-excel"],
		},
		{
			extension: "xlsx",
			application: "Microsoft Excel",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
		},
		{
			extension: "xlsm",
			application: "Microsoft Excel Macro-Enabled",
			validMimeTypes: ["application/vnd.ms-excel.sheet.macroEnabled.12"],
		},
		{
			extension: "xlsb",
			application: "Microsoft Excel Binary Workbook",
			validMimeTypes: ["application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
		},
		{
			extension: "xlt",
			application: "Microsoft Excel Template",
			validMimeTypes: ["application/vnd.ms-excel"],
		},
		{
			extension: "xltx",
			application: "Microsoft Excel Template",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.template"],
		},
		{
			extension: "ods",
			application: "OpenDocument Spreadsheet",
			validMimeTypes: ["application/vnd.oasis.opendocument.spreadsheet"],
		},
		{
			extension: "ots",
			application: "OpenDocument Spreadsheet Template",
			validMimeTypes: ["application/vnd.oasis.opendocument.spreadsheet-template"],
		},
		{
			extension: "fods",
			application: "Flat OpenDocument Spreadsheet",
			validMimeTypes: ["application/vnd.oasis.opendocument.spreadsheet-flat-xml"],
		},
		{
			extension: "dif",
			application: "Data Interchange Format",
			validMimeTypes: ["application/x-dif"],
		},
		{
			extension: "slk",
			application: "Symbolic Link Format",
			validMimeTypes: ["application/vnd.ms-excel"],
		},
		{ extension: "qbw", application: "QuickBooks Company File" },
		{ extension: "qbb", application: "QuickBooks Backup File" },
		{ extension: "qbm", application: "QuickBooks Portable File" },
		{ extension: "gnumeric", application: "Gnumeric Spreadsheet" },
		{ extension: "numbers", application: "Apple Numbers Spreadsheet" },
		{ extension: "gsheet", application: "Google Sheets File" },
		{ extension: "et", application: "WPS Office Excel File" },
		{ extension: "wks", application: "Lotus 1-2-3 Worksheet" },
		{ extension: "123", application: "Lotus 1-2-3 Spreadsheet" },
		{ extension: "sas7bdat", application: "SAS Dataset" },
		{ extension: "wk1", application: "Lotus Worksheet" },
		{ extension: "wk3", application: "Lotus 1-2-3 Worksheet" },
		{ extension: "wk4", application: "Lotus 1-2-3 Worksheet" },
		{ extension: "wq1", application: "Quattro Pro Spreadsheet" },
		{ extension: "wq2", application: "Quattro Pro Spreadsheet" },
		{ extension: "qpw", application: "Quattro Pro Workbook" },
		{ extension: "vc", application: "VisiCalc Spreadsheet" },
		{ extension: "vcs", application: "VisiCalc Spreadsheet" },
	],

	Presentation: [
		{ extension: "key", application: "Apple Keynote Presentation" },
		{
			extension: "ppt",
			application: "Microsoft PowerPoint",
			validMimeTypes: ["application/vnd.ms-powerpoint"],
		},
		{
			extension: "pptx",
			application: "Microsoft PowerPoint",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
		},

		{
			extension: "pptm",
			application: "Microsoft PowerPoint Macro-Enabled Presentation",
			validMimeTypes: ["application/vnd.ms-powerpoint.presentation.macroEnabled.12"],
		},

		{
			extension: "potx",
			application: "Microsoft PowerPoint Template",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.template"],
		},
		{
			extension: "potm",
			application: "Microsoft PowerPoint Macro-Enabled Template",
			validMimeTypes: ["application/vnd.ms-powerpoint.template.macroEnabled.12"],
		},

		{
			extension: "pps",
			application: "Microsoft PowerPoint Slideshow",
			validMimeTypes: ["application/vnd.ms-powerpoint"],
		},
		{
			extension: "ppsx",
			application: "Microsoft PowerPoint Slideshow",
			validMimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
		},
		{
			extension: "ppsm",
			application: "Microsoft PowerPoint Macro-Enabled Slideshow",
			validMimeTypes: ["application/vnd.ms-powerpoint.slideshow.macroEnabled.12"],
		},
		{
			extension: "odp",
			application: "OpenDocument Presentation",
			validMimeTypes: ["application/vnd.oasis.opendocument.presentation"],
		},

		{
			extension: "otp",
			application: "OpenDocument Presentation Template",
			validMimeTypes: ["application/vnd.oasis.opendocument.presentation-template"],
		},
	],

	Audio: [
		{ extension: "mp3", application: "MPEG Audio Layer III", validMimeTypes: ["audio/mpeg"] },
		{ extension: "ogg", application: "OGG Vorbis Audio", validMimeTypes: ["audio/ogg"] },
		{ extension: "oga", application: "OGG Audio", validMimeTypes: ["audio/ogg"] },
		{ extension: "opus", application: "Opus Audio", validMimeTypes: ["audio/opus"] },
		{ extension: "aac", application: "Advanced Audio Codec (AAC)", validMimeTypes: ["audio/aac"] },
		{ extension: "m4a", application: "MPEG-4 Audio", validMimeTypes: ["audio/mp4"] },
		{ extension: "m4b", application: "MPEG-4 Audiobook", validMimeTypes: ["audio/mp4"] },
		{ extension: "m4p", application: "MPEG-4 Protected Audio", validMimeTypes: ["audio/mp4"] },
		{
			extension: "wav",
			application: "Waveform Audio Format",
			validMimeTypes: ["audio/wav", "audio/x-wav"],
		},
		{ extension: "flac", application: "Free Lossless Audio Codec", validMimeTypes: ["audio/flac"] },
		{ extension: "alac", application: "Apple Lossless Audio Codec" },
		{ extension: "wma", application: "Windows Media Audio", validMimeTypes: ["audio/x-ms-wma"] },
		{ extension: "amr", application: "Adaptive Multi-Rate Audio", validMimeTypes: ["audio/amr"] },
		{ extension: "awb", application: "Adaptive Multi-Rate Wideband Audio" },
		{ extension: "ape", application: "Monkey's Audio" },
		{ extension: "wv", application: "WavPack Audio" },
		{ extension: "tta", application: "True Audio" },
		{ extension: "dsf", application: "DSD Stream File" },
		{ extension: "dff", application: "DSD Interchange File" },
		{ extension: "mid", application: "MIDI Sequence", validMimeTypes: ["audio/midi"] },
		{ extension: "midi", application: "MIDI Sequence", validMimeTypes: ["audio/midi"] },
		{ extension: "kar", application: "Karaoke MIDI" },
		{ extension: "sf2", application: "SoundFont 2" },
		{ extension: "sfz", application: "SFZ Instrument File" },
		{ extension: "flp", application: "FL Studio Project File" },
		{ extension: "als", application: "Ableton Live Set" },
		{ extension: "alc", application: "Ableton Live Clip" },
		{ extension: "cpr", application: "Cubase Project File" },
		{ extension: "npr", application: "Nuendo Project File" },
		{ extension: "sesx", application: "Adobe Audition Session File" },
		{ extension: "omf", application: "Open Media Framework File" },
		{ extension: "ptx", application: "Pro Tools Session" },
		{ extension: "ptf", application: "Pro Tools 7-9 Session" },
		{ extension: "dss", application: "Digital Speech Standard" },
		{ extension: "ds2", application: "Digital Speech Standard 2" },
		{ extension: "vox", application: "Dialogic ADPCM Audio" },
		{ extension: "ra", application: "RealAudio" },
		{ extension: "m3u", application: "MP3 Playlist File", validMimeTypes: ["audio/x-mpegurl"] },
		{
			extension: "m3u8",
			application: "M3U Extended Playlist",
			validMimeTypes: ["application/vnd.apple.mpegurl", "audio/m3u8"],
		},
		{ extension: "pls", application: "Playlist File" },
		{ extension: "asx", application: "Advanced Stream Redirector" },
		{ extension: "xspf", application: "XML Shareable Playlist Format" },
		{ extension: "bwf", application: "Broadcast Wave Format" },
		{
			extension: "aiff",
			application: "Audio Interchange File Format",
			validMimeTypes: ["audio/aiff"],
		},
		{
			extension: "aif",
			application: "Audio Interchange File Format",
			validMimeTypes: ["audio/x-aiff"],
		},
		{ extension: "aifc", application: "Compressed AIFF Audio" },
		{ extension: "caf", application: "Apple Core Audio Format" },
		{ extension: "mp2", application: "MPEG Audio Layer II" },
		{ extension: "spx", application: "Speex Audio Format" },
		{ extension: "au", application: "Sun Microsystems Audio" },
		{ extension: "snd", application: "Sound File Format" },
		{ extension: "vgm", application: "Video Game Music File" },
		{ extension: "spc", application: "SNES Sound File" },
		{ extension: "gbs", application: "Game Boy Sound File" },
		{ extension: "2sf", application: "Nintendo DS Sound File" },
		{ extension: "ssf", application: "Sega Saturn Sound File" },
		{ extension: "usf", application: "Nintendo 64 Sound Format" },
		{ extension: "cda", application: "CD Audio Track" },
		{ extension: "voc", application: "Creative Voice File" },
		{ extension: "sid", application: "Commodore 64 SID Music" },
		{ extension: "mod", application: "Tracker Module Format" },
		{ extension: "xm", application: "FastTracker 2 Extended Module" },
		{ extension: "it", application: "Impulse Tracker Module" },
		{ extension: "s3m", application: "Scream Tracker Module" },

		{ extension: "aax", application: "Audible Enhanced Audiobook" },
		{ extension: "ac3", application: "Dolby Digital Audio" },
		{ extension: "dts", application: "DTS Audio" },
		{ extension: "mka", application: "Matroska Audio" },
	],

	Video: [
		{ extension: "mp4", application: "MPEG-4 Video", validMimeTypes: ["video/mp4"] },
		{ extension: "m4v", application: "MPEG-4 Video", validMimeTypes: ["video/x-m4v"] },
		{ extension: "mov", application: "QuickTime Video", validMimeTypes: ["video/quicktime"] },
		{ extension: "avi", application: "AVI Video", validMimeTypes: ["video/x-msvideo"] },
		{ extension: "wmv", application: "Windows Media Video", validMimeTypes: ["video/x-ms-wmv"] },
		{
			extension: "asf",
			application: "Advanced Systems Format",
			validMimeTypes: ["video/x-ms-asf"],
		},
		{ extension: "mkv", application: "Matroska Video", validMimeTypes: ["video/x-matroska"] },
		{ extension: "webm", application: "WebM Video", validMimeTypes: ["video/webm"] },
		{ extension: "flv", application: "Flash Video", validMimeTypes: ["video/x-flv"] },
		{ extension: "f4v", application: "Adobe Flash MP4", validMimeTypes: ["video/x-f4v"] },
		{ extension: "3gp", application: "3GPP Video", validMimeTypes: ["video/3gpp"] },
		{ extension: "3g2", application: "3GPP2 Video", validMimeTypes: ["video/3gpp2"] },
		{ extension: "ogv", application: "OGG Video", validMimeTypes: ["video/ogg"] },
		{ extension: "mts", application: "MPEG Transport Stream" },
		{ extension: "m2ts", application: "Blu-ray MPEG-2 Transport Stream" },
		{ extension: "vob", application: "DVD Video Object", validMimeTypes: ["video/dvd"] },
		{ extension: "ifo", application: "DVD Information File" },
		{ extension: "bup", application: "DVD Backup File" },
		{ extension: "mxf", application: "Material Exchange Format" },
		{ extension: "gxf", application: "General eXchange Format" },
		{
			extension: "rm",
			application: "RealMedia Video",
			validMimeTypes: ["application/vnd.rn-realmedia"],
		},
		{ extension: "rmvb", application: "RealMedia Variable Bitrate" },
		{ extension: "divx", application: "DivX Video Format" },
		{ extension: "xvid", application: "XviD Encoded Video" },
		{ extension: "dvr-ms", application: "Windows Media Center Recorded TV Show" },
		{ extension: "amv", application: "Anime Music Video Format" },
		{ extension: "yuv", application: "YUV Encoded Video" },
		{ extension: "vp8", application: "VP8 Encoded Video" },
		{ extension: "vp9", application: "VP9 Encoded Video" },
		{ extension: "hevc", application: "High Efficiency Video Codec (H.265)" },
		{ extension: "h264", application: "Advanced Video Codec (H.264)" },
		{ extension: "h265", application: "High Efficiency Video Codec (H.265)" },
		{ extension: "av1", application: "AOMedia Video 1 (AV1)" },
		{ extension: "prores", application: "Apple ProRes" },
		{ extension: "cineform", application: "GoPro CineForm Codec" },
		{ extension: "dnxhd", application: "Avid DNxHD Codec" },
		{ extension: "braw", application: "Blackmagic RAW Video" },
		{ extension: "ser", application: "SER Astronomy Video Format" },
		{ extension: "mjpg", application: "Motion JPEG Video" },
		{ extension: "mj2", application: "Motion JPEG 2000" },
		{ extension: "ivf", application: "Indeo Video Format" },
		{ extension: "ivr", application: "Internet Video Recording" },
		{ extension: "vrvideo", application: "Virtual Reality Video" },
		{ extension: "tiffseq", application: "TIFF Image Sequence" },
		{ extension: "dpx", application: "Digital Picture Exchange (DPX)" },
		{ extension: "cin", application: "Cineon Image File" },
		{ extension: "fli", application: "Autodesk FLI Animation" },
		{ extension: "flc", application: "Autodesk FLC Animation" },
		{ extension: "mve", application: "Interplay MVE Video" },
		{ extension: "rpl", application: "Replay Video Format" },
		{ extension: "smk", application: "Smacker Video" },

		{ extension: "mpeg", application: "MPEG Video" },
		{ extension: "mpg", application: "MPEG Video" },
		{ extension: "mpe", application: "MPEG Video" },
		{ extension: "ts", application: "MPEG Transport Stream" },
		{ extension: "m2v", application: "MPEG-2 Video" },

		{ extension: "srt", application: "SubRip Subtitle", validMimeTypes: ["application/x-subrip"] },
		{ extension: "vtt", application: "Web Video Text Tracks", validMimeTypes: ["text/vtt"] },
		{ extension: "sub", application: "MicroDVD Subtitle" },
		{ extension: "sbv", application: "YouTube Subtitle" },
		{ extension: "ass", application: "Advanced Substation Alpha" },
		{ extension: "ssa", application: "Substation Alpha" },
	],

	Image: [
		{ extension: "jpg", application: "JPEG Image", validMimeTypes: ["image/jpeg"] },
		{ extension: "jpeg", application: "JPEG Image", validMimeTypes: ["image/jpeg"] },
		{ extension: "png", application: "PNG Image", validMimeTypes: ["image/png"] },
		{ extension: "gif", application: "GIF Image", validMimeTypes: ["image/gif"] },
		{ extension: "bmp", application: "Bitmap Image", validMimeTypes: ["image/bmp"] },
		{ extension: "webp", application: "WebP Image", validMimeTypes: ["image/webp"] },
		{ extension: "apng", application: "Animated PNG", validMimeTypes: ["image/apng"] },
		{ extension: "ico", application: "Icon File", validMimeTypes: ["image/vnd.microsoft.icon"] },
		{ extension: "tiff", application: "TIFF Image", validMimeTypes: ["image/tiff"] },
		{ extension: "tif", application: "TIFF Image", validMimeTypes: ["image/tiff"] },
		{
			extension: "heif",
			application: "High Efficiency Image Format",
			validMimeTypes: ["image/heif"],
		},
		{
			extension: "heic",
			application: "High Efficiency Image Codec",
			validMimeTypes: ["image/heic"],
		},
		{ extension: "jp2", application: "JPEG 2000", validMimeTypes: ["image/jp2"] },
		{ extension: "j2k", application: "JPEG 2000", validMimeTypes: ["image/jp2"] },
		{ extension: "exr", application: "OpenEXR", validMimeTypes: ["image/x-exr"] },
		{ extension: "hdr", application: "Radiance HDR", validMimeTypes: ["image/vnd.radiance"] },
		{
			extension: "psd",
			application: "Adobe Photoshop Document",
			validMimeTypes: ["image/vnd.adobe.photoshop"],
		},
		{ extension: "xcf", application: "GIMP Image Format" },
		{ extension: "dds", application: "DirectDraw Surface", validMimeTypes: ["image/vnd.ms-dds"] },
		{ extension: "pcx", application: "ZSoft PCX", validMimeTypes: ["image/x-pcx"] },
		{ extension: "iff", application: "Amiga Interchange File Format" },
		{ extension: "tga", application: "Truevision TGA", validMimeTypes: ["image/x-targa"] },
		{ extension: "icns", application: "Apple Icon Image" },
		{ extension: "procreate", application: "Procreate Image" },
		{ extension: "raw", application: "General RAW Image Format" },
		{ extension: "cr2", application: "Canon RAW Image" },
		{ extension: "cr3", application: "Canon RAW Image" },
		{ extension: "nef", application: "Nikon RAW Image" },
		{ extension: "nrw", application: "Nikon RAW Image" },
		{ extension: "arw", application: "Sony RAW Image" },
		{ extension: "srf", application: "Sony RAW Image" },
		{ extension: "sr2", application: "Sony RAW Image" },
		{ extension: "orf", application: "Olympus RAW Image" },
		{ extension: "rw2", application: "Panasonic RAW Image" },
		{ extension: "raf", application: "Fuji RAW Image" },
		{ extension: "dng", application: "Adobe Digital Negative" },
		{ extension: "pef", application: "Pentax RAW Image" },
		{ extension: "bay", application: "Casio RAW Image" },
		{ extension: "rwl", application: "Leica RAW Image" },
		{ extension: "ktx", application: "Khronos Texture Format" },
		{ extension: "pvr", application: "PowerVR Texture Compression" },
		{ extension: "txd", application: "RenderWare Texture Dictionary" },
		{ extension: "vtf", application: "Valve Texture Format" },
		{ extension: "anm", application: "Animation Frame Sequence" },
		{ extension: "flif", application: "Free Lossless Image Format" },
		{ extension: "jp3", application: "JPEG 3000 Legacy Format" },
		{ extension: "jbig", application: "JBIG Image Format" },
		{ extension: "jbig2", application: "JBIG2 Image Format" },
		{ extension: "xpm", application: "X PixMap Format" },
		{ extension: "sun", application: "Sun Raster Image" },
		{ extension: "sgi", application: "Silicon Graphics Image" },
		{ extension: "ras", application: "Sun Raster Image" },
		{ extension: "pgm", application: "Portable GrayMap" },
		{ extension: "pbm", application: "Portable Bitmap" },
		{ extension: "ppm", application: "Portable PixMap" },
		{ extension: "xbm", application: "X Bitmap Image" },
		{ extension: "mng", application: "Multiple-image Network Graphics" },
		{ extension: "jps", application: "JPEG Stereo Image" },
		{ extension: "mpo", application: "Multi-Picture Object" },
		{ extension: "dcx", application: "Multi-Page PCX" },
		{ extension: "otb", application: "Nokia Over The Air Bitmap" },
		{ extension: "pgf", application: "Progressive Graphics Format" },
	],

	Vector: [
		{
			extension: "svg",
			application: "Scalable Vector Graphics",
			validMimeTypes: ["image/svg+xml"],
		},
		{
			extension: "eps",
			application: "Encapsulated PostScript",
			validMimeTypes: ["application/postscript"],
		},
		{
			extension: "ai",
			application: "Adobe Illustrator File",
			validMimeTypes: ["application/postscript"],
		},
		{ extension: "cdr", application: "CorelDRAW File" },
		{ extension: "emf", application: "Enhanced Metafile" },
		{ extension: "wmf", application: "Windows Metafile" },
		{ extension: "sketch", application: "Sketch Design File" },
		{ extension: "fig", application: "Figma Design File" },
		{ extension: "xd", application: "Adobe XD File" },
		{ extension: "cgm", application: "Computer Graphics Metafile" },
		{ extension: "fxg", application: "Flash XML Graphics File" },
		{ extension: "pict", application: "Apple PICT File" },
		{ extension: "swf", application: "Shockwave Flash Vector File" },
		{ extension: "xar", application: "Xara Vector File" },

		{ extension: "shp", application: "ESRI Shapefile" },
		{ extension: "shx", application: "ESRI Shapefile Index" },
		{ extension: "dbf", application: "Shapefile Database Format" },
		{ extension: "geojson", application: "Geospatial JSON File" },
		{ extension: "topojson", application: "Topological JSON File" },
		{ extension: "gpx", application: "GPS Exchange Format" },
		{ extension: "kml", application: "Keyhole Markup Language" },
		{ extension: "kmz", application: "Compressed KML File" },
		{ extension: "gml", application: "Geography Markup Language" },
		{ extension: "dgn", application: "MicroStation Design File" },
	],

	Medical: [
		{ extension: "dcm", application: "DICOM Medical Image", validMimeTypes: ["application/dicom"] },
		{ extension: "nii", application: "NIfTI Neuroimaging Format" },
		{ extension: "mha", application: "MetaImage Format" },
		{ extension: "mhd", application: "MetaImage Format Header" },
	],

	Scientific: [
		{ extension: "fits", application: "Flexible Image Transport System (FITS)" },
		{ extension: "czi", application: "Carl Zeiss Image Data Format" },
		{ extension: "lif", application: "Leica Image File" },
		{ extension: "nd2", application: "Nikon ND2 Microscopy Image" },
		{ extension: "gel", application: "Gel Electrophoresis Image" },
		{ extension: "spe", application: "Spectral Imaging File" },
	],

	Compression: [
		{ extension: "zip", validMimeTypes: ["application/zip"] },
		{ extension: "rar", validMimeTypes: ["application/vnd.rar"] },
		{ extension: "7z", validMimeTypes: ["application/x-7z-compressed"] },
		{ extension: "tar", validMimeTypes: ["application/x-tar"] },
		{ extension: "gz", validMimeTypes: ["application/gzip"] },
		{ extension: "tgz", validMimeTypes: ["application/gzip"] },
		{ extension: "bz2", validMimeTypes: ["application/x-bzip2"] },
		{ extension: "xz", validMimeTypes: ["application/x-xz"] },
		{ extension: "zst", validMimeTypes: ["application/zstd"] },

		{ extension: "lz4", application: "LZ4 Compressed File" },
		{ extension: "lz", application: "Lzip Compressed File" },
		{ extension: "lzma", application: "LZMA Compressed File" },
	],

	Executable: [
		{
			extension: "exe",
			application: "Windows Executable",
			validMimeTypes: ["application/x-msdownload"],
		},
		{ extension: "msi", application: "Windows Installer", validMimeTypes: ["application/x-msi"] },
		{
			extension: "dmg",
			application: "Apple Disk Image",
			validMimeTypes: ["application/x-apple-diskimage"],
		},
		{
			extension: "apk",
			application: "Android Package",
			validMimeTypes: ["application/vnd.android.package-archive"],
		},
		{
			extension: "ipa",
			application: "iOS App Store Package",
			validMimeTypes: ["application/octet-stream"],
		},
		{
			extension: "deb",
			application: "Debian Software Package",
			validMimeTypes: ["application/vnd.debian.binary-package"],
		},
		{
			extension: "rpm",
			application: "Red Hat Package Manager",
			validMimeTypes: ["application/x-rpm"],
		},
		{
			extension: "iso",
			application: "Disc Image File",
			validMimeTypes: ["application/x-iso9660-image"],
		},
		{ extension: "img", application: "Disk Image File" },
		{
			extension: "dll",
			application: "Dynamic Link Library",
			validMimeTypes: ["application/x-msdownload"],
		},

		{ extension: "pkg", application: "macOS Installer Package" },
		{ extension: "app", application: "macOS App Bundle (Directory)" },
	],

	Code: [
		{
			extension: "js",
			application: "JavaScript",
			validMimeTypes: ["text/javascript", "application/javascript"],
		},
		{ extension: "mjs", application: "ES Modules JavaScript" },
		{ extension: "cjs", application: "CommonJS JavaScript" },
		{ extension: "ts", application: "TypeScript", validMimeTypes: ["application/typescript"] },
		{ extension: "tsx", application: "TypeScript JSX" },
		{ extension: "jsx", application: "JavaScript JSX" },
		{ extension: "java", application: "Java", validMimeTypes: ["text/x-java-source"] },
		{ extension: "kt", application: "Kotlin", validMimeTypes: ["text/x-kotlin"] },
		{ extension: "kts", application: "Kotlin Script" },
		{ extension: "py", application: "Python", validMimeTypes: ["text/x-python"] },
		{ extension: "pyc", application: "Compiled Python File" },
		{ extension: "pyo", application: "Optimized Python File" },
		{ extension: "rpy", application: "Ren'Py Script" },
		{ extension: "rb", application: "Ruby", validMimeTypes: ["text/x-ruby"] },
		{ extension: "php", application: "PHP", validMimeTypes: ["application/x-httpd-php"] },
		{ extension: "swift", application: "Swift" },
		{ extension: "go", application: "Go", validMimeTypes: ["text/x-go"] },
		{ extension: "rs", application: "Rust" },
		{ extension: "dart", application: "Dart", validMimeTypes: ["application/dart"] },
		{ extension: "lua", application: "Lua", validMimeTypes: ["text/x-lua"] },
		{ extension: "r", application: "R Language", validMimeTypes: ["text/x-r"] },
		{ extension: "pl", application: "Perl", validMimeTypes: ["text/x-perl"] },
		{ extension: "tcl", application: "Tcl Script" },
		{ extension: "sh", application: "Shell Script", validMimeTypes: ["application/x-sh"] },
		{ extension: "bash", application: "Bash Script" },
		{ extension: "zsh", application: "Zsh Script" },
		{ extension: "fish", application: "Fish Shell Script" },
		{ extension: "ps1", application: "PowerShell Script" },
		{ extension: "bat", application: "Batch Script" },
		{ extension: "cmd", application: "Windows Command Script" },
		{ extension: "ahk", application: "AutoHotkey Script" },
		{ extension: "c", application: "C Language", validMimeTypes: ["text/x-csrc"] },
		{ extension: "i", application: "C Preprocessed File" },
		{ extension: "cpp", application: "C++", validMimeTypes: ["text/x-c++src"] },
		{ extension: "cc", application: "C++" },
		{ extension: "cxx", application: "C++" },
		{ extension: "h", application: "C Header File" },
		{ extension: "hpp", application: "C++ Header File" },
		{ extension: "cs", application: "C#", validMimeTypes: ["text/x-csharp"] },
		{ extension: "fs", application: "F#" },
		{ extension: "ml", application: "OCaml/ML" },
		{ extension: "nim", application: "Nim Language" },
		{ extension: "html", application: "HTML", validMimeTypes: ["text/html"] },
		{ extension: "htm", application: "HTML", validMimeTypes: ["text/html"] },
		{ extension: "css", application: "CSS", validMimeTypes: ["text/css"] },
		{ extension: "scss", application: "SASS/SCSS" },
		{ extension: "sass", application: "SASS/SCSS" },
		{ extension: "less", application: "LESS" },
		{ extension: "vue", application: "Vue.js" },
		{ extension: "svelte", application: "Svelte" },
		{ extension: "astro", application: "Astro" },
		{ extension: "jsonc", application: "JSON with Comments" },
		{ extension: "json5", application: "JSON5" },
		{ extension: "lock", application: "Lockfile" },
		{ extension: "vbs", application: "VBScript" },
		{ extension: "wsf", application: "Windows Script File" },
		{ extension: "asm", application: "Assembly Language" },
		{ extension: "s", application: "Assembly Language" },
		{ extension: "a51", application: "Assembly 8051" },
		{ extension: "m68k", application: "Motorola 68K Assembly" },
		{ extension: "vhdl", application: "VHDL Hardware Description" },
		{ extension: "verilog", application: "Verilog Hardware Description" },
		{ extension: "v", application: "Verilog" },
		{ extension: "sv", application: "SystemVerilog" },
		{ extension: "clj", application: "Clojure" },
		{ extension: "cljs", application: "ClojureScript" },
		{ extension: "lisp", application: "Lisp" },
		{ extension: "el", application: "Emacs Lisp" },
		{ extension: "scm", application: "Scheme" },
		{ extension: "pro", application: "Prolog" },
		{ extension: "awk", application: "AWK Script" },
		{ extension: "sed", application: "SED Script" },
		{ extension: "wasm", application: "WebAssembly Binary File" },
		{ extension: "wast", application: "WebAssembly Text File" },
		{ extension: "godot", application: "Godot Engine Script" },
		{ extension: "pck", application: "Godot Engine Pack" },
		{ extension: "gd", application: "GDScript" },
		{ extension: "makefile", application: "Makefile" },
		{ extension: "ninja", application: "Ninja Build File" },
		{ extension: "cmake", application: "CMake Build Script" },
		{ extension: "gradle", application: "Gradle Build Script" },
		{ extension: "maven", application: "Maven POM File" },
		{ extension: "graphql", application: "GraphQL Schema" },
		{ extension: "cloudfunctions", application: "Google Cloud Functions" },
		{ extension: "lambda", application: "AWS Lambda Function" },
		{ extension: "serverless.yml", application: "Serverless Framework" },
		{
			extension: "tf",
			application: "Terraform Configuration",
			validMimeTypes: ["application/hcl"],
		},
		{ extension: "tfvars", application: "Terraform Variables" },
		{ extension: "toml", application: "TOML Configuration", validMimeTypes: ["application/toml"] },
		{ extension: "dockerfile", application: "Docker Build File" },
		{
			extension: "ipynb",
			application: "Jupyter Notebook",
			validMimeTypes: ["application/x-ipynb+json"],
		},
		{ extension: "prisma", application: "Prisma Schema" },
		{ extension: "repl", application: "REPL Script" },
		{ extension: "robots.txt", application: "Robots.txt for Web Crawlers" },
		{ extension: "htaccess", application: "Apache Configuration" },
		{ extension: "htpasswd", application: "Apache User Password File" },
	],

	"3D": [
		{ extension: "obj", application: "Wavefront OBJ File", validMimeTypes: ["model/obj"] },
		{ extension: "mtl", application: "Wavefront Material File" },
		{ extension: "fbx", application: "Autodesk FBX Format" },
		{
			extension: "dae",
			application: "COLLADA 3D Model Format",
			validMimeTypes: ["model/vnd.collada+xml"],
		},
		{
			extension: "gltf",
			application: "GL Transmission Format",
			validMimeTypes: ["model/gltf+json"],
		},
		{ extension: "glb", application: "Binary GLTF Model", validMimeTypes: ["model/gltf-binary"] },
		{ extension: "stl", application: "Stereolithography 3D Model", validMimeTypes: ["model/stl"] },
		{ extension: "3ds", application: "3D Studio Mesh" },
		{ extension: "max", application: "Autodesk 3ds Max Scene" },
		{ extension: "blend", application: "Blender Project File" },
		{ extension: "abc", application: "Alembic 3D File" },
		{ extension: "usd", application: "Universal Scene Description" },
		{ extension: "usda", application: "Universal Scene Description ASCII" },
		{ extension: "usdz", application: "Universal Scene Description Zip Archive" },
		{ extension: "rvt", application: "Autodesk Revit Model" },
		{ extension: "rfa", application: "Autodesk Revit Family File" },
		{ extension: "skp", application: "SketchUp Model" },
		{ extension: "layout", application: "SketchUp Layout File" },
		{ extension: "pln", application: "ArchiCAD Project File" },
		{ extension: "gsm", application: "ArchiCAD Library Object File" },
		{ extension: "3dm", application: "Rhinoceros 3D Model File" },
		{ extension: "igs", application: "IGES Model File", validMimeTypes: ["model/iges"] },
		{
			extension: "iges",
			application: "Initial Graphics Exchange Specification",
			validMimeTypes: ["model/iges"],
		},
		{ extension: "step", application: "STEP 3D Model File", validMimeTypes: ["model/step"] },
		{ extension: "stp", application: "STEP 3D Model File", validMimeTypes: ["model/step"] },
		{ extension: "x_t", application: "Parasolid Model File" },
		{ extension: "x_b", application: "Parasolid Binary File" },
		{ extension: "brep", application: "Boundary Representation Model" },
		{ extension: "sldprt", application: "SolidWorks Part File" },
		{ extension: "sldasm", application: "SolidWorks Assembly File" },
		{ extension: "slddrw", application: "SolidWorks Drawing File" },
		{ extension: "prt", application: "PTC Creo Part File" },
		{ extension: "neu", application: "Neutral CAD File" },
		{ extension: "ifc", application: "Industry Foundation Classes (IFC)" },
		{ extension: "ifczip", application: "Compressed IFC File" },
		{ extension: "sat", application: "ACIS SAT 3D Model" },
		{ extension: "catpart", application: "CATIA Part File" },
		{ extension: "catproduct", application: "CATIA Product File" },
		{ extension: "cgr", application: "CATIA Graphical Representation" },
		{
			extension: "gcode",
			application: "G-Code CNC Instructions",
			validMimeTypes: ["text/x-gcode"],
		},
		{ extension: "nc", application: "Numerical Control File" },
		{ extension: "tap", application: "CNC Machine Toolpath File" },
		{ extension: "3mf", application: "3D Manufacturing Format" },
		{ extension: "x3d", application: "Extensible 3D Graphics" },
		{ extension: "wrl", application: "VRML Virtual Reality Modeling Language" },
		{ extension: "ply", application: "Polygon File Format" },
		{ extension: "bvh", application: "Biovision Hierarchy Animation" },
		{ extension: "c3d", application: "C3D Motion Capture Data" },
		{ extension: "anim", application: "Maya Animation File" },
		{ extension: "xaf", application: "3ds Max Animation File" },
		{ extension: "xsf", application: "3ds Max Skeleton File" },
		{ extension: "mdd", application: "Motion Designer Data" },
		{ extension: "vrm", application: "Virtual Reality Model" },
		{ extension: "scn", application: "Godot Engine Scene" },
		{ extension: "res", application: "Godot Engine Resource" },
		{ extension: "unitypackage", application: "Unity Package File" },
		{ extension: "prefab", application: "Unity Prefab File" },
		{ extension: "uasset", application: "Unreal Engine Asset File" },
		{ extension: "umap", application: "Unreal Engine Map File" },
		{ extension: "lwo", application: "LightWave Object" },
		{ extension: "lws", application: "LightWave Scene" },
		{ extension: "cob", application: "Caligari TrueSpace Object" },
		{ extension: "x", application: "DirectX 3D Model" },
		{ extension: "ac", application: "AC3D Model File" },
		{ extension: "iv", application: "Open Inventor File" },
	],

	Database: [
		{ extension: "db", application: "Generic Database File" },
		{
			extension: "sqlite",
			application: "SQLite Database File",
			validMimeTypes: ["application/vnd.sqlite3"],
		},
		{ extension: "sqlite3", application: "SQLite 3 Database File" },
		{ extension: "db3", application: "SQLite 3 Database File" },
		{
			extension: "mdb",
			application: "Microsoft Access Database",
			validMimeTypes: ["application/x-msaccess"],
		},
		{
			extension: "accdb",
			application: "Microsoft Access Database (2007+)",
			validMimeTypes: ["application/vnd.ms-access"],
		},
		{ extension: "frm", application: "MySQL Table Definition File" },
		{ extension: "myd", application: "MySQL Data File" },
		{ extension: "myi", application: "MySQL Index File" },
		{
			extension: "sql",
			application: "Structured Query Language Script",
			validMimeTypes: ["application/sql"],
		},
		{ extension: "bak", application: "Database Backup File" },
		{ extension: "ibd", application: "InnoDB Data File" },
		{ extension: "mssql", application: "Microsoft SQL Server Database" },
		{ extension: "mdf", application: "Microsoft SQL Server Primary Database File" },
		{ extension: "ldf", application: "Microsoft SQL Server Log File" },
		{ extension: "ndf", application: "Microsoft SQL Server Secondary Database File" },
		{ extension: "ora", application: "Oracle Database File" },
		{ extension: "dmp", application: "Oracle Database Dump File" },
		{ extension: "accde", application: "Microsoft Access Executable File" },
		{ extension: "adp", application: "Access Data Project" },
		{ extension: "bson", application: "Binary JSON (MongoDB Data File)" },
		{ extension: "fdb", application: "Firebird Database File" },
		{ extension: "gdb", application: "InterBase Database File" },
		{ extension: "neo4j", application: "Neo4j Graph Database File" },
		{ extension: "arangodb", application: "ArangoDB Database File" },
		{ extension: "realm", application: "Realm Database File" },
		{ extension: "couchdb", application: "CouchDB Database File" },
		{ extension: "rdb", application: "Redis Database File" },
		{ extension: "dat", application: "Generic Database Data File" },
		{ extension: "rox", application: "RocksDB Data File" },
		{ extension: "ldb", application: "LevelDB Database File" },
		{ extension: "exp", application: "Export File" },
		{ extension: "bkp", application: "Backup Database File" },
		{ extension: "xsql", application: "XML SQL Export File" },
		{ extension: "wdb", application: "Microsoft Works Database" },
		{ extension: "sdf", application: "SQL Server Compact Edition Database" },
		{ extension: "pdb", application: "Palm Database File" },
		{ extension: "cdb", application: "Pocket Access Database" },
		{ extension: "cnf", application: "Database Configuration File" },
		{ extension: "cub", application: "Analysis Services Cube File" },
		{ extension: "olap", application: "Online Analytical Processing Cube" },
		{ extension: "vw", application: "Database View File" },
		{ extension: "nsf", application: "Lotus Notes Database" },
		{ extension: "ntf", application: "Lotus Notes Template File" },
		{ extension: "dbx", application: "Outlook Express Database File" },
		{ extension: "edb", application: "Exchange Database File" },
		{ extension: "fp3", application: "FileMaker Pro 3 Database" },
		{ extension: "fp5", application: "FileMaker Pro 5 Database" },
		{ extension: "fp7", application: "FileMaker Pro 7 Database" },
		{ extension: "gdbtable", application: "ArcGIS Geodatabase Table File" },
		{ extension: "gdbindex", application: "ArcGIS Geodatabase Index File" },
	],

	Data: [
		{ extension: "csv", application: "Comma-Separated Values File", validMimeTypes: ["text/csv"] },
		{
			extension: "tsv",
			application: "Tab-Separated Values File",
			validMimeTypes: ["text/tab-separated-values"],
		},
		{ extension: "psv", application: "Pipe-Separated Values File" },
		{
			extension: "json",
			application: "JavaScript Object Notation",
			validMimeTypes: ["application/json"],
		},
		{ extension: "jsonl", application: "JSON Lines File", validMimeTypes: ["application/jsonl"] },
		{
			extension: "xml",
			application: "Extensible Markup Language",
			validMimeTypes: ["application/xml", "text/xml"],
		},
		{
			extension: "yaml",
			application: "YAML Ain't Markup Language",
			validMimeTypes: ["application/x-yaml"],
		},
		{
			extension: "yml",
			application: "YAML Ain't Markup Language",
			validMimeTypes: ["application/x-yaml"],
		},
		{
			extension: "rdf",
			application: "Resource Description Framework",
			validMimeTypes: ["application/rdf+xml"],
		},
		{ extension: "ttl", application: "Turtle RDF Data" },
		{ extension: "n3", application: "Notation3 RDF Data" },
		{ extension: "msgpack", application: "MessagePack Serialized Data" },
		{ extension: "ubj", application: "Universal Binary JSON" },
		{ extension: "arff", application: "Attribute-Relation File Format (WEKA)" },
		{ extension: "dta", application: "Stata Data File" },
		{ extension: "sav", application: "SPSS Data File" },
		{ extension: "por", application: "SPSS Portable Data File" },
		{ extension: "sd2", application: "SAS Data File" },
		{ extension: "xpt", application: "SAS Transport File" },
		{ extension: "rdata", application: "R Statistical Data File" },
		{ extension: "rds", application: "R Serialized Data File" },
		{ extension: "mat", application: "MATLAB Data File" },
		{ extension: "grib", application: "GRIB Meteorological Data" },
		{ extension: "pcap", application: "Packet Capture File" },
		{ extension: "pcapng", application: "Packet Capture Next Generation" },
		{ extension: "las", application: "LIDAR Point Cloud Data" },
		{ extension: "xyz", application: "XYZ Point Cloud Data" },
		{ extension: "fasta", application: "FASTA Sequence File" },
		{ extension: "fastq", application: "FASTQ Sequence File" },
		{ extension: "bam", application: "Binary Alignment Map" },
		{ extension: "sam", application: "Sequence Alignment Map" },
		{ extension: "vcf", application: "Variant Call Format" },
		{ extension: "gff", application: "General Feature Format" },
		{ extension: "gtf", application: "Gene Transfer Format" },
		{ extension: "pkl", application: "Pickle Serialized Data" },
		{ extension: "joblib", application: "Joblib Serialized Model" },
		{ extension: "npy", application: "NumPy Binary File" },
		{ extension: "npz", application: "NumPy Compressed Archive" },
		{ extension: "h5", application: "HDF5 Data Format" },
		{ extension: "pb", application: "TensorFlow Model File" },
		{ extension: "onnx", application: "Open Neural Network Exchange Format" },
		{
			extension: "parquet",
			application: "Apache Parquet Data Format",
			validMimeTypes: ["application/vnd.apache.parquet"],
		},
		{ extension: "avro", application: "Apache Avro Data File" },
		{ extension: "orc", application: "Optimized Row Columnar Data File" },
		{ extension: "feather", application: "Feather Data File" },
		{ extension: "zarr", application: "Zarr Compressed Data File" },
		{ extension: "log", application: "Log File", validMimeTypes: ["text/plain"] },
		{ extension: "ini", application: "Configuration File" },
		{ extension: "cfg", application: "Configuration File" },
		{ extension: "properties", application: "Java Properties File" },

		{ extension: "arrow", application: "Apache Arrow File Format" },
	],

	Font: [
		{ extension: "ttf", application: "TrueType Font", validMimeTypes: ["font/ttf"] },
		{ extension: "otf", application: "OpenType Font", validMimeTypes: ["font/otf"] },
		{ extension: "woff", application: "Web Open Font Format", validMimeTypes: ["font/woff"] },
		{ extension: "woff2", application: "Web Open Font Format 2", validMimeTypes: ["font/woff2"] },
		{
			extension: "eot",
			application: "Embedded OpenType Font",
			validMimeTypes: ["application/vnd.ms-fontobject"],
		},
		{ extension: "dfont", application: "Mac OS Data Fork Font" },
		{ extension: "bdf", application: "Bitmap Distribution Format" },
		{ extension: "pcf", application: "Portable Compiled Format" },
		{ extension: "fnt", application: "Windows Bitmap Font" },
		{ extension: "psf", application: "PC Screen Font" },
		{ extension: "pfb", application: "PostScript Type 1 Font Binary" },
		{ extension: "pfm", application: "PostScript Type 1 Font Metrics" },
		{ extension: "afm", application: "Adobe Font Metrics" },
		{ extension: "fon", application: "Windows FON Bitmap Font" },
		{ extension: "txf", application: "Texture Font Format" },
		{ extension: "ps", application: "PostScript Font" },
		{ extension: "chm", application: "Compiled HTML Help Font" },
	],

	Security: [
		{
			extension: "crt",
			application: "Security Certificate",
			validMimeTypes: ["application/x-x509-ca-cert"],
		},
		{ extension: "cer", application: "Security Certificate" },
		{
			extension: "pem",
			application: "Privacy Enhanced Mail Certificate",
			validMimeTypes: ["application/x-pem-file"],
		},
		{ extension: "key", application: "Private Key File" },
		{ extension: "pub", application: "Public Key File" },
		{
			extension: "p12",
			application: "PKCS#12 Certificate Store",
			validMimeTypes: ["application/x-pkcs12"],
		},
		{
			extension: "pfx",
			application: "PKCS#12 Certificate Store",
			validMimeTypes: ["application/x-pkcs12"],
		},
		{ extension: "asc", application: "PGP Armored Key" },
		{ extension: "gpg", application: "GNU Privacy Guard Key" },
		{ extension: "keystore", application: "Java Keystore File" },
	],

	System: [
		{
			extension: "sys",
			application: "Windows System File",
			validMimeTypes: ["application/octet-stream"],
		},
		{
			extension: "dll",
			application: "Dynamic Link Library",
			validMimeTypes: ["application/x-msdownload"],
		},
		{ extension: "drv", application: "Windows Hardware Driver" },
		{ extension: "cpl", application: "Windows Control Panel Item" },
		{ extension: "msc", application: "Microsoft Management Console Snap-in" },
		{
			extension: "reg",
			application: "Windows Registry Entry",
			validMimeTypes: ["text/x-ms-regedit"],
		},
		{
			extension: "inf",
			application: "Setup Information File",
			validMimeTypes: ["application/inf"],
		},
		{
			extension: "lnk",
			application: "Windows Shortcut",
			validMimeTypes: ["application/x-ms-shortcut"],
		},
		{ extension: "pif", application: "Program Information File" },
		{ extension: "cur", application: "Windows Cursor" },
		{ extension: "ani", application: "Animated Windows Cursor" },
		{ extension: "minidump", application: "Windows Memory Dump" },
		{ extension: "dmp", application: "System Memory Dump" },
		{
			extension: "cab",
			application: "Windows Cabinet File",
			validMimeTypes: ["application/vnd.ms-cab-compressed"],
		},

		{ extension: "ds_store", application: "macOS Folder Settings" },
		{
			extension: "plist",
			application: "macOS Property List",
			validMimeTypes: ["application/x-plist"],
		},
		{ extension: "kext", application: "macOS Kernel Extension" },
		{ extension: "webloc", application: "macOS Web Shortcut" },
		{ extension: "mobileconfig", application: "Apple Configuration Profile" },

		{
			extension: "so",
			application: "Shared Object Library",
			validMimeTypes: ["application/x-sharedlib"],
		},
		{ extension: "ko", application: "Kernel Object Module" },
		{ extension: "pid", application: "Process ID File" },
		{ extension: "sock", application: "Unix Socket File" },
		{ extension: "swap", application: "Swap File" },
		{ extension: "rc", application: "Run Command Configuration" },

		{ extension: "tmp", application: "Temporary File" },
		{ extension: "temp", application: "Temporary File" },
		{ extension: "bak", application: "Generic Backup File" },
		{ extension: "swp", application: "Vim Swap File" },
		{ extension: "old", application: "Backup / Old Version File" },
		{ extension: "log", application: "System Log File", validMimeTypes: ["text/plain"] },
	],

	Email: [
		{ extension: "eml", application: "RFC 822 Email Message", validMimeTypes: ["message/rfc822"] },
		{ extension: "msg", application: "Outlook Message" },
		{ extension: "mbox", application: "Mailbox File" },
		{ extension: "pst", application: "Outlook Personal Storage Table" },
		{ extension: "ost", application: "Outlook Offline Storage Table" },

		{ extension: "ics", application: "iCalendar File", validMimeTypes: ["text/calendar"] },
		{ extension: "vcf", application: "vCard Contact File", validMimeTypes: ["text/vcard"] },
	],

	DiskImage: [
		{
			extension: "iso",
			application: "ISO Disc Image",
			validMimeTypes: ["application/x-iso9660-image"],
		},
		{ extension: "img", application: "Disk Image File" },
		{
			extension: "dmg",
			application: "Apple Disk Image",
			validMimeTypes: ["application/x-apple-diskimage"],
		},
		{ extension: "sparsebundle", application: "macOS Sparse Bundle Disk Image" },
		{ extension: "toast", application: "Roxio Toast Disc Image" },
	],

	VMImage: [
		{ extension: "vhd", application: "Virtual Hard Disk" },
		{ extension: "vhdx", application: "Virtual Hard Disk v2" },
		{ extension: "vmdk", application: "VMware Virtual Disk" },
		{ extension: "vdi", application: "VirtualBox Disk Image" },
		{ extension: "qcow2", application: "QEMU Copy-On-Write v2 Disk Image" },
		{ extension: "ova", application: "Open Virtual Appliance" },
		{ extension: "ovf", application: "Open Virtualization Format" },
	],

	ContainerImage: [
		{ extension: "oci", application: "OCI Image Layout" },
		{ extension: "sif", application: "Singularity Image Format" },
	],

	CAD: [
		{ extension: "dwg", application: "AutoCAD Drawing" },
		{ extension: "dxf", application: "Drawing Exchange Format" },
		{ extension: "dwt", application: "AutoCAD Drawing Template" },
		{ extension: "dwf", application: "Design Web Format" },
	],

	GIS: [
		{ extension: "shp", application: "ESRI Shapefile" },
		{ extension: "shx", application: "ESRI Shapefile Index" },
		{ extension: "dbf", application: "Shapefile Attribute Table" },
		{ extension: "prj", application: "Shapefile Projection" },
		{ extension: "cpg", application: "Shapefile Code Page" },
		{ extension: "qpj", application: "QGIS Projection File" },
		{ extension: "geojson", application: "GeoJSON" },
		{ extension: "topojson", application: "TopoJSON" },
		{ extension: "kml", application: "Keyhole Markup Language" },
		{ extension: "kmz", application: "Compressed KML" },
		{ extension: "gpx", application: "GPS Exchange Format" },
		{ extension: "gml", application: "Geography Markup Language" },

		{ extension: "gpkg", application: "GeoPackage" },
		{ extension: "mbtiles", application: "Mapbox MBTiles" },
	],

	Ebook: [
		{ extension: "epub", application: "EPUB eBook", validMimeTypes: ["application/epub+zip"] },
		{ extension: "mobi", application: "Mobipocket eBook" },
		{ extension: "azw", application: "Amazon Kindle eBook" },
		{ extension: "azw3", application: "Amazon Kindle eBook" },
		{ extension: "kfx", application: "Kindle Format 10 (KFX)" },
		{ extension: "fb2", application: "FictionBook eBook" },
		{ extension: "ibooks", application: "Apple iBooks" },
		{ extension: "opf", application: "Open Packaging Format (eBook metadata)" },
		{ extension: "ncx", application: "Navigation Control file for XML (eBook TOC)" },

		{ extension: "cbz", application: "Comic Book ZIP Archive" },
		{ extension: "cbr", application: "Comic Book RAR Archive" },
		{ extension: "cb7", application: "Comic Book 7-Zip Archive" },
	],

	Config: [
		{ extension: "env", application: "Environment Variables File (filename: .env)" },
		{ extension: "editorconfig", application: "EditorConfig (filename: .editorconfig)" },
		{ extension: "gitignore", application: "Git Ignore Rules (filename: .gitignore)" },
		{ extension: "gitattributes", application: "Git Attributes (filename: .gitattributes)" },
		{ extension: "npmrc", application: "npm Configuration (filename: .npmrc)" },
		{ extension: "yarnrc", application: "Yarn Configuration (filename: .yarnrc)" },
		{
			extension: "yaml",
			application: "YAML Ain't Markup Language",
			validMimeTypes: ["application/x-yaml"],
		},
		{
			extension: "yml",
			application: "YAML Ain't Markup Language",
			validMimeTypes: ["application/x-yaml"],
		},
		{ extension: "toml", application: "TOML Configuration", validMimeTypes: ["application/toml"] },
		{ extension: "ini", application: "INI Configuration" },
		{ extension: "cfg", application: "Config File" },
		{ extension: "properties", application: "Java Properties" },
		{ extension: "json", application: "JSON", validMimeTypes: ["application/json"] },
	],

	Package: [
		{ extension: "jar", application: "Java Archive" },
		{ extension: "war", application: "Web Application Archive" },
		{ extension: "ear", application: "Enterprise Application Archive" },

		{ extension: "whl", application: "Python Wheel Package" },

		{ extension: "gem", application: "RubyGems Package" },

		{ extension: "nupkg", application: "NuGet Package" },

		{ extension: "xcarchive", application: "Xcode Archive" },
	],
};

// #endregion

// #region Overrides + lookup indexes (built once at module load — O(1) classification)

/**
 * Context overrides for extensions that legitimately collide across categories, where Projective's
 * usage has a clear winner. Applied with HIGHEST precedence when the indexes are built, so both the
 * category and its resolved `application` stay consistent. Extend this — it is the intended, visible
 * home for such tie-breaks — rather than reordering the taxonomy.
 */
export const EXTENSION_OVERRIDES: Readonly<Record<string, FileCategory>> = {
	// `.ts` is TypeScript here, not an MPEG Transport Stream — this is a dev/creator platform.
	ts: "Code",
};

const EXT_INDEX = new Map<string, FileCategory>();
const MIME_INDEX = new Map<string, FileCategory>();
const APP_INDEX = new Map<string, string>();

// Seed overrides first so the general pass below cannot clobber them (its writes are guarded).
for (const [ext, category] of Object.entries(EXTENSION_OVERRIDES)) {
	const key = ext.toLowerCase();
	EXT_INDEX.set(key, category);
	if (category !== "Other") {
		const def = EXTENSION_CATEGORIES[category].find(
			(d) => d.extension.toLowerCase() === key,
		);
		if (def?.application) APP_INDEX.set(key, def.application);
	}
}

for (
	const [category, defs] of Object.entries(EXTENSION_CATEGORIES) as Array<
		[FileCategory, FileDefinition[]]
	>
) {
	for (const def of defs) {
		const ext = def.extension.toLowerCase();
		// First category in enum order wins on a duplicate extension (deterministic).
		if (!EXT_INDEX.has(ext)) EXT_INDEX.set(ext, category);
		if (def.application && !APP_INDEX.has(ext)) APP_INDEX.set(ext, def.application);
		for (const mime of def.validMimeTypes ?? []) {
			const key = mime.toLowerCase();
			if (!MIME_INDEX.has(key)) MIME_INDEX.set(key, category);
		}
	}
}

// #endregion

// #region Public API

/**
 * The lower-cased extension of a filename, no dot ("png", "pdf", "tar.gz" → "gz"). Handles dotfiles
 * (".gitignore" → "gitignore") and path-prefixed names ("a/b/c.PNG" → "png"). Returns the whole
 * basename lower-cased when there is no extension ("Dockerfile" → "dockerfile").
 */
export function fileExtension(name: string): string {
	const base = (name.split(/[\\/]/).pop() ?? name).trim();
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return base.replace(/^\./, "").toLowerCase();
	return base.slice(dot + 1).toLowerCase();
}

/**
 * Classify a file into its {@link FileCategory} from its name and optional MIME type. Extension is
 * the primary signal; MIME (exact, then top-level) is the fallback; `Other` is the floor.
 */
export function categorizeFile(name: string, mimeType?: string): FileCategory {
	const byExt = EXT_INDEX.get(fileExtension(name));
	if (byExt) return byExt;

	const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
	if (mime) {
		const byMime = MIME_INDEX.get(mime);
		if (byMime) return byMime;
		if (mime.startsWith("image/")) return "Image";
		if (mime.startsWith("video/")) return "Video";
		if (mime.startsWith("audio/")) return "Audio";
		if (mime.startsWith("text/")) return "Document";
		if (mime.startsWith("font/")) return "Font";
		if (mime.startsWith("model/")) return "3D";
	}
	return "Other";
}

/** The coarse {@link FileKind} a category renders as. */
export function categoryToKind(category: FileCategory): FileKind {
	return CATEGORY_META[category].kind;
}

/** The full classification of a file, ready to persist on the file row / in its metadata. */
export interface FileDescription {
	/** The rich taxonomy category. */
	category: FileCategory;
	/** The coarse rendering bucket ({@link FileKind}). */
	kind: FileKind;
	/** Lower-cased extension, no dot. */
	extension: string;
	/** Human-readable source application ("Adobe Photoshop Document"), or `null` if unknown. */
	application: string | null;
	/** Semantic icon slug (see {@link CategoryMeta.icon}). */
	icon: string;
	/** Human-facing category label. */
	label: string;
}

/**
 * Fully describe a file for storage + display in one call. Use this on the upload path: persist
 * `category` (facetable column), `kind` (rendering), and `application` (metadata), so search,
 * filtering, and analytics all read from one authoritative classification.
 */
export function describeFile(name: string, mimeType?: string): FileDescription {
	const extension = fileExtension(name);
	const category = categorizeFile(name, mimeType);
	const meta = CATEGORY_META[category];
	return {
		category,
		kind: meta.kind,
		extension,
		application: APP_INDEX.get(extension) ?? null,
		icon: meta.icon,
		label: meta.label,
	};
}

/**
 * Back-compatible convenience over {@link categorizeFile} that accepts any object with a `name` (and
 * optional `type`) — e.g. a browser `File` — without depending on the DOM lib.
 */
export function getFileCategory(file: { name: string; type?: string }): FileCategory {
	return categorizeFile(file.name, file.type);
}

// #endregion
