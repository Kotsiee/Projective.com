import type {
	CohortCancellation,
	GroupScheduleMode,
	ListingCohorts,
	OpenCohortInput,
	SaveGroupScheduleInput,
} from "@projective/types/projects";
import { getUserClient, isCatalogueBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { fixtureScopedListings } from "./analytics-fixtures.ts";
import { type ClientPipelineSim, isClientPipelineSim } from "./clients-fixtures.ts";
import {
	fixtureListingCohorts,
	type RawCohortCancellation,
	type RawListingCohorts,
	toCohortCancellation,
	toListingCohorts,
} from "./cohorts-model.ts";
import { loadScopedListings, type ScopedListing } from "./listing-scope.ts";

/**
 * CatalogueCohortsBackendService — the FAT service behind a group-session listing's cohorts in the
 * seller's workspace (Decision #498): the cohorts the listing has run and is running, opening the next
 * one, and cancelling one before it starts.
 *
 * It decides no rule the database decides. LIVE, every call runs as the signed-in seller through the
 * definers in `00001155` (`get_listing_cohorts`, `open_cohort`, `cancel_cohort`), which check that
 * the caller manages the listing, hold the one-enrolling rule, schedule the sittings against the
 * calendar and refund every seat. The listing is resolved against the acting seller's own listings
 * first, so a slug that is not theirs reads as missing. With `CATALOGUE_BACKEND_LIVE=false` it answers
 * the fixture world, shaped by the `clientPipeline` dev axis (`sim`), through the same mapping; a
 * fixture write answers what the live one would and persists nothing.
 */

const SIGNED_OUT = "Sign in to manage your catalogue.";
const NO_LISTING = "No such listing.";
const NOT_COHORT = "Only a group session has cohorts.";
const UNREACHABLE = "We couldn't reach your cohorts just now. Try again in a moment.";

interface Options {
	sim?: string | null;
	/** The `groupSchedule` dev axis (SC11): the fixture listing's schedule mode, when forced. */
	schedule?: GroupScheduleMode | null;
	now?: number;
}

type Resolved = { kind: "ok"; listing: ScopedListing } | { kind: "missing" } | {
	kind: "not_cohort";
};

function simOf(raw: string | null | undefined): ClientPipelineSim {
	return raw && isClientPipelineSim(raw) ? raw : "auto";
}

function check(listing: ScopedListing | undefined): Resolved {
	if (!listing) return { kind: "missing" };
	if (listing.model !== "group_session") return { kind: "not_cohort" };
	return { kind: "ok", listing };
}

/** A definer's refusal (SQLSTATE + message) onto a ServiceResult; the message is the database's. */
function refusal<T>(error: { code?: string; message?: string }): ServiceResult<T> {
	const message = error.message ?? UNREACHABLE;
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "P0002":
			return fail(404, { message: NO_LISTING });
		case "PM403":
			return fail(403, { message });
		case "22023":
		case "PU422":
			return fail(422, { message });
		case "PS409":
			return fail(409, { message });
		default:
			return fail(503, { message: UNREACHABLE });
	}
}

export class CatalogueCohortsBackendService {
	/** A group-session listing's cohorts and the facts the opening form needs. */
	static async cohorts(
		listingSlug: string,
		actor: ReadActor,
		options: Options = {},
	): Promise<ServiceResult<ListingCohorts>> {
		const now = options.now ?? Date.now();
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const found = check(fixtureScopedListings().find((l) => l.slug === listingSlug));
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			return ok(
				toListingCohorts(
					fixtureListingCohorts(simOf(options.sim), now, found.listing, options.schedule),
				),
			);
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const found = check(
				(await loadScopedListings(db, actor)).find((l) => l.slug === listingSlug),
			);
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			const { data, error } = await db.schema("projects").rpc("get_listing_cohorts", {
				p_listing: found.listing.id,
			});
			if (error) return refusal(error);
			return ok(toListingCohorts(data as RawListingCohorts));
		} catch (error) {
			console.error("[catalogue:cohorts]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * Open the listing's next cohort (`projects.open_cohort`) and answer its cohorts as they now stand.
	 * 409 while another cohort is taking bookings or a sitting clashes with the seller's calendar.
	 */
	static async open(
		input: OpenCohortInput,
		actor: ReadActor,
	): Promise<ServiceResult<ListingCohorts>> {
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const found = check(fixtureScopedListings().find((l) => l.slug === input.listing));
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			const raw = fixtureListingCohorts("auto", Date.now(), found.listing);
			const cohort = raw.cohorts?.[0];
			if (cohort) {
				cohort.max_seats = input.maxSeats ?? cohort.max_seats;
				cohort.min_seats = input.minSeats;
				cohort.seats_paid = 0;
				cohort.seats_held = 0;
				cohort.cadence = input.cadence;
				cohort.first_start = input.firstStartsAt;
				cohort.enrolment_closes_at = input.enrolmentClosesAt ?? input.firstStartsAt;
			}
			return ok(toListingCohorts(raw), { status: 201 });
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const found = check(
				(await loadScopedListings(db, actor)).find((l) => l.slug === input.listing),
			);
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			const { error } = await db.schema("projects").rpc("open_cohort", {
				p_listing: found.listing.id,
				p_first_start: input.firstStartsAt,
				p_cadence: input.cadence,
				p_later_starts: input.cadence === "fixed" ? input.laterStartsAt : null,
				p_max_seats: input.maxSeats,
				p_min_seats: input.minSeats,
				p_enrolment_closes_at: input.enrolmentClosesAt,
				p_name: input.name && input.name.length > 0 ? input.name : null,
			});
			if (error) return refusal(error);
			const read = await db.schema("projects").rpc("get_listing_cohorts", {
				p_listing: found.listing.id,
			});
			if (read.error) return refusal(read.error);
			return ok(toListingCohorts(read.data as RawListingCohorts), { status: 201 });
		} catch (error) {
			console.error("[catalogue:cohorts:open]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * Save how the listing's cohorts open and its weekly templates (`projects.save_group_schedule`, SC11),
	 * and answer its cohorts as they now stand: on rolling templates the save has already opened the
	 * chains in the horizon. 422 for a week the database refuses (overlapping, or short of the sittings).
	 */
	static async saveSchedule(
		input: SaveGroupScheduleInput,
		actor: ReadActor,
	): Promise<ServiceResult<ListingCohorts>> {
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const found = check(fixtureScopedListings().find((l) => l.slug === input.listing));
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			const raw = fixtureListingCohorts("auto", Date.now(), found.listing);
			return ok(
				toListingCohorts({ ...raw, schedule_mode: input.mode, weekly_templates: input.templates }),
			);
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const found = check(
				(await loadScopedListings(db, actor)).find((l) => l.slug === input.listing),
			);
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			const { error } = await db.schema("projects").rpc("save_group_schedule", {
				p_listing: found.listing.id,
				p_mode: input.mode,
				p_templates: input.templates,
			});
			if (error) return refusal(error);
			const read = await db.schema("projects").rpc("get_listing_cohorts", {
				p_listing: found.listing.id,
			});
			if (read.error) return refusal(read.error);
			return ok(toListingCohorts(read.data as RawListingCohorts));
		} catch (error) {
			console.error("[catalogue:cohorts:schedule]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * Cancel one of the listing's cohorts before its first sitting (`projects.cancel_cohort`): every
	 * seat refunded in full, the waitlist kept in order. Answers what it did and the cohorts after it.
	 */
	static async cancel(
		listingSlug: string,
		cohortId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ cancellation: CohortCancellation; cohorts: ListingCohorts }>> {
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const found = check(fixtureScopedListings().find((l) => l.slug === listingSlug));
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			return ok({
				cancellation: {
					cohortId,
					reason: "provider",
					seatsRefunded: 0,
					refundedMinor: 0,
					currency: null,
					placesRestored: 0,
					waitlistTold: 0,
				},
				cohorts: toListingCohorts(fixtureListingCohorts("empty", Date.now(), found.listing)),
			});
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const db = getUserClient(actor.accessToken);
			const found = check(
				(await loadScopedListings(db, actor)).find((l) => l.slug === listingSlug),
			);
			if (found.kind === "missing") return fail(404, { message: NO_LISTING });
			if (found.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			const { data, error } = await db.schema("projects").rpc("cancel_cohort", {
				p_cohort_id: cohortId,
			});
			if (error) return refusal(error);
			const read = await db.schema("projects").rpc("get_listing_cohorts", {
				p_listing: found.listing.id,
			});
			if (read.error) return refusal(read.error);
			return ok({
				cancellation: toCohortCancellation(data as RawCohortCancellation),
				cohorts: toListingCohorts(read.data as RawListingCohorts),
			});
		} catch (error) {
			console.error("[catalogue:cohorts:cancel]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}
}
