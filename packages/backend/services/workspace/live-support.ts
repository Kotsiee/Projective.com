import type { SupabaseClient } from "supabaseClient";
import { fail, type FieldErrors, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

/**
 * live-support — the plumbing every live workspace read and write shares: the signed-in guard, the
 * RPC call wrapper, and the ONE mapping from a database refusal onto a {@link ServiceResult}.
 *
 * The workspace tables carry no client write policy; every door is a `SECURITY DEFINER` RPC in the
 * `org` or `finance` schema that resolves the caller from the JWT and re-checks every rule itself
 * (`00001020_functions_org_entities.sql` §6–§16, `00001210_functions_finance_kyc_wallet.sql` §13). So
 * this layer never decides authority — it forwards the caller's session and translates the answer.
 *
 * The refusal convention those functions follow (and {@link refusalFrom} reads):
 * `RAISE … ERRCODE '22023', MESSAGE '<field>: <reason>'` is a field-keyed validation refusal, `42501`
 * is authority, `P0002` is not-found, `23505`/`55000` are conflicts, `23514` is a check constraint.
 * The reader-facing sentence is the part after `<field>: `.
 */

// #region Types

/** An actor that can make a live, RLS-scoped call — narrowed by {@link canReadLive}. */
export type LiveActor = ReadActor & { accessToken: string };

/** The schemas the workspace RPCs live in. */
export type RpcSchema = "org" | "finance" | "security";

/** The error shape `@supabase/supabase-js` hands back for a failed PostgREST call. */
export interface DbError {
	code?: string;
	message?: string;
	details?: string | null;
	hint?: string | null;
}

/** An RPC's outcome: its data, or the refusal the caller should return verbatim. */
export type RpcOutcome<T> = { ok: true; data: T } | { ok: false; refusal: ServiceResult<never> };

// #endregion

// #region Sentences

/** The sentence every surface shows when the database cannot be reached. */
export const UNAVAILABLE = "Teams and businesses are unavailable right now. Try again in a moment.";

/** The sentence an anonymous caller gets — every workspace surface is a signed-in surface. */
export const SIGN_IN = "Sign in to manage your teams and businesses.";

/** The refusal for a caller without a session. */
export function signedOut(): ServiceResult<never> {
	return fail(401, { message: SIGN_IN });
}

/** The refusal for a database that answered with something this layer cannot explain. */
export function unavailable(status = 503): ServiceResult<never> {
	return fail(status, { message: UNAVAILABLE });
}

// #endregion

// #region Refusals

/**
 * Message prefixes that name a SUBJECT rather than an input field. A refusal carrying one of these is a
 * sentence about the request as a whole, so it is returned as a message with no field key — keying it
 * to a control that does not exist would leave the form with an error it cannot place.
 */
const SUBJECT_PREFIXES: ReadonlySet<string> = new Set([
	"auth",
	"kind",
	"patch",
	"workspace",
	"member",
	"invitation",
	"invite",
	"role",
	"policy",
	"plan",
	"context",
	"wallet",
	"spend",
]);

/** A database field prefix that the SSOT input names differently. */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
	successor: "successorMemberId",
};

/** `first_name` → `firstName`; an already-camel name is unchanged. */
export function camelField(field: string): string {
	const camel = field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
	return FIELD_ALIASES[camel] ?? camel;
}

/** The reason as a reader sees it: first letter capitalised, one closing full stop. */
export function sentence(reason: string): string {
	const trimmed = reason.replace(/\s+/g, " ").trim();
	if (!trimmed) return trimmed;
	const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
	return /[.!?)]$/.test(capital) ? capital : `${capital}.`;
}

/** Split a `<field>: <reason>` message into its two halves; `null` when it is not in that form. */
export function splitRefusal(message: string): { field: string; reason: string } | null {
	const match = /^([A-Za-z_]+):\s*([\s\S]+)$/.exec(message.trim());
	return match ? { field: match[1], reason: match[2] } : null;
}

/**
 * Map a database refusal onto the result a route returns.
 *
 * `22023`/`23514`/`22P02` → 422 (field-keyed when the message names a field) · `42501` → 403 (401 when
 * the message is the "sign in" refusal) · `P0002` → 404 · `23505` → 409 (field-keyed) · `55000` → 409.
 * A JWT failure is a 401. Anything else is an error this layer cannot explain to a reader: it is logged
 * in full and answered with a generic 500, never the database's own text.
 */
export function refusalFrom(
	error: DbError | null | undefined,
	label = "workspace",
): ServiceResult<never> {
	const code = error?.code ?? "";
	const message = error?.message ?? "";
	if (code === "PGRST301" || code === "PGRST302" || /\bjwt\b/i.test(message)) {
		return fail(401, { message: "Your session has expired. Sign in again." });
	}
	const parts = splitRefusal(message);
	const reason = sentence(parts?.reason ?? message);
	const field = parts && !SUBJECT_PREFIXES.has(parts.field) ? camelField(parts.field) : null;
	const keyed = (status: number): ServiceResult<never> => {
		const errors: FieldErrors | undefined = field ? { [field]: reason } : undefined;
		return fail(status, { message: reason, errors });
	};
	switch (code) {
		case "22023":
		case "23514":
			return keyed(422);
		case "22P02":
			return fail(422, { message: "One of those references isn't valid." });
		case "42501":
			if (parts?.field === "auth" && /sign in/i.test(parts.reason)) return signedOut();
			return fail(403, { message: reason || "You can't do that here." });
		case "P0002":
		case "PB404":
			if (parts && /^not found$/i.test(parts.reason.trim())) {
				return fail(404, { message: `That ${parts.field} doesn't exist.` });
			}
			return fail(404, { message: reason || "That no longer exists." });
		case "23505":
			return keyed(409);
		case "55000":
		case "PC409":
			return fail(409, { message: reason });
		default:
			console.error(`[workspace:${label}]`, code, message, error?.details ?? "");
			return fail(500, { message: "That couldn't be completed. Try again in a moment." });
	}
}

// #endregion

// #region Calls

/** The caller's user-scoped client. Every workspace call runs AS the caller, never as the service role. */
export function clientFor(actor: LiveActor): SupabaseClient {
	return getUserClient(actor.accessToken);
}

/**
 * Call one RPC as the caller and hand back its data or its mapped refusal.
 *
 * Throws only when the transport itself fails (the fat service turns that into a 503); a raised
 * refusal is data, not an exception.
 */
export async function callRpc<T>(
	actor: LiveActor,
	schema: RpcSchema,
	name: string,
	args: Record<string, unknown> = {},
): Promise<RpcOutcome<T>> {
	const { data, error } = await clientFor(actor).schema(schema).rpc(name, args);
	if (error) return { ok: false, refusal: refusalFrom(error, name) };
	return { ok: true, data: data as T };
}

/** Whether an actor can make a live call — re-exported so callers need one import. */
export function isLive(actor: ReadActor): actor is LiveActor {
	return canReadLive(actor);
}

// #endregion

// #region Identifiers

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a canonical uuid — every row the workspace RPCs take is addressed by one. */
export function isUuid(value: string | null | undefined): value is string {
	return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * The refusal for a malformed id, BEFORE it reaches Postgres (where it would surface as a bare
 * `22P02`). Field-keyed so the form can point at the control that carried it.
 */
export function badId(field: string, noun: string): ServiceResult<never> {
	const message = `That ${noun} doesn't exist.`;
	return fail(404, { message, errors: { [field]: message } });
}

// #endregion
