import { type Signal, useSignal } from "@preact/signals";
import { LocalKeys, writeStored } from "@web/utils/storage-keys.ts";
import { WorkspaceService } from "./WorkspaceService.ts";
import type { SwitchContextInput } from "@projective/types/workspace";

/**
 * useContextSwitch — the SHARED hook that changes the session's acting context.
 *
 * Two surfaces switch context: the workspace roster/console (entering a team or business) and the header
 * account popover (its team/business switcher and its "back to personal" exit). They must behave
 * identically, so the sequence lives here once rather than being re-implemented on each side and slowly
 * diverging.
 *
 * ## The sequence, and why all three steps are mandatory
 *
 * ```
 *   POST /api/context/switch   →   POST /api/auth/refresh   →   hard navigation
 *   (server session state)         (re-mint the token)           (re-render everything)
 * ```
 *
 * **1. Switch.** `/api/context/switch` writes the acting context server-side (`security.session_context`,
 * via the fat service). On its own this changes *nothing the browser can see*.
 *
 * **2. Refresh — the step that is easy to omit and fatal to omit.** The acting context is not read from a
 * database on every request; it is stamped into the access token by the Supabase custom access-token hook
 * (`public.custom_access_token_hook`, Decision #17) and read back from `app_metadata.active_context` to
 * resolve `ctx.state.userContext` (Decision #16). The token the browser is holding was minted *before*
 * the switch, so until it is re-minted every band — the global sidebar's gated rail, the header's Create
 * menu, the account badge, the lane's module list — keeps rendering the PREVIOUS context. The user would
 * be acting as their team while the entire chrome insists they are acting personally: the UI would be
 * lying, and RLS (which reads the same token's claims) would be enforcing the old context underneath.
 * `POST /api/auth/refresh` exchanges the refresh token for a freshly-stamped access token, so the claims
 * and the session finally agree.
 *
 * **3. Hard navigation.** `globalThis.location.assign()`, never a client-side route change. The context
 * is resolved *server-side during SSR* and threaded into every shell slot; a soft navigation would
 * re-render islands while leaving the server-painted chrome (lane, header band, footer band, sidebar
 * gating) exactly as it was. A full document load is the only thing that re-derives all of it from the new
 * JWT.
 *
 * ## Failure is surfaced, never navigated past
 *
 * If the refresh fails, the hook **does not navigate**. The session and the token now disagree, and
 * loading a workspace under the previous identity would produce a screen that is wrong in a way the reader
 * cannot see — half the chrome from one context, half the permissions from another. Reporting it and
 * letting them retry is the honest outcome.
 *
 * ## The caller's obligation
 *
 * A context switch is a full page load and takes real time. Callers **must** render `switching` as an
 * honest transition state — a disabled trigger with a progress affordance and an `aria-busy`/`aria-live`
 * announcement — and must render `error` when it is set. A trigger that looks idle while a switch is in
 * flight invites a second click, which is why the hook also refuses re-entry while `switching` is true.
 *
 * @example
 * ```tsx
 * const { switching, error, switchTo, exitToPersonal } = useContextSwitch();
 * <button disabled={switching.value} aria-busy={switching.value}
 *   onClick={() => switchTo("team", team.id, { destination: `/teams/${team.id}`, handle: team.handle })}>
 *   {switching.value ? "Switching…" : `Act as ${team.name}`}
 * </button>
 * ```
 */

// #region Types
/** The structural contexts a session can act within (the SSOT's {@link SwitchContextInput} vocabulary). */
export type SwitchContextType = SwitchContextInput["contextType"];

/** Options for a single switch. */
export interface SwitchOptions {
	/**
	 * Where to land after the switch. Defaults to the current path, which re-renders the same screen under
	 * the new context — the right default for the account popover's in-place switcher.
	 */
	destination?: string;
	/**
	 * The entity's `@handle`, cached as a chrome hint so the account popover can pre-paint the last active
	 * context before the token is decoded. Purely cosmetic; it grants nothing.
	 */
	handle?: string;
}

/** The hook's surface. */
export interface ContextSwitchApi {
	/** Whether a switch is in flight. Render this — see the caller's obligation above. */
	switching: Signal<boolean>;
	/** A human-readable failure, or `null`. Set from the server's own message where one is given. */
	error: Signal<string | null>;
	/** Switch into a context. Resolves `false` when the switch did not complete (no navigation happened). */
	switchTo: (
		contextType: SwitchContextType,
		contextId: string | null,
		options?: SwitchOptions,
	) => Promise<boolean>;
	/** Return to acting personally. */
	exitToPersonal: (options?: SwitchOptions) => Promise<boolean>;
}
// #endregion

// #region Token refresh
/**
 * Re-mint the access token so the newly-stamped context claims reach the browser.
 *
 * Deliberately a bare `fetch`, not `apiFetch`: `apiFetch`'s own recovery path is a call to this very
 * endpoint, so routing through it would nest a refresh inside a refresh.
 */
async function remintSession(): Promise<boolean> {
	try {
		const res = await fetch("/api/auth/refresh", {
			method: "POST",
			headers: { accept: "application/json" },
		});
		return res.ok;
	} catch {
		return false;
	}
}
// #endregion

// #region Hook
/** The shared acting-context switcher. See the module header for the sequence and its rationale. */
export function useContextSwitch(): ContextSwitchApi {
	const switching = useSignal(false);
	const error = useSignal<string | null>(null);

	async function switchTo(
		contextType: SwitchContextType,
		contextId: string | null,
		options: SwitchOptions = {},
	): Promise<boolean> {
		// A switch ends in a full page load; a second one mid-flight would race the navigation.
		if (switching.value) return false;
		switching.value = true;
		error.value = null;

		const result = await WorkspaceService.switchContext({ contextType, contextId });
		if (!result.ok) {
			error.value = result.message ?? "Could not switch context — please try again.";
			switching.value = false;
			return false;
		}

		// Without this the browser keeps a token stamped with the OLD context and every band lies.
		const reminted = await remintSession();
		if (!reminted) {
			error.value =
				"Switched, but your session could not be refreshed. Reload the page to finish switching.";
			switching.value = false;
			return false;
		}

		if (options.handle) {
			writeStored("local", LocalKeys.LAST_ACTIVE_CONTEXT, options.handle);
		}

		// A hard load is the only thing that re-derives the server-painted chrome from the new claims.
		// `switching` is left true on purpose: the document is being replaced, and flipping the trigger
		// back to idle for the last few frames would flash an interactive control that does nothing.
		const destination = options.destination ?? currentPath();
		globalThis.location.assign(destination);
		return true;
	}

	function exitToPersonal(options: SwitchOptions = {}): Promise<boolean> {
		return switchTo("personal", null, options);
	}

	return { switching, error, switchTo, exitToPersonal };
}

/** The current path + query, so an in-place switch returns to exactly where the user was. */
function currentPath(): string {
	try {
		return globalThis.location.pathname + globalThis.location.search;
	} catch {
		return "/";
	}
}
// #endregion
