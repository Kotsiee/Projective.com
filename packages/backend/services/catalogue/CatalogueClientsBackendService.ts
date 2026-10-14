import type { ClientDetail, ClientPipeline } from "@projective/types/catalogue";
import { isCatalogueBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { toClientKey } from "./client-pipeline.ts";
import {
	type ClientPipelineSim,
	fixtureClient,
	fixturePipeline,
	isClientPipelineSim,
} from "./clients-fixtures.ts";
import type { ClientScope } from "./listing-scope.ts";
import { liveClient, livePipeline } from "./live-catalogue-clients.ts";

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
}
