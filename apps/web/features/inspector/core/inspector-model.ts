import { fileInspectHref, inspectable, type InspectAsset } from "@projective/types/files";
import type { StageFact } from "./inspector-shell.ts";

/**
 * inspector-model — the pure decisions behind the workspace chrome: the bar's meta line, the
 * Details rows, the copyable links, the panel's first state and the workspace shortcuts.
 */

// #region Labels
const BYTES = new Intl.NumberFormat("en-GB");

/** `Category · EXT · size`, the bar's metadata line. */
export function metaLine(asset: InspectAsset): string {
	const ext = asset.ext.trim().toUpperCase();
	return [asset.categoryLabel, ext, asset.sizeLabel].filter((part) => part.length > 0).join(" · ");
}

/** The exact size, e.g. `"30,316 bytes"`. */
export function exactBytes(bytes: number): string {
	return `${BYTES.format(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
}

/** A long content hash shortened to its head and tail. */
export function shortHash(hash: string): string {
	return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Who can see the file, phrased for this viewer ("Only you" is only true for its manager). */
export function visibilityText(asset: Pick<InspectAsset, "visibility" | "canManage">): string {
	switch (asset.visibility) {
		case "private":
			return asset.canManage ? "Only you" : "Private";
		case "link":
			return "Anyone with the link";
		case "public":
			return "Public";
	}
}
// #endregion

// #region Details
/** One Details row. `secondary` is quieter supporting text after the value. */
export interface DetailRow {
	key: string;
	label: string;
	value: string;
	secondary: string | null;
}

function row(
	key: string,
	label: string,
	value: string,
	secondary: string | null = null,
): DetailRow {
	return { key, label, value, secondary };
}

/** The file facts, in panel order, ending with the canvas's own facts. Absent values are omitted. */
export function fileDetails(asset: InspectAsset, facts: readonly StageFact[]): DetailRow[] {
	const ext = asset.ext.trim().toUpperCase();
	const rows: DetailRow[] = [
		row("name", "Name", asset.name),
		row("type", "Type", ext ? `${asset.categoryLabel} · ${ext}` : asset.categoryLabel),
	];
	if (asset.mimeType.trim().length > 0) rows.push(row("format", "Format", asset.mimeType));
	rows.push(row("size", "Size", asset.sizeLabel, exactBytes(asset.sizeBytes)));
	if (asset.width !== null && asset.height !== null) {
		rows.push(row("dimensions", "Dimensions", `${asset.width} × ${asset.height} px`));
	}
	if (asset.durationLabel !== null) rows.push(row("duration", "Duration", asset.durationLabel));
	if (asset.pageCount !== null) {
		rows.push(row("pages", "Pages", String(asset.pageCount)));
	}
	facts.forEach((fact, i) => {
		if (fact.value.trim().length > 0) rows.push(row(`fact-${i}`, fact.label, fact.value));
	});
	return rows;
}

/**
 * The rows an embedded facts list can show: {@link fileDetails}' keys, `"facts"` for every canvas
 * fact, and `"uploaded"`/`"owner"`, which render as their own rows.
 */
export type EmbedFactKey =
	| "name"
	| "type"
	| "format"
	| "size"
	| "dimensions"
	| "duration"
	| "pages"
	| "facts"
	| "uploaded"
	| "owner";

/** What an embedded facts list leaves out unless told otherwise: the name its host already shows. */
export const EMBED_FACTS_OMIT: readonly EmbedFactKey[] = ["name"];

/** The file rows of an embedded facts list: {@link fileDetails} without the omitted keys. */
export function embedDetails(
	asset: InspectAsset,
	facts: readonly StageFact[],
	omit: readonly string[] = EMBED_FACTS_OMIT,
): DetailRow[] {
	const dropFacts = omit.includes("facts");
	return fileDetails(asset, facts).filter((r) =>
		!omit.includes(r.key) && !(dropFacts && r.key.startsWith("fact-"))
	);
}

/** Visibility, then the download count when the viewer may see it. */
export function accessDetails(asset: InspectAsset): DetailRow[] {
	const rows = [row("visibility", "Visibility", visibilityText(asset))];
	if (asset.downloadCount !== null) {
		rows.push(row("downloads", "Downloads", BYTES.format(asset.downloadCount)));
	}
	return rows;
}
// #endregion

// #region Links
/** The absolute inspector link; the share slug travels only when the viewer arrived through one. */
export function inspectorLink(
	origin: string,
	asset: Pick<InspectAsset, "id" | "access" | "share">,
): string {
	const share = asset.access === "share" ? asset.share : null;
	return `${origin}${fileInspectHref(asset.id, { share })}`;
}

/** Where "open in a new tab" goes for a file: the inspector for stored bytes, else its own URL. */
export function fileOpenHref(
	file: { id: string; source: string; status: string; url: string },
): string {
	return inspectable(file) ? fileInspectHref(file.id) : file.url;
}

/** The absolute form of a same-origin path such as `/share/<slug>`. */
export function absoluteLink(origin: string, path: string): string {
	return /^https?:\/\//i.test(path) ? path : `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}
// #endregion

// #region Panel
/** The stored desktop preference, read as a boolean; anything unrecognised is no preference. */
export function parsePanelPreference(stored: string | null): boolean | null {
	if (stored === "1") return true;
	if (stored === "0") return false;
	return null;
}

/** Whether the panel opens on load: closed on mobile, else the stored desktop choice, else open. */
export function initialPanelOpen(stored: string | null, mobile: boolean): boolean {
	if (mobile) return false;
	return parsePanelPreference(stored) ?? true;
}
// #endregion

// #region Shortcuts
/** A workspace-level command bound to a single key. */
export type WorkspaceCommand = "fullscreen" | "panel" | "shortcuts";

/** The key facts {@link workspaceCommand} reads from a keyboard event. */
export interface KeyStroke {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}

/** The workspace command a key press asks for, or `null`. Modified presses are never commands. */
export function workspaceCommand(stroke: KeyStroke): WorkspaceCommand | null {
	if (stroke.ctrlKey || stroke.metaKey || stroke.altKey) return null;
	switch (stroke.key) {
		case "f":
		case "F":
			return "fullscreen";
		case "i":
		case "I":
			return "panel";
		case "?":
			return "shortcuts";
		default:
			return null;
	}
}

/** The workspace's own shortcuts, listed after the canvas's. */
export const WORKSPACE_SHORTCUTS: readonly { keys: string[]; label: string }[] = [
	{ keys: ["F"], label: "Toggle fullscreen" },
	{ keys: ["I"], label: "Show or hide the panel" },
	{ keys: ["?"], label: "Keyboard shortcuts" },
];
// #endregion
