import { computed, signal } from "@preact/signals";
import { listingCardItem } from "@projective/types/explore";
import {
	type ListingAvailabilityBinding,
	type ListingDetail,
	type ListingMediaSlot,
	type ListingStatus,
	type MediaChoice,
	parseWorkspaceUrl,
	publishReadiness,
	reorderSlots,
	type ShowcaseKeep,
	type UpdateListingInput,
	withoutSlot,
	WORKSPACE_DEFAULTS,
	workspaceHref,
	type WorkspaceUrlState,
} from "../types/catalogue-types.ts";
import { flattenRichText } from "@projective/types/richtext";
import type { CatalogueResult } from "../types/results.ts";
import { CatalogueService } from "./CatalogueService.ts";
import { WorkspaceService } from "./WorkspaceService.ts";
import {
	beaconFlush,
	buildPatch,
	diffFields,
	isOwnBump,
	nextSaveState,
	nextWorkspaceUrl,
	PATCH_FIELDS,
	type PatchField,
	reconcileDraft,
	type SaveEvent,
	type SaveState,
	workspacePanelOf,
} from "./workspace-model.ts";

/**
 * workspace-store — the item workspace's shared state (plan §6.4). The workspace renders several
 * hydration roots (the lane outline, the header band, the canvas, the footer rig and the panel), so
 * they coordinate through these module signals. `ListingWorkspace` hydrates them from the SSR read;
 * the other islands paint from their own SSR props until it has.
 *
 * The store is the ONE network owner for the listing: it autosaves 800 ms after the last edit with
 * a section-scoped patch against `expectedUpdatedAt`, flushes through a beacon when the page is
 * hidden, serialises the showcase writes and lifecycle changes behind any pending save, and turns a
 * 409 into either a silent retry (our own beacon or showcase write moved `updatedAt`) or a conflict
 * the seller resolves. The rules are pure, in `workspace-model.ts`.
 */

// #region Dependencies
/** The network calls the store makes; tests substitute a fake. */
export interface WorkspaceTransport {
	update(patch: UpdateListingInput): Promise<CatalogueResult<{ listing: ListingDetail }>>;
	detail(id: string): Promise<CatalogueResult<{ listing: ListingDetail }>>;
	setStatus(
		id: string,
		status: ListingStatus,
	): Promise<CatalogueResult<{ listing: ListingDetail }>>;
	applyMedia(
		listingId: string,
		choices: MediaChoice[],
	): Promise<CatalogueResult<ListingMediaSlot[]>>;
	reorderMedia(listingId: string, order: number[]): Promise<CatalogueResult<ListingMediaSlot[]>>;
	saveShowcase(
		listingId: string,
		slots: ShowcaseKeep[],
	): Promise<CatalogueResult<ListingMediaSlot[]>>;
}

/** Time and timers; tests substitute a manual clock. */
export interface WorkspaceClock {
	now(): number;
	set(run: () => void, ms: number): number;
	clear(id: number): void;
}

/** Sends a beacon body to a URL; `false` when the browser refused to queue it. */
export type BeaconSender = (url: string, body: string) => boolean;

const liveTransport: WorkspaceTransport = {
	update: (patch) => CatalogueService.update(patch),
	detail: (id) => CatalogueService.detail(id),
	setStatus: (id, status) => CatalogueService.setStatus(id, status),
	applyMedia: (listingId, choices) => WorkspaceService.applyMedia({ listingId, choices }),
	reorderMedia: (listingId, order) => WorkspaceService.reorderMedia({ listingId, order }),
	saveShowcase: (listingId, slots) => WorkspaceService.saveShowcase({ listingId, slots }),
};

const liveTimers = new Map<number, ReturnType<typeof setTimeout>>();
let liveTimerSeq = 0;

const liveClock: WorkspaceClock = {
	now: () => Date.now(),
	set(run, ms) {
		const id = ++liveTimerSeq;
		liveTimers.set(
			id,
			setTimeout(() => {
				liveTimers.delete(id);
				run();
			}, ms),
		);
		return id;
	},
	clear(id) {
		clearTimeout(liveTimers.get(id));
		liveTimers.delete(id);
	},
};

let transport = liveTransport;
let clock = liveClock;

/** Replace the transport and clock (tests), or restore the live ones with no arguments. */
export function configureWorkspace(
	deps: { transport?: WorkspaceTransport; clock?: WorkspaceClock } = {},
): void {
	transport = deps.transport ?? liveTransport;
	clock = deps.clock ?? liveClock;
}

/** The debounce between the last edit and its save. */
export const SAVE_DEBOUNCE_MS = 800;

/** Where a beacon flush is sent. */
export const UPDATE_URL = "/api/catalogue/update";
// #endregion

// #region Signals
/** The workspace URL state (tab, section, client…), kept in step with `history`. */
export const workspaceUrl = signal<WorkspaceUrlState>(WORKSPACE_DEFAULTS);
/** The listing as the server last acknowledged it. */
export const saved = signal<ListingDetail | null>(null);
/** The listing as the seller is editing it. */
export const draft = signal<ListingDetail | null>(null);
/** Where the workspace stands with the server. */
export const saveState = signal<SaveState>("saved");
/** When the last save landed (epoch ms), for "Saved · 2s ago". */
export const savedAt = signal<number | null>(null);
/** Why the last save failed, while {@link saveState} is `error`. */
export const saveError = signal<string | null>(null);
/** The server's copy while {@link saveState} is `conflict`, when it could be read. */
export const conflictCopy = signal<ListingDetail | null>(null);
/** The lifecycle change in flight, if any. */
export const statusBusy = signal<ListingStatus | null>(null);
/** The last lifecycle or showcase outcome worth saying aloud. */
export const notice = signal<string | null>(null);
/**
 * Bumped whenever the draft is replaced wholesale (Reload theirs). The Edit fields seed once from
 * the draft, so the canvas is keyed on this and re-seeds them.
 */
export const revision = signal(0);
/**
 * Whether the workspace store has been hydrated in this page; until then islands paint SSR props.
 */
export const workspaceReady = signal(false);
/**
 * Whether the conflict choice is being offered (raised by a stale save, reopened from the header).
 */
export const conflictPrompt = signal(false);
/** The patch fields the draft holds unsaved. */
export const dirtyFields = computed<PatchField[]>(() =>
	saved.value && draft.value ? diffFields(saved.value, draft.value) : []
);
/**
 * Bookable windows the session listing's availability opens in the next 30 days, once the
 * Availability section has evaluated it; `undefined` until then, which the gate skips.
 */
export const upcomingWindows = signal<number | undefined>(undefined);
/** The publish gate over the draft. */
export const readiness = computed(() =>
	draft.value ? publishReadiness(draft.value, { upcomingWindows: upcomingWindows.value }) : null
);
/** The live card the panel renders, from the draft on every keystroke. */
export const cardItem = computed(() => (draft.value ? listingCardItem(draft.value) : null));
// #endregion

// #region Internals
let timer: number | null = null;
let inflight: Promise<void> | null = null;
let beacon: Partial<Record<PatchField, unknown>> | null = null;
let hydratedKey: string | null = null;

function transition(event: SaveEvent): void {
	saveState.value = nextSaveState(saveState.peek(), event);
}

function cancelTimer(): void {
	if (timer !== null) clock.clear(timer);
	timer = null;
}

function schedule(): void {
	cancelTimer();
	if (saveState.peek() === "conflict") return;
	timer = clock.set(() => {
		timer = null;
		void flush();
	}, SAVE_DEBOUNCE_MS);
}

/**
 * Take the server's copy for everything the seller is not editing; keep the draft's patch fields.
 */
function adopt(server: ListingDetail): void {
	const current = draft.peek();
	const next: ListingDetail = { ...server };
	if (current) {
		for (const field of PATCH_FIELDS) {
			Object.assign(next, { [field]: current[field] });
		}
	}
	saved.value = server;
	draft.value = next;
}

function conflictOf<T>(res: CatalogueResult<T>): boolean {
	return !res.ok && !!res.details && "current" in res.details;
}

async function save(retried: boolean): Promise<void> {
	const base = saved.peek();
	const current = draft.peek();
	if (!base || !current || saveState.peek() === "conflict") return;
	const fields = diffFields(base, current);
	if (fields.length === 0) {
		transition({ type: "succeeded", dirty: false });
		return;
	}
	const patch = buildPatch(current, fields, base.updatedAt);
	transition({ type: "started" });
	const res = await transport.update(patch);

	if (res.ok && res.data) {
		const server = res.data.listing;
		const next = reconcileDraft(draft.peek() ?? current, patch, server, base);
		saved.value = server;
		draft.value = next;
		beacon = null;
		savedAt.value = clock.now();
		saveError.value = null;
		transition({ type: "succeeded", dirty: diffFields(server, next).length > 0 });
		if (saveState.peek() === "dirty") schedule();
		return;
	}

	if (conflictOf(res)) {
		const fresh = await transport.detail(current.id);
		const server = fresh.ok ? fresh.data?.listing ?? null : null;
		const known = saved.peek();
		if (server && known && !retried && isOwnBump(server, known, beacon)) {
			adopt(server);
			beacon = null;
			await save(true);
			return;
		}
		conflictCopy.value = server;
		transition({ type: "conflicted" });
		conflictPrompt.value = true;
		return;
	}

	saveError.value = res.message ?? "That didn't save.";
	transition({ type: "failed" });
}

function setMedia(slots: ListingMediaSlot[]): void {
	const s = saved.peek();
	const d = draft.peek();
	if (s) saved.value = { ...s, media: slots };
	if (d) draft.value = { ...d, media: slots };
}
// #endregion

// #region Lifecycle
/**
 * Seed the store from the SSR read. Idempotent for the same listing and version, so every island
 * may call it; a different listing (or a newer read of it) resets the store.
 */
export function hydrateWorkspace(initial: ListingDetail, url: WorkspaceUrlState): void {
	const key = `${initial.id}|${initial.updatedAt}`;
	if (hydratedKey === key) return;
	hydratedKey = key;
	cancelTimer();
	inflight = null;
	beacon = null;
	workspaceUrl.value = url;
	saved.value = initial;
	draft.value = initial;
	saveState.value = "saved";
	savedAt.value = null;
	saveError.value = null;
	conflictCopy.value = null;
	statusBusy.value = null;
	notice.value = null;
	conflictPrompt.value = false;
	upcomingWindows.value = undefined;
	workspaceReady.value = true;
}

/**
 * The listing an island paints: the live draft once hydrated for this listing, else its SSR copy.
 */
export function liveListing(ssr: ListingDetail): ListingDetail {
	const current = draft.value;
	return current && current.id === ssr.id ? current : ssr;
}

/** Forget the hydrated listing (tests, or leaving the workspace). */
export function resetWorkspace(): void {
	cancelTimer();
	hydratedKey = null;
	inflight = null;
	beacon = null;
	saved.value = null;
	draft.value = null;
	saveState.value = "saved";
	savedAt.value = null;
	saveError.value = null;
	conflictCopy.value = null;
	statusBusy.value = null;
	notice.value = null;
	conflictPrompt.value = false;
	upcomingWindows.value = undefined;
	workspaceReady.value = false;
}
// #endregion

// #region Editing
/** Change one field of the draft, mark it unsaved and schedule the debounced save. */
export function edit<K extends PatchField>(key: K, value: ListingDetail[K]): void {
	const current = draft.peek();
	if (!current) return;
	draft.value = { ...current, [key]: value };
	transition({ type: "edited" });
	schedule();
}

/**
 * Change the rich description. The plain-text snippet the card and the search preview fall back to
 * follows it at once; the server derives its own copy on save.
 */
export function editDescription(html: string): void {
	const current = draft.peek();
	if (!current) return;
	draft.value = {
		...current,
		description: html,
		descriptionText: flattenRichText(html).slice(0, 4000),
	};
	transition({ type: "edited" });
	schedule();
}

/**
 * Save now: cancel the debounce, wait for a save in flight, then save whatever is still unsaved.
 * Resolves when the workspace is as saved as it can be.
 */
export async function flush(): Promise<void> {
	cancelTimer();
	while (inflight) await inflight;
	const state = saveState.peek();
	if (state !== "dirty" && state !== "error") return;
	inflight = save(false).finally(() => {
		inflight = null;
	});
	await inflight;
}

/** Retry a failed save. */
export function retry(): Promise<void> {
	return flush();
}

/**
 * Flush unsaved edits through a beacon as the page is hidden. The beacon's values are remembered,
 * so the 409 its own landing causes on the next save is recognised and retried silently.
 */
export function flushBeacon(send: BeaconSender): boolean {
	const base = saved.peek();
	const current = draft.peek();
	if (!base || !current) return false;
	const flushed = beaconFlush(base, current, saveState.peek());
	if (!flushed) return false;
	cancelTimer();
	const queued = send(UPDATE_URL, flushed.json);
	if (queued) beacon = { ...(beacon ?? {}), ...flushed.sent };
	return queued;
}

/** The page is visible again: resume the save a beacon flush interrupted. */
export function resume(): void {
	if (saveState.peek() === "dirty") schedule();
}
// #endregion

// #region Conflict
/** Resolve a conflict: take the other tab's copy, discarding these edits. */
export async function reloadTheirs(): Promise<void> {
	let server = conflictCopy.peek();
	const current = draft.peek();
	if (!server && current) {
		const res = await transport.detail(current.id);
		server = res.ok ? res.data?.listing ?? null : null;
	}
	if (!server) {
		notice.value = "The latest copy couldn't be loaded. Try again.";
		return;
	}
	saved.value = server;
	draft.value = server;
	conflictCopy.value = null;
	beacon = null;
	savedAt.value = clock.now();
	revision.value += 1;
	transition({ type: "reloaded" });
}

/** Resolve a conflict: save these edits over the other tab's, against its `updatedAt`. */
export async function overwriteWithMine(): Promise<void> {
	let server = conflictCopy.peek();
	const current = draft.peek();
	if (!server && current) {
		const res = await transport.detail(current.id);
		server = res.ok ? res.data?.listing ?? null : null;
	}
	if (!server) {
		notice.value = "The latest copy couldn't be loaded. Try again.";
		return;
	}
	saved.value = server;
	conflictCopy.value = null;
	beacon = null;
	saveState.value = "dirty";
	await flush();
}
// #endregion

// #region Lifecycle status
/** Move the listing through its lifecycle, after saving what the seller typed. */
export async function requestStatus(next: ListingStatus): Promise<void> {
	if (statusBusy.peek()) return;
	statusBusy.value = next;
	notice.value = null;
	try {
		await flush();
		const state = saveState.peek();
		if (state === "conflict" || state === "error") {
			notice.value = "Save your changes before changing the status.";
			return;
		}
		const current = draft.peek();
		if (!current) return;
		const res = await transport.setStatus(current.id, next);
		if (res.ok && res.data) {
			adopt(res.data.listing);
			notice.value = res.message ?? null;
			return;
		}
		notice.value = res.message ?? "The status couldn't be changed.";
	} finally {
		statusBusy.value = null;
	}
}
// #endregion

// #region Showcase
/**
 * Cut picked library assets into their slots. Resolves `null` on success (the picker closes) or the
 * sentence to show (it stays open).
 */
export async function applyMedia(choices: MediaChoice[]): Promise<string | null> {
	const current = draft.peek();
	if (!current || choices.length === 0) return null;
	const res = await transport.applyMedia(current.id, choices);
	if (res.ok && res.data) {
		setMedia(res.data);
		notice.value = res.message ?? null;
		return null;
	}
	return res.message ?? "That didn't go into the showcase. Try again.";
}

/** Move the item at `from` onto `to`, showing the move at once and undoing it if refused. */
export async function reorderMedia(order: number[]): Promise<void> {
	const current = draft.peek();
	if (!current) return;
	const before = current.media;
	const moved = reorderSlots(before, order);
	if (!moved.ok) {
		notice.value = moved.reason;
		return;
	}
	setMedia(moved.slots);
	const res = await transport.reorderMedia(current.id, order);
	if (res.ok && res.data) {
		setMedia(res.data);
		return;
	}
	setMedia(before);
	notice.value = res.message ?? "The showcase couldn't be reordered.";
}

async function saveSlots(next: ListingMediaSlot[], failure: string): Promise<boolean> {
	const current = draft.peek();
	if (!current) return false;
	const before = current.media;
	setMedia(next);
	const res = await transport.saveShowcase(
		current.id,
		next.map((s) => ({ position: s.position, fileId: s.fileId, alt: s.alt })),
	);
	if (res.ok && res.data) {
		setMedia(res.data);
		return true;
	}
	setMedia(before);
	notice.value = res.message ?? failure;
	return false;
}

/** Empty a slot; emptying the cover promotes the next still into it. */
export async function removeMedia(position: number): Promise<boolean> {
	const current = draft.peek();
	if (!current) return false;
	const ok = await saveSlots(
		withoutSlot(current.media, position),
		"That slot couldn't be emptied.",
	);
	if (ok) notice.value = `Showcase slot ${position} emptied.`;
	return ok;
}

/** Change one slot's alt text. */
export async function setMediaAlt(position: number, alt: string): Promise<boolean> {
	const current = draft.peek();
	if (!current) return false;
	const next = current.media.map((s) => (s.position === position ? { ...s, alt } : s));
	return await saveSlots(next, "The description couldn't be saved.");
}
// #endregion

// #region Availability
/**
 * Take the availability binding its own route just wrote. It is not a patch field, so it lands on
 * both the saved and the draft copy without marking anything unsaved.
 */
export function setAvailabilityBinding(binding: ListingAvailabilityBinding | null): void {
	const s = saved.peek();
	const d = draft.peek();
	if (s) saved.value = { ...s, availabilityBinding: binding };
	if (d) draft.value = { ...d, availabilityBinding: binding };
}
// #endregion

// #region URL
interface HistoryPort {
	readonly state: unknown;
	pushState(data: unknown, unused: string, url?: string): void;
	replaceState(data: unknown, unused: string, url?: string): void;
}

interface LocationPort {
	readonly href: string;
	readonly pathname: string;
	readonly search: string;
	assign(url: string): void;
	reload(): void;
}

function historyPort(): HistoryPort | null {
	return (globalThis as { history?: HistoryPort }).history ?? null;
}

function locationPort(): LocationPort | null {
	return (globalThis as { location?: LocationPort }).location ?? null;
}

/**
 * Fresh's history marker: an entry flagged `fClientNav: true` is replayed as a partial navigation
 * on traversal (partials are off, Decision #52), so every entry the workspace writes says `false`.
 */
function entryState(history: HistoryPort): Record<string, unknown> {
	const current = history.state;
	const base = current && typeof current === "object" ? current as Record<string, unknown> : {};
	return { ...base, fClientNav: false };
}

let panelMounted = false;
let syncing = false;

/** The panel island says this page's frame carries the workspace panel. */
export function markPanelMounted(): void {
	panelMounted = true;
}

function writeLocation(state: WorkspaceUrlState, mode: "push" | "replace"): void {
	const history = historyPort();
	const location = locationPort();
	const slug = draft.peek()?.id;
	if (!history || !location || !slug) return;
	const next = workspaceHref(slug, state);
	if (next === location.pathname + location.search) return;
	if (mode === "push") {
		history.replaceState(entryState(history), "", location.pathname + location.search);
		history.pushState(entryState(history), "", next);
	} else {
		history.replaceState(entryState(history), "", next);
	}
}

/**
 * Move the workspace to a new URL state: a tab switch pushes an entry, the scroll-spy's section
 * replaces it. A tab whose panel this page's frame was rendered without (the page opened on
 * Preview) is a full navigation, because the panel is resolved by the server.
 */
export function setWorkspaceUrl(patch: Partial<WorkspaceUrlState>, mode: "push" | "replace"): void {
	const next = nextWorkspaceUrl(workspaceUrl.peek(), patch);
	const slug = draft.peek()?.id;
	if (mode === "push" && slug && !panelMounted && workspacePanelOf(next) !== null) {
		locationPort()?.assign(workspaceHref(slug, next));
		return;
	}
	workspaceUrl.value = next;
	writeLocation(next, mode);
}

function readLocation(): void {
	const location = locationPort();
	if (!location) return;
	const next = parseWorkspaceUrl(new URL(location.href));
	if (!panelMounted && workspacePanelOf(next) !== null) {
		location.reload();
		return;
	}
	workspaceUrl.value = next;
}

/** Follow Back and Forward between workspace tabs. Idempotent; only the first call listens. */
export function startWorkspaceSync(): void {
	if (syncing) return;
	syncing = true;
	globalThis.addEventListener?.("popstate", readLocation);
}
// #endregion
