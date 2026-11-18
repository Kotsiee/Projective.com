import type { ListingPromotion, PromoteListingInput } from "@projective/types/catalogue";
import { ListingPromotionSchema } from "@projective/types/catalogue";
import { getUserClient } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { type DoorError, refusalOf } from "./catalogue-refusals.ts";
import { ownedListing } from "./live-catalogue.ts";

/**
 * listing-promotion — a seller's one plan-allocated "Promoted" slot (Decision #454), through the
 * `marketplace` promotion doors (00001176) as the signed-in seller. Each door re-checks the listing's
 * manager, the owning subject's `promoted_placement` entitlement and the one-live rule itself, so a
 * refusal from the database is the final word.
 */

type Result<T> = ServiceResult<T>;
type LiveActor = ReadActor & { accessToken: string };

/** What a door's promotion-specific refusal means; the rest go through {@link refusalOf}. */
function promotionRefusal<T>(error: DoorError & { hint?: string | null }): Result<T> {
	const message = error.message.replace(/\s+/g, " ").trim();
	if (error.code === "PK402") return fail(402, { message, details: { reason: "entitlement" } });
	if (error.code === "PC409") {
		return fail(409, {
			message,
			details: { reason: error.hint === "promotion_not_live" ? "not_live" : "live_elsewhere" },
		});
	}
	if (error.code === "PG422") return fail(422, { message, details: { reason: "unpublished" } });
	return refusalOf(error);
}

interface PromotionRow {
	entitled: boolean;
	subject: "user" | "team";
	published: boolean;
	flight_days: number;
	live: { placement_id: string; surface: string; starts_at: string; ends_at: string } | null;
	elsewhere: { slug: string | null; title: string; ends_at: string } | null;
}

function promotionOf(slug: string, row: PromotionRow): ListingPromotion {
	return ListingPromotionSchema.parse({
		id: slug,
		entitled: row.entitled,
		subject: row.subject,
		published: row.published,
		flightDays: row.flight_days,
		live: row.live
			? {
				placementId: row.live.placement_id,
				surface: row.live.surface,
				startsAt: row.live.starts_at,
				endsAt: row.live.ends_at,
			}
			: null,
		elsewhere: row.elsewhere
			? {
				slug: row.elsewhere.slug ?? "",
				title: row.elsewhere.title,
				endsAt: row.elsewhere.ends_at,
			}
			: null,
	});
}

async function listingUuid(slug: string, actor: LiveActor): Promise<string | null> {
	const listing = await ownedListing(getUserClient(actor.accessToken), slug, actor);
	return listing?.id ?? null;
}

const NOT_FOUND = "No such listing.";

/** What the Promote control shows for one listing the actor manages. */
export async function readListingPromotion(
	slug: string,
	actor: LiveActor,
): Promise<Result<{ promotion: ListingPromotion }>> {
	const id = await listingUuid(slug, actor);
	if (!id) return fail(404, { message: NOT_FOUND });
	const { data, error } = await getUserClient(actor.accessToken).schema("marketplace").rpc(
		"get_listing_promotion",
		{ p_listing: id },
	);
	if (error) return promotionRefusal(error);
	return ok({ promotion: promotionOf(slug, data as PromotionRow) });
}

/** Start the seller's one 7-day flight on the chosen surface, and answer with the state now stored. */
export async function promoteListing(
	input: PromoteListingInput,
	actor: LiveActor,
): Promise<Result<{ promotion: ListingPromotion }>> {
	const id = await listingUuid(input.id, actor);
	if (!id) return fail(404, { message: NOT_FOUND });
	const { error } = await getUserClient(actor.accessToken).schema("marketplace").rpc(
		"promote_listing",
		{ p_listing: id, p_surface: input.surface },
	);
	if (error) return promotionRefusal(error);
	const read = await readListingPromotion(input.id, actor);
	if (!read.ok || !read.data) return read;
	return ok(read.data, { status: 201, message: "Promotion started." });
}

/** Stop the listing's live flight now, and answer with the state now stored. */
export async function stopListingPromotion(
	slug: string,
	actor: LiveActor,
): Promise<Result<{ promotion: ListingPromotion }>> {
	const id = await listingUuid(slug, actor);
	if (!id) return fail(404, { message: NOT_FOUND });
	const { error } = await getUserClient(actor.accessToken).schema("marketplace").rpc(
		"stop_listing_promotion",
		{ p_listing: id },
	);
	if (error) return promotionRefusal(error);
	const read = await readListingPromotion(slug, actor);
	if (!read.ok || !read.data) return read;
	return ok(read.data, { message: "Promotion stopped." });
}
