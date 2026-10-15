import type { SupabaseClient } from "supabaseClient";
import {
	type ApplyListingMediaInput,
	type BatchInput,
	type BatchOutcome,
	type CreateListingInput,
	type FormArchetype,
	formArchetypeOf,
	type ListingDetail,
	type ListingMediaSlot,
	type ListingStatus,
	type ReorderListingMediaInput,
	reorderSlots,
	type SaveListingShowcaseInput,
	type ServiceType,
	type SetListingStatusInput,
	type UpdateListingInput,
} from "@projective/types/catalogue";
import { flattenRichText } from "@projective/types/richtext";
import { toMinorUnits } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { fetchPublicMedia } from "../files/public-media.ts";
import {
	cutShowcaseRendition,
	type Rendition,
	retireRendition,
} from "../media/showcase-rendition.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { batchOutcomes, type BatchRow, refusalOf } from "./catalogue-refusals.ts";
import {
	LISTING_MEDIA_COLUMNS,
	listingMediaFileIds,
	type ListingMediaRow,
	listingMediaSlots,
} from "./listing-media.ts";
import {
	type CatalogueListingRow,
	listingDetail,
	MODEL_TO_DB,
	ownedListing,
} from "./live-catalogue.ts";
import { offerColumns } from "./offer-columns.ts";
import { type ListingOwnerColumns, ownsListing } from "./ownership.ts";

/**
 * live-catalogue-writes — every seller write to a listing, through the `catalogue.*` doors, as the
 * signed-in seller.
 *
 * Each door re-checks ownership and every rule itself, so a refusal from the database is the final
 * word, mapped by `catalogue-refusals.ts`. A write answers with the listing as now STORED (read back),
 * never with the request echoed.
 */

type Result<T> = ServiceResult<T>;
type LiveActor = ReadActor & { accessToken: string };

const NOT_FOUND = "No such listing.";

function notFound<T>(): Result<T> {
	return fail(404, { message: NOT_FOUND });
}

async function readBack(slug: string, actor: LiveActor): Promise<ListingDetail> {
	const listing = await listingDetail(slug, actor);
	if (!listing) throw new Error("The listing could not be read back.");
	return listing;
}

// #region Create
/** Create a draft listing and route to its manage page. */
export async function createListing(
	input: CreateListingInput,
	actor: LiveActor,
): Promise<Result<{ listing: ListingDetail }>> {
	const db = getUserClient(actor.accessToken);
	const { data, error } = await db.schema("catalogue").rpc("create_listing", {
		p_kind: input.kind,
		p_title: input.title,
		p_delivery_model: input.kind === "service" && input.serviceType
			? MODEL_TO_DB[input.serviceType]
			: null,
		p_team: actor.contextType === "team" && actor.contextId ? actor.contextId : null,
		p_currency: input.currency ?? null,
		p_create_category: input.createCategory ?? null,
	});
	if (error) return refusalOf(error);
	const slug = (data as { slug?: string } | null)?.slug;
	if (!slug) throw new Error("The new listing returned no address.");
	return ok({ listing: await readBack(slug, actor) }, { status: 201, message: "Draft created." });
}
// #endregion

// #region Update
/** What a patch is applied to: the listing's kind, currency and current form. */
export interface PatchTarget {
	kind: "product" | "service";
	currency: string;
	archetype: FormArchetype;
}

/**
 * The `catalogue.save_listing` patch for an editor patch. Only the keys the patch carries travel, so a
 * partial autosave cannot clear what it did not send. Prices go as minor units in the currency the
 * listing is priced in after this save (a never-published draft may change it in the same patch), the
 * plain-text description is derived from the HTML here rather than taken on trust, and
 * `expected_updated_at` makes the save refuse (PC409) when another tab saved first.
 */
export function savePatchBody(
	patch: UpdateListingInput,
	target: PatchTarget,
): Record<string, unknown> {
	const currency = patch.currency ?? target.currency;
	const minor = (whole: number | null | undefined) =>
		whole === null || whole === undefined ? null : toMinorUnits(whole, currency);
	const body: Record<string, unknown> = { expected_updated_at: patch.expectedUpdatedAt };
	if (patch.currency !== undefined) body.currency = patch.currency;
	if (patch.title !== undefined) body.title = patch.title;
	if (patch.category !== undefined) body.category = patch.category;
	if (patch.description !== undefined) {
		body.description_html = patch.description;
		body.description_text = flattenRichText(patch.description).slice(0, 4000);
	} else if (patch.descriptionText !== undefined) {
		body.description_text = patch.descriptionText;
	}
	if (patch.delivery !== undefined) body.delivery_label = patch.delivery;
	if (patch.pricing !== undefined) {
		body.amount_cents = minor(patch.pricing.amount) ?? 0;
		body.ticket_price_cents = minor(patch.pricing.ticketPrice);
		body.session_price_cents = minor(patch.pricing.sessionPrice);
		body.seats_per_session = patch.pricing.seatsPerSession;
		body.free_revisions = patch.pricing.freeRevisions;
		body.extra_revision_price_cents = minor(patch.pricing.extraRevisionPrice);
	}
	let archetype = target.archetype;
	if (patch.serviceType !== undefined && target.kind === "service") {
		body.delivery_model = MODEL_TO_DB[patch.serviceType];
		archetype = formArchetypeOf("service", patch.serviceType);
	}
	if (patch.intake !== undefined && target.kind === "service") body.intake = patch.intake;
	if (patch.offer !== undefined) Object.assign(body, offerColumns(patch.offer, archetype));
	if (patch.skills !== undefined) body.skills = patch.skills.map((s) => s.label);
	if (patch.tags !== undefined) body.tags = patch.tags;
	if (patch.collections !== undefined) body.collections = patch.collections;
	if (patch.createCategory !== undefined) body.create_category = patch.createCategory;
	if (patch.seo !== undefined) {
		body.seo_title = patch.seo.seoTitle;
		body.seo_description = patch.seo.seoDescription;
	}
	return body;
}

function serviceTypeOfRow(db: string | undefined): ServiceType | null {
	const entry = Object.entries(MODEL_TO_DB).find(([, slug]) => slug === db);
	return entry ? entry[0] as ServiceType : null;
}

async function patchTarget(db: SupabaseClient, l: CatalogueListingRow): Promise<PatchTarget> {
	if (l.kind === "product" || !l.service_blueprint_id) {
		return { kind: l.kind, currency: l.currency, archetype: formArchetypeOf(l.kind, null) };
	}
	const { data, error } = await db.schema("marketplace").from("service_blueprints")
		.select("delivery_model").eq("id", l.service_blueprint_id).maybeSingle();
	if (error) throw new Error(`marketplace.service_blueprints read failed: ${error.message}`);
	const model = (data as { delivery_model?: string } | null)?.delivery_model;
	return {
		kind: "service",
		currency: l.currency,
		archetype: formArchetypeOf("service", serviceTypeOfRow(model)),
	};
}

/**
 * Apply an editor patch to a listing (and its product or blueprint), then read it back. `db` is the
 * seller's session client; a test passes a stub.
 */
export async function updateListing(
	patch: UpdateListingInput,
	actor: LiveActor,
	db: SupabaseClient = getUserClient(actor.accessToken),
): Promise<Result<{ listing: ListingDetail }>> {
	const l = await ownedListing(db, patch.id, actor);
	if (!l) return notFound();
	const body = savePatchBody(patch, await patchTarget(db, l));
	const { error } = await db.schema("catalogue").rpc("save_listing", {
		p_listing: l.id,
		p_patch: body,
	});
	if (error) return refusalOf(error);
	return ok({ listing: await readBack(patch.id, actor) }, { message: "Saved." });
}
// #endregion

// #region Media
async function mediaRows(db: SupabaseClient, listingId: string): Promise<ListingMediaRow[]> {
	const { data, error } = await db.schema("catalogue").from("listing_media")
		.select(LISTING_MEDIA_COLUMNS).eq("listing_id", listingId);
	if (error) throw new Error(`catalogue.listing_media read failed: ${error.message}`);
	return (data ?? []) as ListingMediaRow[];
}

async function slotsOf(db: SupabaseClient, listingId: string): Promise<ListingMediaSlot[]> {
	const rows = await mediaRows(db, listingId);
	return listingMediaSlots(rows, await fetchPublicMedia(db, listingMediaFileIds(rows)));
}

/** The `apply_listing_media` element for a stored row. */
function slotBody(row: Omit<ListingMediaRow, "listing_id">): Record<string, unknown> {
	return {
		position: row.position,
		kind: row.kind,
		file_id: row.file_id,
		rendition_file_id: row.rendition_file_id,
		poster_file_id: row.poster_file_id,
		alt_text: row.alt_text ?? "",
	};
}

/**
 * Place library assets into a listing's showcase. Each choice is cut into its public 16:10 rendition
 * (`cutShowcaseRendition`, the profile's own cut), then the whole showcase is written in one door call
 * (`catalogue.apply_listing_media`), which checks every file is the seller's, keeps a video out of
 * slot 1 and mirrors the cover. Slots the request does not name are kept. If any cut or the door
 * fails, every rendition this call made is retired.
 */
export async function applyListingMedia(
	input: ApplyListingMediaInput,
	actor: LiveActor,
): Promise<Result<ListingMediaSlot[]>> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, input.listingId, actor);
	if (!l) return notFound();
	const owner = l.owner_team_id
		? { type: "team" as const, id: l.owner_team_id }
		: { type: "user" as const, id: l.owner_user_id };

	const made: Rendition[] = [];
	const retireAll = () => Promise.all(made.map(retireRendition));
	const placed: Array<Omit<ListingMediaRow, "listing_id">> = [];
	for (const [index, choice] of input.choices.entries()) {
		const cut = await cutShowcaseRendition(choice.sourceAssetId, choice.crop, actor, {
			owner,
			position: choice.position,
			displayName: `Listing showcase slot ${choice.position}`,
		});
		if (!cut.ok || !cut.data) {
			await retireAll();
			const errors = cut.errors
				? Object.fromEntries(
					Object.entries(cut.errors).map(([k, v]) => [`choices.${index}.${k}`, v]),
				)
				: undefined;
			return fail(cut.status, { message: cut.message, errors });
		}
		made.push(cut.data.rendition);
		placed.push({
			position: choice.position,
			kind: cut.data.kind,
			file_id: cut.data.sourceId,
			rendition_file_id: cut.data.rendition.id,
			poster_file_id: null,
			alt_text: choice.alt,
		});
	}

	try {
		const taken = new Set(placed.map((p) => p.position));
		const kept = (await mediaRows(db, l.id)).filter((r) => !taken.has(r.position));
		const slots = [...kept, ...placed].sort((a, b) => a.position - b.position).map(slotBody);
		const { error } = await db.schema("catalogue").rpc("apply_listing_media", {
			p_listing: l.id,
			p_slots: slots,
		});
		if (error) {
			await retireAll();
			return refusalOf(error);
		}
	} catch (error) {
		await retireAll();
		throw error;
	}
	return ok(await slotsOf(db, l.id), { message: "Showcase saved." });
}

/**
 * Reorder a listing's showcase: the filled positions stay filled and their items move between them
 * (`reorderSlots`, the rule the grid applies before it calls). A video is never moved into slot 1.
 */
export async function reorderListingMedia(
	input: ReorderListingMediaInput,
	actor: LiveActor,
): Promise<Result<ListingMediaSlot[]>> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, input.listingId, actor);
	if (!l) return notFound();
	const reordered = reorderSlots(await mediaRows(db, l.id), input.order);
	if (!reordered.ok) {
		return fail(422, { message: reordered.reason, errors: { order: reordered.reason } });
	}
	const { error } = await db.schema("catalogue").rpc("apply_listing_media", {
		p_listing: l.id,
		p_slots: reordered.slots.map(slotBody),
	});
	if (error) return refusalOf(error);
	return ok(await slotsOf(db, l.id), { message: "Showcase reordered." });
}

/**
 * Save the showcase as a whole: the items it keeps, by file, at their positions with their alt
 * text. An item not listed is emptied from the showcase; a file that is not already in it is refused,
 * because only {@link applyListingMedia} cuts a new rendition. The door keeps a video out of slot 1.
 */
export async function saveListingShowcase(
	input: SaveListingShowcaseInput,
	actor: LiveActor,
): Promise<Result<ListingMediaSlot[]>> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, input.listingId, actor);
	if (!l) return notFound();
	const byFile = new Map((await mediaRows(db, l.id)).map((r) => [r.file_id, r]));
	const kept: Array<Omit<ListingMediaRow, "listing_id">> = [];
	for (const [index, keep] of input.slots.entries()) {
		const row = byFile.get(keep.fileId);
		if (!row) {
			const message = "That item isn't in this showcase any more. Reload to see it as saved.";
			return fail(422, { message, errors: { [`slots.${index}.fileId`]: message } });
		}
		kept.push({ ...row, position: keep.position, alt_text: keep.alt });
	}
	const slots = kept.sort((a, b) => a.position - b.position).map(slotBody);
	const { error } = await db.schema("catalogue").rpc("apply_listing_media", {
		p_listing: l.id,
		p_slots: slots,
	});
	if (error) return refusalOf(error);
	return ok(await slotsOf(db, l.id), { message: "Showcase saved." });
}
// #endregion

// #region Status
function statusMessage(status: ListingStatus): string {
	switch (status) {
		case "published":
			return "Listing published.";
		case "paused":
			return "Listing paused.";
		case "archived":
			return "Listing archived.";
		case "draft":
			return "Listing moved to drafts.";
	}
}

/** Move a listing through its lifecycle; publishing passes the gate server-side. */
export async function setListingStatus(
	input: SetListingStatusInput,
	actor: LiveActor,
): Promise<Result<{ listing: ListingDetail }>> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, input.id, actor);
	if (!l) return notFound();
	const { error } = await db.schema("catalogue").rpc("set_listing_status", {
		p_listing: l.id,
		p_status: input.status,
	});
	if (error) return refusalOf(error);
	return ok({ listing: await readBack(input.id, actor) }, { message: statusMessage(input.status) });
}
// #endregion

// #region Delete
/**
 * Hard-delete a listing nobody has engaged with, and its product or service (`catalogue.delete_listing`,
 * Decision #221). A listing with buyer history is refused 409 — archiving is the way out for it.
 */
export async function deleteListing(
	slug: string,
	actor: LiveActor,
): Promise<Result<{ id: string }>> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, slug, actor);
	if (!l) return notFound();
	const { error } = await db.schema("catalogue").rpc("delete_listing", { p_listing: l.id });
	if (error) return refusalOf(error);
	return ok({ id: slug }, { message: "Listing deleted." });
}
// #endregion

// #region Duplicate
/** Copy a listing as a new draft (media by file id, the same subject terms) and read the copy back. */
export async function duplicateListing(
	slug: string,
	actor: LiveActor,
): Promise<Result<{ listing: ListingDetail }>> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, slug, actor);
	if (!l) return notFound();
	const { data, error } = await db.schema("catalogue").rpc("duplicate_listing", {
		p_listing: l.id,
	});
	if (error) return refusalOf(error);
	const copy = (data as { slug?: string } | null)?.slug;
	if (!copy) throw new Error("The copy returned no address.");
	return ok({ listing: await readBack(copy, actor) }, {
		status: 201,
		message: "Listing duplicated.",
	});
}
// #endregion

// #region Batch
/** The caller's listings among `slugs`, by slug; a slug that is not theirs is absent. */
async function ownedIds(
	db: SupabaseClient,
	slugs: readonly string[],
	actor: ReadActor,
): Promise<Map<string, string>> {
	const services = slugs.filter((s) => s.startsWith("svc-"));
	const products = slugs.filter((s) => s.startsWith("prd-"));
	const [bps, prs] = await Promise.all([
		services.length
			? db.schema("marketplace").from("service_blueprints").select("id, slug").in("slug", services)
			: Promise.resolve({ data: [], error: null }),
		products.length
			? db.schema("catalogue").from("products").select("id, slug").in("slug", products)
			: Promise.resolve({ data: [], error: null }),
	]);
	if (bps.error) {
		throw new Error(`marketplace.service_blueprints read failed: ${bps.error.message}`);
	}
	if (prs.error) throw new Error(`catalogue.products read failed: ${prs.error.message}`);
	const slugBySubject = new Map(
		[...(bps.data ?? []), ...(prs.data ?? [])].map((
			s: { id: string; slug: string },
		) => [s.id, s.slug]),
	);
	if (slugBySubject.size === 0) return new Map();
	const subjects = [...slugBySubject.keys()].join(",");
	const { data, error } = await db.schema("catalogue").from("listings")
		.select("id, owner_user_id, owner_team_id, service_blueprint_id, product_id")
		.or(`service_blueprint_id.in.(${subjects}),product_id.in.(${subjects})`);
	if (error) throw new Error(`catalogue.listings read failed: ${error.message}`);
	const out = new Map<string, string>();
	for (
		const l of (data ?? []) as Array<
			ListingOwnerColumns & {
				id: string;
				service_blueprint_id: string | null;
				product_id: string | null;
			}
		>
	) {
		const slug = slugBySubject.get(l.service_blueprint_id ?? l.product_id ?? "");
		if (slug && ownsListing(l, actor)) out.set(slug, l.id);
	}
	return out;
}

/** The names of the collections a listing is already in. */
async function collectionsOf(db: SupabaseClient, listingId: string): Promise<string[]> {
	const { data, error } = await db.schema("catalogue").from("collection_listings")
		.select("collection_id").eq("listing_id", listingId);
	if (error) throw new Error(`catalogue.collection_listings read failed: ${error.message}`);
	const ids = ((data ?? []) as Array<{ collection_id: string }>).map((r) => r.collection_id);
	if (ids.length === 0) return [];
	const names = await db.schema("catalogue").from("collections").select("name").in("id", ids);
	if (names.error) throw new Error(`catalogue.collections read failed: ${names.error.message}`);
	return ((names.data ?? []) as Array<{ name: string }>).map((c) => c.name);
}

/**
 * Apply one action to many listings. Not all-or-nothing: each listing passes or fails on its own and
 * gets its own outcome. A status change runs as one `catalogue.set_listings_status` call (each row in
 * its own sub-transaction); adding to a collection and duplicating run per listing. `db` is the
 * seller's session client; a test passes a stub.
 */
export async function batchListings(
	input: BatchInput,
	actor: LiveActor,
	db: SupabaseClient = getUserClient(actor.accessToken),
): Promise<Result<BatchOutcome[]>> {
	const ids = await ownedIds(db, input.ids, actor);
	const requested = input.ids.map((slug) => ({ slug, listingId: ids.get(slug) ?? null }));
	const listingIds = requested.flatMap((r) => r.listingId ? [r.listingId] : []);

	if (input.action === "status") {
		if (listingIds.length === 0) return ok(batchOutcomes([], requested));
		const { data, error } = await db.schema("catalogue").rpc("set_listings_status", {
			p_listings: listingIds,
			p_status: input.status,
		});
		if (error) return refusalOf(error);
		return ok(batchOutcomes((data ?? []) as BatchRow[], requested));
	}

	const rows: BatchRow[] = [];
	for (const listingId of listingIds) {
		const { error } = input.action === "duplicate"
			? await db.schema("catalogue").rpc("duplicate_listing", { p_listing: listingId })
			: input.action === "delete"
			? await db.schema("catalogue").rpc("delete_listing", { p_listing: listingId })
			: await db.schema("catalogue").rpc("save_listing", {
				p_listing: listingId,
				p_patch: { collections: [...new Set([...await collectionsOf(db, listingId), input.name])] },
			});
		rows.push({
			listing_id: listingId,
			ok: !error,
			code: error?.code ?? null,
			detail: error?.details ?? null,
			message: error?.message ?? null,
		});
	}
	return ok(batchOutcomes(rows, requested));
}
// #endregion
