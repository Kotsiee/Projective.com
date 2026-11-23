import {
	formatMoney,
	type SavePromoCode,
	type SellerPromoCode,
	type SellerPromotions,
} from "@projective/types/finance";
import { getUserClient, isCatalogueBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { fixtureScopedListings } from "./analytics-fixtures.ts";
import { actingTeam, loadScopedListings, type ScopedListing } from "./listing-scope.ts";

/**
 * CataloguePromotionsBackendService — the FAT service behind the seller console's Promotions view
 * (`/catalogue?view=promotions`, MARKETPLACE CK2, Decision #485): the acting seller's promo codes, issuing
 * one over all or some of their product listings, and archiving one.
 *
 * It decides no rule the database decides. LIVE, every call runs as the signed-in seller through the
 * definers in `00001210` §9 (`list_own_promo_codes`, `save_promo_code`, `archive_promo_code`), which
 * check that the caller may issue for the seller: themselves, or a team whose `publish_listings` they
 * hold. The seller is the acting one: the team on `/teams/:handle/catalogue` (`actingTeam`), else the
 * person. Listings travel as slugs (Decision #88) and are resolved against the seller's own listings,
 * so a slug that is not theirs is refused before the door. With `CATALOGUE_BACKEND_LIVE=false` it
 * answers the fixture world; a fixture write answers what the live one would and persists nothing.
 */

const SIGNED_OUT = "Sign in to manage your catalogue.";
const UNREACHABLE = "We couldn't reach your promotions just now. Try again in a moment.";
const NOT_YOURS = "A code covers only your own product listings.";

/** One code as `finance.fn_promo_code_json` answers it. */
interface RawPromoCode {
	id: string;
	code: string;
	label: string;
	kind: "percent" | "flat";
	value_bp: number | null;
	value_minor: number | string | null;
	currency: string | null;
	starts_at: string | null;
	expires_at: string | null;
	max_redemptions: number | null;
	max_redemptions_per_account: number | null;
	redemption_count: number;
	listing_ids: string[] | null;
	deactivated_at: string | null;
	created_at: string;
}

/** Whose codes these are: the acting team, else the person. */
function issuerOf(actor: ReadActor): { type: "user" | "team"; id: string } | null {
	const team = actingTeam(actor);
	if (team) return { type: "team", id: team };
	return actor.userId ? { type: "user", id: actor.userId } : null;
}

/** The raw row onto the view's shape, listing ids back to the seller's slugs. */
export function toSellerPromoCode(
	raw: RawPromoCode,
	listings: readonly ScopedListing[],
): SellerPromoCode {
	const slugOf = new Map(listings.map((l) => [l.id, l.slug]));
	const minor = raw.value_minor === null ? null : Number(raw.value_minor);
	return {
		id: raw.id,
		code: raw.code,
		label: raw.label,
		kind: raw.kind,
		valueBp: raw.value_bp,
		value: minor !== null && raw.currency
			? { minor, currency: raw.currency, display: formatMoney(minor, raw.currency), origin: null }
			: null,
		startsAt: raw.starts_at,
		expiresAt: raw.expires_at,
		maxRedemptions: raw.max_redemptions,
		maxRedemptionsPerAccount: raw.max_redemptions_per_account,
		redemptionCount: raw.redemption_count,
		listings: raw.listing_ids
			? raw.listing_ids.map((id) => slugOf.get(id)).filter((s): s is string => !!s)
			: null,
		archivedAt: raw.deactivated_at,
		createdAt: raw.created_at,
	};
}

function productOptions(listings: readonly ScopedListing[]): SellerPromotions["listings"] {
	return listings.filter((l) => l.kind === "product").map((l) => ({
		slug: l.slug,
		title: l.title,
	}));
}

/** A definer's refusal (SQLSTATE + message) onto a ServiceResult; the message is the database's. */
function refusal<T>(error: { code?: string; message?: string }): ServiceResult<T> {
	const message = error.message ?? UNREACHABLE;
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "P0002":
			return fail(404, { message: "No such code." });
		case "22023":
			return fail(422, { message });
		case "PC409":
			return fail(409, {
				message: message.replace(/^promo_code_taken:\s*/, ""),
				errors: { code: "That code is taken — choose another." },
			});
		default:
			return fail(503, { message: UNREACHABLE });
	}
}

/** The door's arguments for a validated input, the listing slugs resolved to the seller's ids. */
function doorArgs(
	input: SavePromoCode,
	issuer: { type: string; id: string },
	listingIds: string[] | null,
) {
	return {
		p_issuer_type: issuer.type,
		p_issuer_id: issuer.id,
		p_code: input.code,
		p_label: input.label,
		p_kind: input.kind,
		p_value_bp: input.kind === "percent" ? (input.percent ?? 0) * 100 : null,
		p_value_minor: input.kind === "flat" ? input.amountMinor ?? null : null,
		p_currency: input.kind === "flat" ? input.currency ?? null : null,
		p_listing_ids: listingIds,
		p_expires_at: input.expiresAt ?? null,
		p_max_redemptions: input.maxRedemptions ?? null,
		p_max_redemptions_per_account: input.perAccount === undefined ? 1 : input.perAccount,
	};
}

/** Listing slugs onto the seller's own product listing ids; `null` when one is not theirs. */
function listingIdsFor(slugs: readonly string[] | undefined, listings: readonly ScopedListing[]) {
	if (!slugs || slugs.length === 0) return { ids: null as string[] | null };
	const bySlug = new Map(listings.filter((l) => l.kind === "product").map((l) => [l.slug, l.id]));
	const ids = slugs.map((s) => bySlug.get(s));
	return ids.every((id): id is string => !!id) ? { ids } : null;
}

export class CataloguePromotionsBackendService {
	/** The acting seller's codes (live first, newest first) and the listings a code may cover. */
	static async list(actor: ReadActor): Promise<ServiceResult<SellerPromotions>> {
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			return ok({ codes: [], listings: productOptions(fixtureScopedListings()) });
		}
		const issuer = issuerOf(actor);
		if (!canReadLive(actor) || !issuer) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const listings = await loadScopedListings(db, actor);
			const { data, error } = await db.schema("finance").rpc("list_own_promo_codes", {
				p_issuer_type: issuer.type,
				p_issuer_id: issuer.id,
			});
			if (error) return refusal(error);
			return ok({
				codes: ((data ?? []) as RawPromoCode[]).map((raw) => toSellerPromoCode(raw, listings)),
				listings: productOptions(listings),
			});
		} catch (error) {
			console.error("[catalogue:promotions]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/** Issue a code for the acting seller; 201 with the code as it now reads. */
	static async create(
		input: SavePromoCode,
		actor: ReadActor,
	): Promise<ServiceResult<SellerPromoCode>> {
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const listings = fixtureScopedListings();
			const scope = listingIdsFor(input.listings, listings);
			if (!scope) return fail(422, { message: NOT_YOURS, errors: { listings: NOT_YOURS } });
			const args = doorArgs(input, { type: "user", id: actor.userId }, scope.ids);
			return ok(
				toSellerPromoCode({
					id: crypto.randomUUID(),
					code: args.p_code,
					label: args.p_label,
					kind: args.p_kind,
					value_bp: args.p_value_bp,
					value_minor: args.p_value_minor,
					currency: args.p_currency,
					starts_at: null,
					expires_at: args.p_expires_at,
					max_redemptions: args.p_max_redemptions,
					max_redemptions_per_account: args.p_max_redemptions_per_account,
					redemption_count: 0,
					listing_ids: scope.ids,
					deactivated_at: null,
					created_at: new Date().toISOString(),
				}, listings),
				{ status: 201 },
			);
		}
		const issuer = issuerOf(actor);
		if (!canReadLive(actor) || !issuer) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const listings = await loadScopedListings(db, actor);
			const scope = listingIdsFor(input.listings, listings);
			if (!scope) return fail(422, { message: NOT_YOURS, errors: { listings: NOT_YOURS } });
			const { data, error } = await db.schema("finance").rpc(
				"save_promo_code",
				doorArgs(input, issuer, scope.ids),
			);
			if (error) return refusal(error);
			return ok(toSellerPromoCode(data as RawPromoCode, listings), { status: 201 });
		} catch (error) {
			console.error(
				"[catalogue:promotions:create]",
				error instanceof Error ? error.message : error,
			);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/** Archive one of the acting seller's codes; idempotent; 404 for a code that is not theirs. */
	static async archive(id: string, actor: ReadActor): Promise<ServiceResult<SellerPromoCode>> {
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			return fail(404, { message: "No such code." });
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const { data, error } = await db.schema("finance").rpc("archive_promo_code", { p_id: id });
			if (error) return refusal(error);
			return ok(toSellerPromoCode(data as RawPromoCode, await loadScopedListings(db, actor)));
		} catch (error) {
			console.error(
				"[catalogue:promotions:archive]",
				error instanceof Error ? error.message : error,
			);
			return fail(503, { message: UNREACHABLE });
		}
	}
}
