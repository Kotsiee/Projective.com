import { useEffect } from "preact/hooks";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import {
	activeBasketId,
	activeOwner,
	devSim,
	displayCurrency,
	seedCheckoutContext,
} from "./basket-state.ts";
import type { BasketSim } from "../types/checkout-types.ts";

/**
 * checkout-seam — the client bridge from the Dev Context Switcher to the `/basket` + `/checkout`
 * surfaces, and the one place a real device capability is sniffed.
 *
 * The switcher publishes its overrides as `<html data-dev-*>` attributes, which the SERVER cannot see.
 * Every axis this surface branches on (which principal is paying, which providers are offered, whether
 * the wallet covers the bill, which cards are on file) changes data the server produced, so reading the
 * seam client-side would move nothing. The axes therefore travel as validated query params on each
 * read, and the fat service applies them as an overlay — the mechanism `/wallet` and `/teams` both use,
 * for the same reason.
 *
 * Production safety: {@link readDevSeam} returns `null` there and every dev branch is gated on
 * {@link IS_DEV}, so the whole simulation half tree-shakes out and no `sim*` param is ever appended.
 * Reading or sending the seam grants **no access** — RLS and the route guard remain the real gates, and
 * the live path ignores the overlay entirely.
 */

// #region Device capability (NOT a simulation)
/**
 * What this device can actually pay with.
 *
 * Apple Pay announces itself synchronously through `ApplePaySession`, so it can be reported honestly.
 * **Google Pay cannot**: determining availability requires Google's own `pay.js`, which this platform
 * does not load, so nothing is claimed about it — the field is left absent and the server's default
 * stands. Reporting an unknown capability as `true` would offer a buyer a route that fails at the last
 * step; reporting it as `false` would hide one that works. A developer reaches the offered state
 * through the payment-offer dev axis instead, which is what that axis is for.
 */
export function deviceWallets(): { applePay?: boolean } {
	if (typeof globalThis === "undefined") return {};
	const session = (globalThis as Record<string, unknown>).ApplePaySession as
		| { canMakePayments?: () => boolean }
		| undefined;
	if (!session) return { applePay: false };
	try {
		return { applePay: session.canMakePayments?.() === true };
	} catch {
		return { applePay: false };
	}
}
// #endregion

// #region Seam → simulation
/**
 * Map the dev seam's basket/checkout axes into a {@link BasketSim}, or `undefined` when no override is
 * active (and always in production).
 *
 * **The KYB axis is REUSED, not duplicated.** `workspaceVerification` already means exactly "this
 * entity's KYC/KYB state" and already drives the wallet and workspace consoles; the checkout's invoice
 * gate reads the same fact, so it maps onto the same control rather than shipping a near-identical
 * second one whose value could disagree with it.
 */
export function simFromSeam(seam: DevSeamState | null): BasketSim | undefined {
	if (!IS_DEV || !seam) return undefined;
	return {
		persona: seam.persona,
		workspaceRole: seam.workspaceRole,
		kyb: seam.workspaceVerification,
		actingContext: seam.actingContext,
		ownerScope: seam.basketOwner,
		providers: seam.paymentProviders,
		walletCover: seam.walletCoverage,
		cards: seam.savedCards,
		details: seam.buyerDetails,
		billing: seam.billingContext,
		invoicing: seam.invoicingMode,
		spendLimit: seam.spendLimit,
		fulfilment: seam.fulfilmentMix,
		conferencing: seam.conferencing,
	};
}

/**
 * The full simulation payload a request should carry: the device capabilities (always) merged with the
 * dev overrides (only while the switcher is on). Returns `undefined` when there is nothing at all to
 * send, so a production request from a non-Apple device is byte-identical to one from before this seam
 * existed.
 */
export function checkoutSim(seam?: DevSeamState | null): BasketSim | undefined {
	const device = deviceWallets();
	const dev = simFromSeam(seam === undefined ? readDevSeam() : seam);
	const merged: BasketSim = { ...device, ...(dev ?? {}) };
	return Object.keys(merged).length > 0 ? merged : undefined;
}
// #endregion

// #region Hook
/** What {@link useCheckoutSeam} needs to seed the shared context on mount. */
export interface CheckoutSeamOptions {
	basketId: string | null;
	owner: string;
	display: string;
	projectId?: string | null;
	serviceId?: string | null;
	/** Re-read the surface's data. Called once on mount when an override is active, then on each change. */
	onRefetch: () => void;
}

/**
 * Seed the shared context from SSR props, mirror the dev seam into {@link devSim}, and refetch whenever
 * the surface must re-read — on mount if an override is already active (the server never saw it), and on
 * every seam change afterwards.
 *
 * Inert in production beyond the seeding: `readDevSeam` returns `null`, so the first paint stands and no
 * refetch is triggered.
 */
export function useCheckoutSeam(opts: CheckoutSeamOptions): void {
	const { basketId, owner, display, projectId, serviceId, onRefetch } = opts;
	useEffect(() => {
		let first = true;
		const apply = () => {
			const seam = readDevSeam();
			devSim.value = checkoutSim(seam);
			if (first) {
				first = false;
				seedCheckoutContext({ basketId, owner, display, projectId, serviceId });
				// The SSR paint never saw the client seam, so reconcile once when one is active.
				if (seam) onRefetch();
				return;
			}
			onRefetch();
		};
		apply();
		return subscribeDevSeam(apply);
	}, [basketId, owner, display, projectId, serviceId]);
}

/**
 * The lighter half of {@link useCheckoutSeam}, for a region that renders the shared state but owns no
 * fetch of its own (the lane, the header band). It mirrors the seam and the SSR scope into the shared
 * signals without triggering a read, so a band never races the body for the same data.
 */
export function useCheckoutSeamPassive(opts: {
	basketId: string | null;
	owner: string;
	display: string;
}): void {
	const { basketId, owner, display } = opts;
	useEffect(() => {
		const apply = () => {
			devSim.value = checkoutSim();
			if (activeBasketId.value === null) activeBasketId.value = basketId;
			if (activeOwner.value === "personal") activeOwner.value = owner;
			displayCurrency.value = display;
		};
		apply();
		return subscribeDevSeam(apply);
	}, [basketId, owner, display]);
}
// #endregion
