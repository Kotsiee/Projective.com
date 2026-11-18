import { currentLegalVersions } from "@projective/types/legal";
import { LEGAL_ACCEPTANCE_REQUIRED } from "@projective/types/auth";
import { getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";

// #region Contracts
/** A signed-in person accepting the versions in effect today (`/join?complete=terms`). */
export interface ReacceptTermsInput {
	/** The caller's access token: the acceptance is written under their JWT, never the service role. */
	accessToken?: string;
	/** The consent box; the versions are stamped here, never taken from the caller. */
	acceptTerms: true;
	/** Server-sanitised return path. */
	redirectTo: string;
}

/** Where the re-accept step sends the person next. */
export interface ReacceptTermsResult {
	redirectTo: string;
	/** Rows `public.accept_current_terms` wrote (0 when everything was already accepted). */
	recorded: number;
}
// #endregion

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";
const TERMS_CHANGED =
	"The terms changed while this page was open. Reload to read the current version.";
const REACCEPT_UNAVAILABLE = "We couldn't save that just now. Please try again in a moment.";

/**
 * LegalAcceptanceBackendService — the re-accept door of Decision #446. Sign-up records its acceptance
 * inside the provisioning transaction (`AuthBackendService`); this service owns the later one, when a
 * material new version of the Terms or the Acceptable Use Policy takes effect and the dashboard guard
 * holds the person on `/join?complete=terms` until they accept it.
 */
export const LegalAcceptanceBackendService = {
	/**
	 * Record the caller's acceptance of today's versions through `public.accept_current_terms`, under
	 * their own JWT. The database re-checks the stamp, so a version published while the page was open
	 * is refused (409) rather than recorded against text the person never saw. The token keeps saying
	 * `termsDue` until it is renewed; the dashboard guard renews it before acting on that, so the
	 * bounce ends. Stub: nothing is written.
	 */
	async reaccept(input: ReacceptTermsInput): Promise<ServiceResult<ReacceptTermsResult>> {
		if (input.acceptTerms !== true) {
			return fail(422, { errors: { acceptTerms: LEGAL_ACCEPTANCE_REQUIRED } });
		}
		if (!isAuthBackendLive()) return ok({ redirectTo: input.redirectTo, recorded: 0 });
		if (!input.accessToken) return fail(401, { message: SESSION_EXPIRED });

		try {
			const { data, error } = await getUserClient(input.accessToken).rpc("accept_current_terms", {
				p_legal: currentLegalVersions(),
			});
			if (error?.code === "28000") return fail(401, { message: SESSION_EXPIRED });
			if (error?.code === "22023") return fail(409, { message: TERMS_CHANGED });
			if (error) {
				console.error("[legal:reaccept]", error.code);
				return fail(503, { message: REACCEPT_UNAVAILABLE });
			}
			return ok({ redirectTo: input.redirectTo, recorded: typeof data === "number" ? data : 0 });
		} catch (e) {
			console.error("[legal:reaccept]", e instanceof Error ? e.name : "error");
			return fail(503, { message: REACCEPT_UNAVAILABLE });
		}
	},
};
