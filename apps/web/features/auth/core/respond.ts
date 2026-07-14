import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { sessionSetCookies } from "@web/utils/auth-cookies.ts";
import type { AuthResult } from "../types/mod.ts";

/**
 * toAuthResponse — map a fat-service {@link ServiceResult} onto the auth API's `AuthResult` HTTP
 * body. This is the one place the thin `/api/auth/*` routes translate a transport-agnostic service
 * outcome into a `Response`: `ok`, the suggested status, any message/field-errors, and the success
 * payload (redirectTo / requiresVerification / verified) are folded into a single JSON body.
 *
 * When the service returns a `session` (a successful sign-in), its GoTrue tokens are minted into
 * HttpOnly `sb-*` session cookies here and kept OUT of the JSON body. The browser stores them from
 * the fetch response, so the island's subsequent `location.href` navigation is authenticated.
 */
export function toAuthResponse<T extends object>(result: ServiceResult<T>): Response {
	const body: AuthResult = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		...(result.data ?? {}),
	};
	const res = Response.json(body, { status: result.status });
	if (result.session) {
		for (const cookie of sessionSetCookies(result.session)) {
			res.headers.append("set-cookie", cookie);
		}
	}
	return res;
}
