import type { SupabaseClient } from "supabaseClient";
import { getAnonClient, getUserClient } from "../core/supabase.ts";
import { canReadLive, type ReadActor } from "./read-actor.ts";

/**
 * One telemetry insert, performed as whichever identity {@link writeTelemetry} chose. `userId` is
 * the value the row's `user_id` must carry for that identity's RLS policy to accept it.
 */
export type TelemetryWrite = (
	db: SupabaseClient,
	userId: string | null,
) => PromiseLike<{ error: { message: string } | null }>;

/**
 * Insert telemetry rows as the caller, falling back to an anonymous write.
 *
 * Signed-in callers write through their own JWT, so RLS attributes the row to them and nobody else.
 * Telemetry outlives sessions, though — a beacon sent from `pagehide` routinely carries a token that
 * expired while the tab sat open, and the actor's id is an unverified decode — so a refused
 * attributed write is retried once as `anon` with `user_id` NULL rather than losing the rows.
 * Throws only when the anonymous write fails too, with the attributed failure as the cause.
 */
export async function writeTelemetry(actor: ReadActor, write: TelemetryWrite): Promise<void> {
	let attributed: { message: string } | null = null;
	if (canReadLive(actor)) {
		const { error } = await write(getUserClient(actor.accessToken), actor.userId);
		if (!error) return;
		attributed = error;
	}
	const { error } = await write(getAnonClient(), null);
	if (error) {
		throw new Error(`Telemetry write failed: ${error.message}`, { cause: attributed ?? error });
	}
}
