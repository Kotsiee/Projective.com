import {
	handleAlternatives,
	type HandleCheck,
	handleRefusalOf,
	WORKSPACE_HANDLE_MAX,
} from "@projective/types/workspace";
import { ok, type ServiceResult } from "../ServiceResult.ts";
import { callRpc, type LiveActor, type RpcOutcome } from "./live-support.ts";

/**
 * live-handle — the create form's availability probe, with alternatives for a taken handle.
 *
 * `org.check_handle` answers one handle: available, or the sentence `org.fn_handle_refusal` refuses it
 * with. When that sentence is "taken" the form needs somewhere to go next, and only the namespace can
 * say which alternatives are free — so this layer asks it about a short list of candidates
 * (`handleAlternatives`, the SSOT's claim rule) and answers with the first few that are. A suggestion
 * is therefore a handle that was free a moment ago, never a guess; a malformed or reserved handle gets
 * none, because a variation of it is the wrong fix.
 */

// #region Types

/** How many free alternatives a taken handle is answered with. */
export const HANDLE_SUGGESTION_COUNT = 3;

/** `org.check_handle`'s raw answer for one handle. */
export interface RawHandleVerdict {
	handle: string;
	available: boolean;
	reason: string | null;
}

/** The probe transport: `org.check_handle` as the caller in the service, a stub in a test. */
export type HandleProbe = (handle: string) => Promise<RpcOutcome<RawHandleVerdict>>;

// #endregion

// #region Probe

/** Fold a raw verdict into the SSOT shape, capped to its declared lengths. */
function toHandleCheck(raw: RawHandleVerdict): HandleCheck {
	return {
		handle: raw.handle.slice(0, WORKSPACE_HANDLE_MAX),
		available: raw.available,
		reason: raw.reason ? raw.reason.slice(0, 160) : null,
		suggestions: [],
	};
}

/**
 * Probe `handle` through `probe`; when it is taken, probe its alternatives together and answer with
 * the first {@link HANDLE_SUGGESTION_COUNT} that are free, in the order they were proposed. A
 * candidate whose probe fails is simply not offered — the verdict on the handle asked about still
 * stands.
 */
export async function checkHandleWith(
	handle: string,
	probe: HandleProbe,
): Promise<ServiceResult<HandleCheck>> {
	const res = await probe(handle);
	if (!res.ok) return res.refusal;
	const verdict = toHandleCheck(res.data);
	if (verdict.available || handleRefusalOf(verdict.reason) !== "taken") return ok(verdict);

	const answers = await Promise.all(
		handleAlternatives(verdict.handle).map(async (candidate) => {
			try {
				const one = await probe(candidate);
				return one.ok && one.data.available ? candidate : null;
			} catch {
				return null;
			}
		}),
	);
	const suggestions = answers
		.filter((candidate): candidate is string => candidate !== null)
		.slice(0, HANDLE_SUGGESTION_COUNT);
	return ok({ ...verdict, suggestions });
}

/** Probe a handle as the caller, with alternatives when it is taken. */
export function checkHandle(handle: string, actor: LiveActor): Promise<ServiceResult<HandleCheck>> {
	return checkHandleWith(
		handle,
		(one) => callRpc<RawHandleVerdict>(actor, "org", "check_handle", { p_handle: one }),
	);
}

// #endregion
