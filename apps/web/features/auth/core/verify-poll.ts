import type { AuthResult } from "../types/mod.ts";

/**
 * What `/verify` does with one confirmation-poll answer (Decision #185): keep waiting, continue into
 * the app (this browser holds a session), or show "Email confirmed — sign in" (confirmed elsewhere).
 */
export type VerifyPollOutcome = "pending" | "continue" | "sign_in";

/** The Dev Context Switcher's `/verify` poll positions, declared here so this model stays DOM-free. */
export type VerifyPollSimulation = "auto" | "pending" | "confirmed" | "confirmed_signed_in";

/** Map a poll answer to the page's next step. A refused or failed poll keeps waiting. */
export function verifyPollOutcome(result: AuthResult): VerifyPollOutcome {
	if (!result.ok || result.verified !== true) return "pending";
	return result.signedIn === true ? "continue" : "sign_in";
}

/** The answer a simulated position stands in for, or `null` to ask the server. */
export function simulatedPollResult(
	simulation: VerifyPollSimulation,
	redirectTo: string,
): AuthResult | null {
	switch (simulation) {
		case "auto":
			return null;
		case "pending":
			return { ok: true, verified: false, redirectTo };
		case "confirmed":
			return { ok: true, verified: true, signedIn: false, redirectTo };
		case "confirmed_signed_in":
			return { ok: true, verified: true, signedIn: true, redirectTo };
	}
}
