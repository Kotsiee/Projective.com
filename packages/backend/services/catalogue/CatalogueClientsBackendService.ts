import type { ClientDetail, ClientPipeline } from "@projective/types/catalogue";
import {
	DEFAULT_WAITLIST_INVITE_HOLD_HOURS,
	type ListingWaitlist,
} from "@projective/types/projects";
import { isCatalogueBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { fixtureScopedListings } from "./analytics-fixtures.ts";
import { toClientKey } from "./client-pipeline.ts";
import {
	type ClientPipelineSim,
	fixtureClient,
	fixturePipeline,
	fixtureWaitlist,
	isClientPipelineSim,
} from "./clients-fixtures.ts";
import type { ClientScope } from "./listing-scope.ts";
import { liveClient, livePipeline, liveWaitlist } from "./live-catalogue-clients.ts";

/**
 * CatalogueClientsBackendService — the FAT reads behind the console's Clients view and the item
 * workspace's Clients tab: the pipeline board (buyers grouped into lanes derived from each source's
 * own status) and one buyer for the client drawer.
 *
 * LIVE, both come from `catalogue.get_client_pipeline` as the signed-in seller. With
 * `CATALOGUE_BACKEND_LIVE=false` they answer deterministic fixtures, shaped by the `clientPipeline`
 * dev axis (`sim`), through the same mapping. A guest gets a 401 either way.
 */

export type { ClientScope };

const SIGNED_OUT = "Sign in to manage your catalogue.";
const UNREACHABLE = "We couldn't load your clients just now. Try again in a moment.";
const NO_LISTING = "No such listing.";
const NO_CLIENT = "No such client.";
const NOT_COHORT = "Only a group session has a waitlist.";
const WAITLIST_UNREACHABLE = "We couldn't load the waitlist just now. Try again in a moment.";

/** The dev axis value a request may use; anything unknown is `auto`. */
export function effectivePipelineSim(raw: string | null | undefined): ClientPipelineSim {
	return raw && isClientPipelineSim(raw) ? raw : "auto";
}

interface ReadOptions {
	sim?: string | null;
	now?: number;
}

export class CatalogueClientsBackendService {
	/**
	 * The client board for a scope: one summary per buyer in board order (action-required first by
	 * severity, then by recency), buyers per lane, and whether the read was cut. A listing scope the
	 * caller does not manage is a 404 worded as a missing one.
	 */
	static async pipeline(
		scope: ClientScope,
		actor: ReadActor,
		display: string,
		options: ReadOptions = {},
	): Promise<ServiceResult<ClientPipeline>> {
		const now = options.now ?? Date.now();
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const data = fixturePipeline(scope, effectivePipelineSim(options.sim), display, now);
			return data ? ok(data) : fail(404, { message: NO_LISTING });
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const data = await livePipeline(scope, actor, display);
			return data ? ok(data) : fail(404, { message: NO_LISTING });
		} catch (error) {
			console.error("[catalogue:clients]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * One buyer for the client drawer: their public identity, every engagement of theirs in scope, the
	 * DM thread for the inline thread and their open reschedule rounds. A buyer with no engagement in
	 * scope is a 404, so a handle cannot be used to learn who buys from the seller.
	 */
	static async client(
		handle: string,
		scope: ClientScope,
		actor: ReadActor,
		display: string,
		options: ReadOptions = {},
	): Promise<ServiceResult<ClientDetail>> {
		const now = options.now ?? Date.now();
		const key = toClientKey(handle);
		if (!actor.userId) return fail(401, { message: SIGNED_OUT });
		if (!key) return fail(404, { message: NO_CLIENT });
		if (!isCatalogueBackendLive()) {
			const data = fixtureClient(key, scope, effectivePipelineSim(options.sim), display, now);
			return data ? ok(data) : fail(404, { message: NO_CLIENT });
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const data = await liveClient(key, scope, actor, display, now);
			return data ? ok(data) : fail(404, { message: NO_CLIENT });
		} catch (error) {
			console.error("[catalogue:client]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * A group-session listing's waitlist for the workspace's Clients tab (Decision #455): how many places
	 * are waiting, invited, expired and converted, and the queue in order. A listing the caller does not
	 * manage is a 404 worded as a missing one; any other listing is a 422.
	 */
	static async waitlist(
		listingSlug: string,
		actor: ReadActor,
		options: ReadOptions = {},
	): Promise<ServiceResult<ListingWaitlist>> {
		const now = options.now ?? Date.now();
		if (!isCatalogueBackendLive()) {
			if (!actor.userId) return fail(401, { message: SIGNED_OUT });
			const listing = fixtureScopedListings().find((l) => l.slug === listingSlug);
			if (!listing) return fail(404, { message: NO_LISTING });
			if (listing.model !== "group_session") return fail(422, { message: NOT_COHORT });
			return ok(
				fixtureWaitlist(effectivePipelineSim(options.sim), now, DEFAULT_WAITLIST_INVITE_HOLD_HOURS),
			);
		}
		if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
		try {
			const read = await liveWaitlist(listingSlug, actor);
			if (read.kind === "missing") return fail(404, { message: NO_LISTING });
			if (read.kind === "not_cohort") return fail(422, { message: NOT_COHORT });
			return ok(read.data);
		} catch (error) {
			console.error("[catalogue:waitlist]", error instanceof Error ? error.message : error);
			return fail(503, { message: WAITLIST_UNREACHABLE });
		}
	}
}
