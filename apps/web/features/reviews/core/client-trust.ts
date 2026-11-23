import { signal } from "@preact/signals";
import type { ClientTrustWarning } from "@projective/types/reviews";

/**
 * client-trust — the Informed Consent a freelancer gives before applying to, or accepting a hire on, a
 * warned client's project (Decision #486 (C); PRODUCT_SPEC §Reputation 3, The Warning System).
 *
 * `ensureClientTrustConsent` asks `/api/reviews/client-trust` whether the project's client is warned.
 * When it is and the freelancer has not acknowledged it, it opens {@link ClientTrustDialog} and resolves
 * once they acknowledge (`true`, logged through the route) or cancel (`false`). The caller opens its
 * own dialog or sends its request only after that, so one dialog shows at a time. The database refuses
 * the proposal and the acceptance (428) without the logged acknowledgement, so a failed read here lets
 * the caller go on and meet the door.
 *
 * The Dev Context Switcher's `clientTrust` axis (`data-dev-client-trust="warned"`) restates any project
 * as warned so the dialog can be seen without the seed's one warned client; the acknowledgement it
 * posts is then a no-op at the door.
 */

// #region State
/** What the open dialog states: the project's slug and the warning read for it. */
export interface ClientTrustAsk {
	project: string;
	warning: ClientTrustWarning;
}

/** The dialog's `visible`: one per page, rendered by whichever island asked. */
export const clientTrustOpen = signal(false);
/** The ask the dialog is showing, or `null`. */
export const clientTrustAsk = signal<ClientTrustAsk | null>(null);
/** The acknowledgement's refusal, shown above the dialog's footer. */
export const clientTrustError = signal<string | null>(null);
/** While the acknowledgement posts. */
export const clientTrustBusy = signal(false);

let settle: ((acknowledged: boolean) => void) | null = null;
// #endregion

// #region Reads
const SIMULATED: ClientTrustWarning = {
	warned: true,
	score: 2.71,
	reviewCount: 5,
	reviewsHref: null,
	acknowledged: false,
};

function simulated(): boolean {
	try {
		return document.documentElement.dataset.devClientTrust === "warned";
	} catch {
		return false;
	}
}

async function readWarning(project: string): Promise<ClientTrustWarning | null> {
	if (simulated()) return SIMULATED;
	try {
		const res = await fetch(`/api/reviews/client-trust?project=${encodeURIComponent(project)}`, {
			headers: { accept: "application/json" },
		});
		if (!res.ok) return null;
		const body = await res.json() as { data?: ClientTrustWarning };
		return body.data ?? null;
	} catch {
		return null;
	}
}
// #endregion

// #region The ask
/**
 * Resolves `true` when the caller may go on: the client is not warned, the freelancer acknowledged it
 * before, or acknowledges it now. `false` when they cancel.
 */
export async function ensureClientTrustConsent(project: string): Promise<boolean> {
	const warning = await readWarning(project);
	if (!warning || !warning.warned || warning.acknowledged) return true;
	settle?.(false);
	clientTrustAsk.value = { project, warning };
	clientTrustError.value = null;
	clientTrustOpen.value = true;
	return await new Promise<boolean>((resolve) => {
		settle = resolve;
	});
}

/** The dialog's commit: log the acknowledgement, close, and let the caller go on. */
export async function acknowledgeClientTrust(): Promise<void> {
	const ask = clientTrustAsk.value;
	if (!ask) return;
	clientTrustBusy.value = true;
	clientTrustError.value = null;
	try {
		const res = await fetch("/api/reviews/client-trust", {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ project: ask.project }),
		});
		const body = await res.json().catch(() => null) as { message?: string } | null;
		if (!res.ok) {
			clientTrustError.value = body?.message ?? "That didn't go through. Try again.";
			return;
		}
	} catch {
		clientTrustError.value = "That didn't go through. Try again.";
		return;
	} finally {
		clientTrustBusy.value = false;
	}
	finish(true);
}

/** The dialog closed without the acknowledgement. */
export function cancelClientTrust(): void {
	finish(false);
}

function finish(acknowledged: boolean): void {
	clientTrustOpen.value = false;
	const done = settle;
	settle = null;
	done?.(acknowledged);
}
// #endregion
