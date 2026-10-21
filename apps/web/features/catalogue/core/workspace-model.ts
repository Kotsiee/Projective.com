import type { WorkspaceTab, WorkspaceUrlState } from "@projective/types/catalogue";
import type { EditSection, ListingDetail, UpdateListingInput } from "../types/catalogue-types.ts";

/**
 * workspace-model — the pure rules under the item workspace's store (`workspace-store.ts`): which
 * fields an edit dirtied, the section-scoped patch a save sends, how the save state moves, when a
 * 409 was our own doing, and what a hidden page flushes. DOM-free, so every rule is unit-tested.
 */

// #region Fields and sections
/** The listing fields an Edit section writes through `POST /api/catalogue/update`. */
export type PatchField =
	| "title"
	| "description"
	| "createCategory"
	| "serviceType"
	| "skills"
	| "offer"
	| "delivery"
	| "pricing"
	| "currency"
	| "intake"
	| "seo"
	| "tags";

/**
 * Which fields each section owns. A save sends every field of each section that changed, so a
 * section is always written as one coherent unit — so a currency change always carries the prices
 * it re-states. Media and availability have their own routes.
 */
export const SECTION_FIELDS: Readonly<Record<EditSection, readonly PatchField[]>> = {
	media: [],
	basics: ["title", "description", "createCategory", "serviceType", "skills"],
	offer: ["offer", "delivery"],
	pricing: ["pricing", "currency"],
	availability: [],
	questions: ["intake"],
	seo: ["seo", "tags"],
};

/** Every field a patch can carry, in section order. */
export const PATCH_FIELDS: readonly PatchField[] = Object.values(SECTION_FIELDS).flat();

/** The section a field belongs to. */
export function sectionOf(field: PatchField): EditSection {
	const entry = Object.entries(SECTION_FIELDS).find(([, fields]) => fields.includes(field));
	return (entry?.[0] ?? "basics") as EditSection;
}
// #endregion

// #region Diffing
/** Structural equality over the JSON-shaped values a listing holds; key order never matters. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (!sameValue(left[key], right[key])) return false;
	}
	return true;
}

/** The patch fields the draft holds differently from the last saved copy, in section order. */
export function diffFields(saved: ListingDetail, draft: ListingDetail): PatchField[] {
	return PATCH_FIELDS.filter((field) => !sameValue(saved[field], draft[field]));
}

/** The sections those fields belong to, in page order, once each. */
export function dirtySections(fields: readonly PatchField[]): EditSection[] {
	const sections = new Set(fields.map(sectionOf));
	return (Object.keys(SECTION_FIELDS) as EditSection[]).filter((s) => sections.has(s));
}
// #endregion

// #region Patches
/**
 * The update a save sends: every field of every dirty section, against `expectedUpdatedAt`. A
 * product carries no delivery model, so `serviceType` travels only when the listing has one.
 */
export function buildPatch(
	draft: ListingDetail,
	fields: readonly PatchField[],
	expectedUpdatedAt: string,
): UpdateListingInput {
	const patch: UpdateListingInput = { id: draft.id, expectedUpdatedAt };
	for (const section of dirtySections(fields)) {
		for (const field of SECTION_FIELDS[section]) {
			if (field === "serviceType") {
				if (draft.serviceType) patch.serviceType = draft.serviceType;
				continue;
			}
			Object.assign(patch, { [field]: draft[field] });
		}
	}
	return patch;
}

/** The patch fields a built patch carries. */
export function patchFieldsOf(patch: UpdateListingInput): PatchField[] {
	return PATCH_FIELDS.filter((field) => field in patch);
}

/**
 * The draft after a save came back. It takes the server's copy, except for an edit still pending: a
 * field changed after the save sent it, or a field the save did not send that differs from `base`
 * (the copy the save was built against). So a value the server normalised (a trimmed tag) does not
 * stay dirty and save forever, and a field the server re-derived (the offer, after the delivery
 * model changed) is not held at its stale shape.
 */
export function reconcileDraft(
	draft: ListingDetail,
	sent: UpdateListingInput,
	server: ListingDetail,
	base: ListingDetail,
): ListingDetail {
	const next: ListingDetail = { ...server };
	const sentValues = sent as Record<string, unknown>;
	for (const field of PATCH_FIELDS) {
		const pending = field in sent
			? !sameValue(sentValues[field], draft[field])
			: !sameValue(base[field], draft[field]);
		if (pending) Object.assign(next, { [field]: draft[field] });
	}
	return next;
}
// #endregion

// #region Save state
/** Where the workspace stands with the server. */
export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

/** What happened to the save cycle. */
export type SaveEvent =
	| { type: "edited" }
	| { type: "started" }
	| { type: "succeeded"; dirty: boolean }
	| { type: "failed" }
	| { type: "conflicted" }
	| { type: "reloaded" };

/**
 * The save state machine. A conflict is sticky: edits keep accumulating but nothing saves until the
 * seller chooses whose copy wins. A failed save waits for the next edit or an explicit retry.
 */
export function nextSaveState(state: SaveState, event: SaveEvent): SaveState {
	switch (event.type) {
		case "edited":
			return state === "conflict" ? "conflict" : state === "saving" ? "saving" : "dirty";
		case "started":
			return "saving";
		case "succeeded":
			return event.dirty ? "dirty" : "saved";
		case "failed":
			return "error";
		case "conflicted":
			return "conflict";
		case "reloaded":
			return "saved";
	}
}

/**
 * Whether a 409 came from this tab rather than another seller's save: every field the server holds
 * is either what this tab last saved or what its last beacon sent. A showcase write and a beacon
 * both move `updatedAt` without this tab learning it; neither is a conflict.
 */
export function isOwnBump(
	server: ListingDetail,
	saved: ListingDetail,
	beacon: Partial<Record<PatchField, unknown>> | null,
): boolean {
	return PATCH_FIELDS.every((field) =>
		sameValue(server[field], saved[field]) ||
		(beacon !== null && field in beacon && sameValue(server[field], beacon[field]))
	);
}
// #endregion

// #region Beacon
/**
 * What a hidden page flushes: the request body, and the values it carries for {@link isOwnBump}.
 */
export interface BeaconFlush {
	json: string;
	sent: Partial<Record<PatchField, unknown>>;
}

/**
 * The beacon for a page being hidden, or `null` when nothing is unsaved or a conflict is waiting on
 * the seller (a beacon must never overwrite another tab's save).
 */
export function beaconFlush(
	saved: ListingDetail,
	draft: ListingDetail,
	state: SaveState,
): BeaconFlush | null {
	if (state === "conflict") return null;
	const fields = diffFields(saved, draft);
	if (fields.length === 0) return null;
	const patch = buildPatch(draft, fields, saved.updatedAt);
	const sent: Partial<Record<PatchField, unknown>> = {};
	for (const field of patchFieldsOf(patch)) sent[field] = draft[field];
	return { json: JSON.stringify(patch), sent };
}
// #endregion

// #region Labels
/** What the footer's save status offers beside its text. */
export type SaveAction = "save" | "retry" | "resolve";

/** The footer's save status text, and the one action it offers, if any. */
export interface SaveLabel {
	text: string;
	action: SaveAction | null;
}

/** `2s ago` · `5m ago` · `3h ago`; `just now` under a second. */
export function ago(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 1) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/**
 * What the footer says about saving, as meta text. Offline, unsaved edits say so and offer nothing:
 * writes are refused until the network returns, so a Save now would only fail.
 */
export function saveLabel(
	state: SaveState,
	savedAt: number | null,
	now: number,
	offline = false,
): SaveLabel {
	switch (state) {
		case "saving":
			return { text: "Saving…", action: null };
		case "dirty":
			return offline
				? { text: "Offline · not saved", action: null }
				: { text: "Unsaved changes", action: "save" };
		case "error":
			return offline
				? { text: "Offline · not saved", action: null }
				: { text: "Couldn't save", action: "retry" };
		case "conflict":
			return { text: "Changed in another tab", action: "resolve" };
		case "saved":
			return { text: savedAt === null ? "Saved" : `Saved · ${ago(now - savedAt)}`, action: null };
	}
}

/**
 * The publish gate as one sentence: `Add a cover image and set a price to publish.` The first
 * imperative keeps its capital; the rest are joined in lower case.
 */
export function readinessSentence(missing: readonly string[]): string {
	if (missing.length === 0) return "Ready to publish.";
	const parts = missing.map((m, i) => (i === 0 ? m : m.charAt(0).toLowerCase() + m.slice(1)));
	const list = parts.length === 1
		? parts[0]
		: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
	return `${list} to publish.`;
}
// #endregion

// #region Tabs
/** The workspace tabs, in header order. */
export const WORKSPACE_TABS: readonly WorkspaceTab[] = ["edit", "preview", "analytics", "clients"];

/** Each tab's name in the header. */
export const TAB_LABELS: Readonly<Record<WorkspaceTab, string>> = {
	edit: "Edit",
	preview: "Preview",
	analytics: "Analytics",
	clients: "Clients",
};

/** The header tab strip's root id; tab `i` is `${WORKSPACE_TABS_ID}-tab-${i}`. */
export const WORKSPACE_TABS_ID = "cat-ws-tabs";
/** The one `role="tabpanel"` the canvas renders for the active tab. */
export const WORKSPACE_PANEL_ID = "cat-ws-panel";
/** The docked panel body the header's Card button controls. */
export const INSPECTOR_ID = "cat-ws-inspector";

/** The id of a tab in the header strip, which names the canvas panel across hydration roots. */
export function workspaceTabId(tab: WorkspaceTab): string {
	return `${WORKSPACE_TABS_ID}-tab-${WORKSPACE_TABS.indexOf(tab)}`;
}
// #endregion

// #region Navigation
/**
 * The workspace URL after a change. A section anchors the Edit tab only, and a chosen buyer belongs
 * to the Clients tab, so moving to another tab drops whichever no longer applies.
 */
export function nextWorkspaceUrl(
	current: WorkspaceUrlState,
	patch: Partial<WorkspaceUrlState>,
): WorkspaceUrlState {
	const next: WorkspaceUrlState = { ...current, ...patch };
	if (next.tab !== "edit") delete next.section;
	if (patch.tab && patch.tab !== current.tab && patch.tab !== "clients" && !patch.client) {
		delete next.client;
	}
	return next;
}
// #endregion

// #region Panel
/** What the workspace's middle-nav panel holds for a URL. */
export type WorkspacePanel = "inspector" | "client" | null;

/**
 * The panel for a workspace URL: nothing on Preview (the frame takes the full width), the client
 * drawer whenever a buyer is chosen, the live card and readiness on Edit, otherwise nothing.
 */
export function workspacePanelOf(url: Pick<WorkspaceUrlState, "tab" | "client">): WorkspacePanel {
	if (url.tab === "preview") return null;
	if (url.client) return "client";
	return url.tab === "edit" ? "inspector" : null;
}
// #endregion

// #region Sections
/** The heading each Edit section shows, and the section rail lists. */
export const SECTION_LABELS: Readonly<Record<EditSection, string>> = {
	media: "Media",
	basics: "Basics",
	offer: "Offer",
	pricing: "Pricing",
	availability: "Availability",
	questions: "Buyer questions",
	seo: "SEO & reach",
};

/** Where a section sits in the viewport, as the scroll-spy measures it. */
export interface SectionTop {
	section: EditSection;
	/** The section's top edge, in px from the viewport's top. */
	top: number;
}

/**
 * The section being read: the last one whose top has passed the reading line, or the last section
 * outright once the page can scroll no further (a short final section never reaches the line).
 * Before the first section reaches it, the first section.
 */
export function activeSectionOf(
	tops: readonly SectionTop[],
	line: number,
	atBottom: boolean,
): EditSection | null {
	if (tops.length === 0) return null;
	if (atBottom) return tops[tops.length - 1].section;
	let active = tops[0].section;
	for (const { section, top } of tops) {
		if (top <= line) active = section;
	}
	return active;
}

/** The DOM id of a section's heading, which `?section=` and the section rail focus. */
export function sectionHeadingId(section: EditSection): string {
	return `cat-sec-${section}-h`;
}
// #endregion
