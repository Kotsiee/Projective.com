import { signal } from "@preact/signals";

/**
 * sign-in-prompt — the cross-island bridge behind the {@link SignInPrompt} dialog.
 *
 * A control that is a claim on the reader's OWN account (follow, message, save) cannot act for a
 * guest. Rather than bounce them to `/login` the instant they press it — which throws away the page
 * they were reading — the pressing island calls {@link requestSignIn} and the single mounted prompt
 * explains what signing in unlocks and offers the standard flow, carrying the return path so the
 * reader lands back exactly here afterwards.
 *
 * Module-level signals, like every other cross-island bridge in the app (the profile's
 * `quickMessageOpen`, the board's footer ↔ body signals): the trigger and the dialog are separate
 * hydration roots, and a signal is the one thing both can reach. The open flag and the request are
 * two signals on purpose: `Dialog` binds a boolean it can write back on close, while the request
 * survives the close so the exit transition still has a sentence to render.
 */

/** What the reader was trying to do — decides the sentence the prompt opens with. */
export type SignInIntent = "hire" | "follow" | "message" | "save" | "generic";

export interface SignInRequest {
	intent: SignInIntent;
	/** The in-app path to return to after auth (sanitised by `withRedirect` at render time). */
	returnTo: string;
	/** Who or what the action was aimed at, for the sentence — a display name, never a handle. */
	subject?: string;
}

/** Whether the prompt is open — the boolean `Dialog` binds. */
export const signInPromptOpen = signal(false);

/** The most recent request; kept through the close so the exit frame keeps its copy. */
export const signInRequest = signal<SignInRequest | null>(null);

/** Open the prompt for an action a guest attempted. */
export function requestSignIn(request: SignInRequest): void {
	signInRequest.value = request;
	signInPromptOpen.value = true;
}

/** Close the prompt without acting. */
export function dismissSignIn(): void {
	signInPromptOpen.value = false;
}

/** The current page as a return path, for a trigger that has no better target. */
export function currentPath(): string {
	try {
		return globalThis.location.pathname + globalThis.location.search;
	} catch {
		return "/";
	}
}
