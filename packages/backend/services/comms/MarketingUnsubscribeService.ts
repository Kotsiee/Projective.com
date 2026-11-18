import type { SupabaseClient } from "supabaseClient";
import {
	type MarketingUnsubscribeOutcome,
	MarketingUnsubscribeOutcome as OutcomeSchema,
} from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, isAuthBackendLive } from "../../core/supabase.ts";
import { verifyUnsubscribeToken } from "./unsubscribe-token.ts";

/**
 * MarketingUnsubscribeService — an account's one-click marketing unsubscribe (RFC 8058; COMMS NT3),
 * behind `POST /api/comms/unsubscribe`. The newsletter's anonymous list has its own door beside it
 * (`/api/newsletter/unsubscribe`, CD1): an account and an anonymous address are not one list.
 *
 * The signed link names the person (`unsubscribe-token.ts`); `comms.fn_unsubscribe_marketing`
 * suppresses their primary verified address for Marketing only, so a security or money notice still
 * reaches them (#339 ruling N3 (b)). Idempotent: a second press answers the same.
 */

/** The database half, behind a seam for tests. */
export type UnsubscribeRpc = (userId: string) => Promise<MarketingUnsubscribeOutcome>;

const rpcLive: UnsubscribeRpc = async (userId) => {
	const db = getServiceClient().schema("comms") as unknown as SupabaseClient;
	const { data, error } = await db.rpc("fn_unsubscribe_marketing", { p_user: userId });
	if (error) throw new Error(`comms.fn_unsubscribe_marketing failed (${error.code ?? "no code"})`);
	const outcome = OutcomeSchema.safeParse(data);
	if (!outcome.success) {
		throw new Error("comms.fn_unsubscribe_marketing answered an unknown outcome");
	}
	return outcome.data;
};

export interface UnsubscribeDeps {
	live: boolean;
	verify: (token: string | null) => Promise<string | null>;
	rpc: UnsubscribeRpc;
}

const liveDeps = (): UnsubscribeDeps => ({
	live: isAuthBackendLive(),
	verify: (token) => verifyUnsubscribeToken(token),
	rpc: rpcLive,
});

export class MarketingUnsubscribeService {
	/** Spend a signed one-click link: 404 for anything this server did not sign. */
	static async unsubscribe(
		token: string | null,
		deps: Partial<UnsubscribeDeps> = {},
	): Promise<ServiceResult<{ outcome: MarketingUnsubscribeOutcome }>> {
		const d = { ...liveDeps(), ...deps };
		const userId = await d.verify(token);
		if (!userId) return fail(404, { message: "This unsubscribe link isn't valid." });
		if (!d.live) {
			return fail(503, { message: "Unsubscribing isn't connected in this environment." });
		}
		try {
			const outcome = await d.rpc(userId);
			return ok({ outcome }, {
				message: outcome === "no_address"
					? "There is no confirmed address on this account to unsubscribe."
					: "You won't get marketing email from Projective any more.",
			});
		} catch (error) {
			console.error("[comms:unsubscribe]", error instanceof Error ? error.message : error);
			return fail(503, { message: "That couldn't be done just now. Try again in a moment." });
		}
	}
}
