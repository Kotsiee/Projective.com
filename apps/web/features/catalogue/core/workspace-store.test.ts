import { assert, assertEquals } from "@std/assert";
import {
	type ListingDetail,
	ListingDetailSchema,
	type ListingMediaSlot,
	type UpdateListingInput,
	UpdateListingInputSchema,
	WORKSPACE_DEFAULTS,
} from "../types/catalogue-types.ts";
import type { CatalogueResult } from "../types/results.ts";
import {
	activeSectionOf,
	beaconFlush,
	buildPatch,
	diffFields,
	isOwnBump,
	nextSaveState,
	nextWorkspaceUrl,
	readinessSentence,
	reconcileDraft,
	saveLabel,
	type SaveState,
	workspacePanelOf,
} from "./workspace-model.ts";
import {
	autoSaveEnabled,
	configureWorkspace,
	conflictCopy,
	draft,
	edit,
	flush,
	flushBeacon,
	hydrateWorkspace,
	overwriteWithMine,
	reloadTheirs,
	notice,
	removeMedia,
	requestStatus,
	resetWorkspace,
	retry,
	saved,
	saveState,
	setAutoSave,
	UPDATE_URL,
	type WorkspaceTransport,
} from "./workspace-store.ts";

// #region Fixtures
const T0 = "2026-10-14T09:00:00.000Z";
const T1 = "2026-10-14T09:00:05.000Z";
const T2 = "2026-10-14T09:00:09.000Z";

function listing(overrides: Record<string, unknown> = {}): ListingDetail {
	return ListingDetailSchema.parse({
		id: "svc-23456789ab",
		ownerId: "maris",
		kind: "service",
		serviceType: "One-Off",
		title: "Brand identity sprint",
		category: "",
		status: "draft",
		currency: "GBP",
		cover: null,
		price: { mode: "fixed", display: "£1,200" },
		metrics: {
			views: 0,
			orders: 0,
			revenue: 0,
			revenueLabel: "£0",
			avgRating: 0,
			ratingCount: 0,
			trend: [],
		},
		updatedAt: T0,
		updatedLabel: "Edited today",
		promoted: false,
		needsAttention: false,
		owner: { handle: "maris", name: "Maris Okafor", avatar: "", kind: "freelancer" },
		description: "<p>Logo, palette and type.</p>",
		descriptionText: "Logo, palette and type.",
		media: [],
		skills: [],
		tags: ["branding"],
		pricing: {
			amount: 1200,
			ticketPrice: null,
			sessionPrice: null,
			seatsPerSession: null,
			freeRevisions: null,
			extraRevisionPrice: null,
		},
		delivery: "",
		createCategory: null,
		offer: { archetype: "one_off", milestones: [], turnaroundDays: null, scope: [], teamRoles: [] },
		seo: { seoTitle: "", seoDescription: "" },
		availabilityBinding: null,
		collections: [],
		...overrides,
	});
}

function slot(position: number, kind: "image" | "video" = "image"): ListingMediaSlot {
	return {
		position,
		kind,
		fileId: crypto.randomUUID(),
		thumb: `/t/${position}.webp`,
		src: `/s/${position}`,
		alt: "",
	};
}

const okListing = (l: ListingDetail): CatalogueResult<{ listing: ListingDetail }> => ({
	ok: true,
	data: { listing: l },
});

const STALE: CatalogueResult<{ listing: ListingDetail }> = {
	ok: false,
	message: "This listing changed in another tab.",
	details: { current: T1 },
};

/** A transport whose answers the test scripts, recording every call. */
function fakeTransport(server: { listing: ListingDetail }) {
	const updates: UpdateListingInput[] = [];
	const showcases: Array<Array<{ position: number; fileId: string; alt: string }>> = [];
	let nextUpdate: Array<CatalogueResult<{ listing: ListingDetail }> | null> = [];
	const transport: WorkspaceTransport = {
		update(patch) {
			updates.push(patch);
			const scripted = nextUpdate.shift();
			if (scripted) return Promise.resolve(scripted);
			if (patch.expectedUpdatedAt !== server.listing.updatedAt) return Promise.resolve(STALE);
			const { id: _id, expectedUpdatedAt: _at, ...fields } = patch;
			server.listing = { ...server.listing, ...fields, updatedAt: T2 };
			return Promise.resolve(okListing(server.listing));
		},
		detail: () => Promise.resolve(okListing(server.listing)),
		setStatus: () => Promise.resolve(okListing(server.listing)),
		applyMedia: () => Promise.resolve({ ok: true, data: server.listing.media }),
		reorderMedia: () => Promise.resolve({ ok: true, data: server.listing.media }),
		saveShowcase(_id, slots) {
			showcases.push(slots);
			const kept = slots.map((k) => {
				const found = server.listing.media.find((m) => m.fileId === k.fileId);
				return { ...found!, position: k.position, alt: k.alt };
			});
			server.listing = { ...server.listing, media: kept, updatedAt: T1 };
			return Promise.resolve({ ok: true, data: kept });
		},
	};
	return {
		transport,
		updates,
		showcases,
		script: (...results: Array<CatalogueResult<{ listing: ListingDetail }> | null>) => {
			nextUpdate = results;
		},
	};
}

/** Timers that only fire when the test says so. */
function manualClock() {
	const timers = new Map<number, () => void>();
	let id = 0;
	return {
		now: () => 1_000,
		set(run: () => void) {
			timers.set(++id, run);
			return id;
		},
		clear(handle: number) {
			timers.delete(handle);
		},
		fire() {
			const runs = [...timers.values()];
			timers.clear();
			runs.forEach((run) => run());
		},
		get pending() {
			return timers.size;
		},
	};
}

function setup(initial = listing()) {
	resetWorkspace();
	const server = { listing: initial };
	const fake = fakeTransport(server);
	const clock = manualClock();
	configureWorkspace({ transport: fake.transport, clock });
	hydrateWorkspace(initial, WORKSPACE_DEFAULTS);
	return { server, fake, clock };
}
// #endregion

// #region Dirty diffing
Deno.test("diffFields: nothing is dirty until a patch field differs", () => {
	const base = listing();
	assertEquals(diffFields(base, base), []);
	assertEquals(diffFields(base, { ...base, title: "Brand sprint" }), ["title"]);
	assertEquals(diffFields(base, { ...base, status: "published", updatedAt: T2 }), []);
});

Deno.test("diffFields: object fields compare by value, not key order", () => {
	const base = listing();
	const reordered = { ...base, seo: { seoDescription: "", seoTitle: "" } };
	assertEquals(diffFields(base, reordered), []);
	assertEquals(diffFields(base, { ...base, seo: { seoTitle: "Logos", seoDescription: "" } }), [
		"seo",
	]);
	assertEquals(diffFields(base, { ...base, tags: ["branding", "logo"] }), ["tags"]);
});
// #endregion

// #region Section patches
Deno.test("buildPatch sends every field of each dirty section and nothing else", () => {
	const base = listing();
	const seoOnly = { ...base, seo: { seoTitle: "Logo design", seoDescription: "" } };
	const patch = buildPatch(seoOnly, diffFields(base, seoOnly), T0);
	assertEquals(Object.keys(patch).sort(), ["expectedUpdatedAt", "id", "seo", "tags"]);
	assertEquals(patch.expectedUpdatedAt, T0);

	const titled = { ...base, title: "Logo sprint" };
	const basics = buildPatch(titled, diffFields(base, titled), T0);
	assertEquals(Object.keys(basics).sort(), [
		"createCategory",
		"description",
		"expectedUpdatedAt",
		"id",
		"serviceType",
		"skills",
		"title",
	]);
	assertEquals(UpdateListingInputSchema.safeParse(basics).success, true);
});

Deno.test("buildPatch leaves the delivery model off a product", () => {
	const product = listing({
		id: "prd-23456789ab",
		kind: "product",
		serviceType: null,
		offer: {
			archetype: "product",
			format: "download",
			licence: "personal",
			attributionRequired: false,
			attachments: [],
		},
	});
	const edited = { ...product, title: "Icon pack" };
	const patch = buildPatch(edited, diffFields(product, edited), T0);
	assertEquals("serviceType" in patch, false);
	assertEquals(patch.title, "Icon pack");
});

Deno.test("reconcileDraft adopts what the server normalised and keeps later edits", () => {
	const base = listing();
	const typed = { ...base, tags: ["branding", " logo "], title: "Logo sprint" };
	const sent = buildPatch(typed, diffFields(base, typed), T0);
	const server = { ...typed, tags: ["branding", "logo"], updatedAt: T2 };
	const editedSince = { ...typed, title: "Logo sprint, fast" };
	const next = reconcileDraft(editedSince, sent, server, base);
	assertEquals(next.tags, ["branding", "logo"]);
	assertEquals(next.title, "Logo sprint, fast");
	assertEquals(next.updatedAt, T2);
});

Deno.test("reconcileDraft takes a field the server re-derived when the seller left it alone", () => {
	const base = listing();
	const typed = { ...base, serviceType: "Session" as const };
	const sent = buildPatch(typed, diffFields(base, typed), T0);
	const offer = { archetype: "session", minutes: 60, count: 1, meetingProvider: null };
	const server = ListingDetailSchema.parse({ ...typed, offer, updatedAt: T2 });
	assertEquals(reconcileDraft(typed, sent, server, base).offer, server.offer);
	const editedOffer = { ...typed, tags: ["mine"] };
	assertEquals(reconcileDraft(editedOffer, sent, server, base).tags, ["mine"]);
});
// #endregion

// #region Save state transitions
Deno.test("nextSaveState: edits, saves, failures and conflicts", () => {
	const step = (
		from: SaveState,
		type: "edited" | "started" | "failed" | "conflicted" | "reloaded",
	) => nextSaveState(from, { type });
	assertEquals(step("saved", "edited"), "dirty");
	assertEquals(step("dirty", "started"), "saving");
	assertEquals(step("saving", "edited"), "saving");
	assertEquals(nextSaveState("saving", { type: "succeeded", dirty: false }), "saved");
	assertEquals(nextSaveState("saving", { type: "succeeded", dirty: true }), "dirty");
	assertEquals(step("saving", "failed"), "error");
	assertEquals(step("error", "edited"), "dirty");
	assertEquals(step("saving", "conflicted"), "conflict");
	assertEquals(step("conflict", "edited"), "conflict");
	assertEquals(step("conflict", "reloaded"), "saved");
});

Deno.test("isOwnBump: only fields this tab saved or beaconed count as ours", () => {
	const base = listing();
	const bumped = { ...base, updatedAt: T1, media: [slot(1)] };
	assertEquals(isOwnBump(bumped, base, null), true);
	const beaconed = { ...base, title: "Logo sprint", updatedAt: T1 };
	assertEquals(isOwnBump(beaconed, base, null), false);
	assertEquals(isOwnBump(beaconed, base, { title: "Logo sprint" }), true);
	assertEquals(isOwnBump({ ...beaconed, tags: [] }, base, { title: "Logo sprint" }), false);
});
// #endregion

// #region Beacon payload
Deno.test("beaconFlush: nothing to send when clean or in conflict", () => {
	const base = listing();
	assertEquals(beaconFlush(base, base, "saved"), null);
	assertEquals(beaconFlush(base, { ...base, title: "x" }, "conflict"), null);
});

Deno.test("beaconFlush: a section patch the update route accepts, and the values it carries", () => {
	const base = listing();
	const typed = { ...base, seo: { seoTitle: "Logo design", seoDescription: "Fast." } };
	const flushed = beaconFlush(base, typed, "dirty");
	assert(flushed);
	const body = JSON.parse(flushed.json);
	assertEquals(UpdateListingInputSchema.safeParse(body).success, true);
	assertEquals(body.expectedUpdatedAt, T0);
	assertEquals(Object.keys(flushed.sent).sort(), ["seo", "tags"]);
});
// #endregion

// #region Store
Deno.test("store: an edit saves after the debounce with a section patch", async () => {
	const { fake, clock } = setup();
	edit("title", "Logo sprint");
	assertEquals(saveState.value, "dirty");
	assertEquals(clock.pending, 1);
	clock.fire();
	await flush();
	assertEquals(fake.updates.length, 1);
	assertEquals(fake.updates[0].title, "Logo sprint");
	assertEquals(fake.updates[0].expectedUpdatedAt, T0);
	assertEquals(saveState.value, "saved");
	assertEquals(saved.value?.updatedAt, T2);
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: with auto-save off an edit waits for Save now, and switching it on saves", async () => {
	const { fake, clock } = setup();
	setAutoSave(false);
	edit("title", "Logo sprint");
	assertEquals(saveState.value, "dirty");
	assertEquals(clock.pending, 0);
	assertEquals(flushBeacon(() => true), false);
	setAutoSave(true);
	assertEquals(clock.pending, 1);
	clock.fire();
	await flush();
	assertEquals(fake.updates.length, 1);
	assertEquals(saveState.value, "saved");
	setAutoSave(false);
	edit("title", "Logo sprint II");
	await flush();
	assertEquals(fake.updates.length, 2);
	assertEquals(saveState.value, "saved");
	autoSaveEnabled.value = true;
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: a stale save from another tab enters conflict, and edits wait", async () => {
	const { fake, server, clock } = setup();
	server.listing = { ...server.listing, title: "Their title", updatedAt: T1 };
	edit("title", "My title");
	await flush();
	assertEquals(saveState.value, "conflict");
	assertEquals(conflictCopy.value?.title, "Their title");
	edit("tags", ["mine"]);
	assertEquals(clock.pending, 0);
	assertEquals(saveState.value, "conflict");

	await overwriteWithMine();
	const last = fake.updates[fake.updates.length - 1];
	assertEquals(last.expectedUpdatedAt, T1);
	assertEquals(last.title, "My title");
	assertEquals(last.tags, ["mine"]);
	assertEquals(saveState.value, "saved");
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: Reload theirs discards local edits", async () => {
	const { server } = setup();
	server.listing = { ...server.listing, title: "Their title", updatedAt: T1 };
	edit("title", "My title");
	await flush();
	assertEquals(saveState.value, "conflict");
	await reloadTheirs();
	assertEquals(draft.value?.title, "Their title");
	assertEquals(saved.value?.updatedAt, T1);
	assertEquals(saveState.value, "saved");
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: a 409 our own beacon caused is retried silently", async () => {
	const { fake, server } = setup();
	edit("title", "Logo sprint");
	const sent: Array<[string, string]> = [];
	assertEquals(flushBeacon((url, body) => (sent.push([url, body]), true)), true);
	assertEquals(sent[0][0], UPDATE_URL);
	server.listing = { ...server.listing, title: "Logo sprint", updatedAt: T1 };
	edit("tags", ["branding", "logo"]);
	await flush();
	assertEquals(saveState.value, "saved");
	assertEquals(conflictCopy.value, null);
	const last = fake.updates[fake.updates.length - 1];
	assertEquals(last.expectedUpdatedAt, T1);
	assertEquals(last.tags, ["branding", "logo"]);
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: a showcase write that moved updatedAt is not a conflict", async () => {
	const { server } = setup(listing({ media: [slot(1), slot(2)] }));
	assertEquals(await removeMedia(2), true);
	assertEquals(server.listing.updatedAt, T1);
	edit("title", "Logo sprint");
	await flush();
	assertEquals(saveState.value, "saved");
	assertEquals(draft.value?.title, "Logo sprint");
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: a failed save waits for Retry", async () => {
	const { fake } = setup();
	fake.script({ ok: false, message: "Network error — please try again." });
	edit("title", "Logo sprint");
	await flush();
	assertEquals(saveState.value, "error");
	await retry();
	assertEquals(saveState.value, "saved");
	assertEquals(fake.updates.length, 2);
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: requestStatus reports a commit, and refuses while a save has failed", async () => {
	const { fake } = setup();
	assertEquals(await requestStatus("published"), true);
	fake.script({ ok: false, message: "Network error — please try again." });
	edit("title", "Logo sprint");
	assertEquals(await requestStatus("paused"), false);
	assertEquals(notice.value, "Save your changes before changing the status.");
	resetWorkspace();
	configureWorkspace();
});

Deno.test("store: emptying the cover promotes the next still and sends the kept items", async () => {
	const [cover, video, still] = [slot(1), slot(2, "video"), slot(3)];
	const { fake } = setup(listing({ media: [cover, video, still] }));
	await removeMedia(1);
	assertEquals(fake.showcases[0].map((k) => [k.fileId, k.position]), [
		[still.fileId, 1],
		[video.fileId, 2],
	]);
	assertEquals(draft.value?.media.map((m) => m.position), [1, 2]);
	resetWorkspace();
	configureWorkspace();
});
// #endregion

// #region Labels and panel
Deno.test("saveLabel and readinessSentence read as meta text", () => {
	assertEquals(saveLabel("saved", 1_000, 3_400), { text: "Saved · 2s ago", action: null });
	assertEquals(saveLabel("saving", null, 0).text, "Saving…");
	assertEquals(saveLabel("dirty", null, 0), { text: "Unsaved changes", action: "save" });
	assertEquals(saveLabel("error", null, 0), { text: "Couldn't save", action: "retry" });
	assertEquals(saveLabel("conflict", null, 0).action, "resolve");
	assertEquals(saveLabel("error", null, 0, true), { text: "Offline · not saved", action: null });
	assertEquals(saveLabel("dirty", null, 0, true).action, null);
	assertEquals(readinessSentence([]), "Ready to publish.");
	assertEquals(readinessSentence(["Set a price"]), "Set a price to publish.");
	assertEquals(
		readinessSentence(["Add a cover image", "Set a price"]),
		"Add a cover image and set a price to publish.",
	);
});

Deno.test("workspacePanelOf: inspector on Edit, client drawer on ?client=, none on Preview", () => {
	assertEquals(workspacePanelOf({ tab: "edit" }), "inspector");
	assertEquals(workspacePanelOf({ tab: "clients", client: "@ada" }), "client");
	assertEquals(workspacePanelOf({ tab: "edit", client: "@ada" }), "client");
	assertEquals(workspacePanelOf({ tab: "preview" }), null);
	assertEquals(workspacePanelOf({ tab: "preview", client: "@ada" }), null);
	assertEquals(workspacePanelOf({ tab: "analytics" }), null);
	assertEquals(workspacePanelOf({ tab: "clients" }), null);
});
// #endregion

Deno.test("nextWorkspaceUrl keeps a section on Edit only and a buyer on Clients only", () => {
	const editing = { ...WORKSPACE_DEFAULTS, section: "seo" as const };
	assertEquals(nextWorkspaceUrl(editing, { section: "media" }).section, "media");
	assertEquals("section" in nextWorkspaceUrl(editing, { tab: "preview" }), false);
	const buyer = { ...WORKSPACE_DEFAULTS, tab: "clients" as const, client: "@ada" };
	assertEquals(nextWorkspaceUrl(buyer, { tab: "analytics" }).client, undefined);
	assertEquals(nextWorkspaceUrl(buyer, { period: "90d" }).client, "@ada");
	assertEquals(
		nextWorkspaceUrl(WORKSPACE_DEFAULTS, { tab: "clients", client: "@ada" }).client,
		"@ada",
	);
});

Deno.test("activeSectionOf: the last section past the reading line, or the last at the bottom", () => {
	const tops = [
		{ section: "media" as const, top: -900 },
		{ section: "basics" as const, top: 120 },
		{ section: "seo" as const, top: 640 },
	];
	assertEquals(activeSectionOf(tops, 270, false), "basics");
	assertEquals(activeSectionOf(tops, 270, true), "seo");
	assertEquals(activeSectionOf([{ section: "media", top: 400 }], 270, false), "media");
	assertEquals(activeSectionOf([], 270, false), null);
});
