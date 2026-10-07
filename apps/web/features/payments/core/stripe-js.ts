import type { StripeDeferredElementsOptions } from "./stripe-flow.ts";

/**
 * stripe-js — the one loader for Stripe.js in the browser.
 *
 * Loaded on demand, by the surface that is about to collect a card (the wallet's Top up and Add card
 * dialogs, a card checkout), rather than in every page's `<head>`: a third-party script on the landing
 * page, a profile and every settings screen costs every visitor a network round trip and a JS parse for
 * a form most of them never open. The script is the versioned `dahlia` build — the same release line as
 * the server's pinned API version (`2026-08-26.dahlia`, `packages/backend/core/stripe.ts`) — and it is
 * always loaded from js.stripe.com, never self-hosted (PCI: Stripe must serve the code that touches the
 * card number). The CSP in `routes/_middleware.ts` allows exactly this origin.
 *
 * Only the handful of methods Projective calls are typed here; `@stripe/stripe-js` is not a dependency.
 */

// #region Types
/** An Elements group bound to an intent that already exists (a top-up, a card checkout). */
export interface StripeIntentElementsOptions {
	clientSecret: string;
}

/**
 * What an Elements group is created with: an existing intent's client secret, or the deferred
 * options of a form mounted before its intent exists (`stripe-flow.ts`) — painted in the tokens.
 */
export type StripeElementsOptions =
	& (StripeIntentElementsOptions | StripeDeferredElementsOptions)
	& { appearance?: StripeAppearance };

/** The subset of the Stripe.js object Projective uses. */
export interface StripeJs {
	elements(options: StripeElementsOptions): StripeElements;
	confirmPayment(options: {
		elements: StripeElements;
		/** Required when the group was mounted deferred: the PaymentIntent created at confirm. */
		clientSecret?: string;
		redirect: "if_required";
		confirmParams: { return_url: string };
	}): Promise<{ error?: StripeJsError; paymentIntent?: { id: string; status: string } }>;
	confirmSetup(options: {
		elements: StripeElements;
		/** Required when the group was mounted deferred: the SetupIntent created at Save. */
		clientSecret?: string;
		redirect: "if_required";
		confirmParams: { return_url: string };
	}): Promise<{ error?: StripeJsError; setupIntent?: { id: string; status: string } }>;
	/** Answer a server-confirmed intent's next action (3-D Secure) in place. */
	handleNextAction(options: {
		clientSecret: string;
	}): Promise<{ error?: StripeJsError; paymentIntent?: { id: string; status: string } }>;
}

/** The Elements group a Payment Element belongs to. */
export interface StripeElements {
	create(type: "payment", options?: Record<string, unknown>): StripePaymentElement;
	create(type: "expressCheckout", options?: Record<string, unknown>): StripeExpressCheckoutElement;
	submit(): Promise<{ error?: StripeJsError }>;
}

/**
 * A mounted Express Checkout Element — Stripe's own Apple Pay, Google Pay and PayPal buttons, shown
 * only where the device, the browser and the account can actually pay with them.
 */
export interface StripeExpressCheckoutElement {
	mount(el: HTMLElement): void;
	destroy(): void;
	/** `availablePaymentMethods` is `undefined` when NO wallet can be shown on this device. */
	on(
		event: "ready",
		handler: (event: { availablePaymentMethods?: Record<string, boolean> }) => void,
	): void;
	/** A button was pressed: `resolve()` must be called within a second or the sheet does not open. */
	on(event: "click", handler: (event: { resolve(options?: Record<string, unknown>): void }) => void): void;
	/** The buyer approved in the wallet sheet; report a failure back to the sheet with `paymentFailed`. */
	on(
		event: "confirm",
		handler: (event: {
			expressPaymentType: string;
			paymentFailed(options?: { reason?: "fail" | "invalid_payment_data" | "invalid_shipping_address" }): void;
		}) => void,
	): void;
	on(event: "cancel", handler: () => void): void;
	on(event: "loaderror", handler: (event: StripeElementEvent) => void): void;
}

/** What a Payment Element event carries: `complete` on `change`, `error` on `loaderror`. */
export interface StripeElementEvent {
	complete?: boolean;
	error?: StripeJsError;
}

/** A mounted Payment Element. */
export interface StripePaymentElement {
	mount(el: HTMLElement): void;
	destroy(): void;
	on(event: "ready" | "change" | "loaderror", handler: (event: StripeElementEvent) => void): void;
}

/** A Stripe.js error — its `message` is written for the person paying and is safe to show. */
export interface StripeJsError {
	type: string;
	code?: string;
	message?: string;
}

/** The Appearance API subset used to paint the Element in the design tokens. */
export interface StripeAppearance {
	theme?: "stripe" | "night" | "flat";
	variables?: Record<string, string>;
}

declare global {
	var Stripe: ((publishableKey: string) => StripeJs) | undefined;
}
// #endregion

// #region Loader
const STRIPE_JS_URL = "https://js.stripe.com/dahlia/stripe.js";
let loading: Promise<void> | null = null;
const clients = new Map<string, StripeJs>();

/** Inject the script once; resolve when `window.Stripe` exists. */
function loadScript(): Promise<void> {
	if (typeof globalThis.Stripe === "function") return Promise.resolve();
	if (loading) return loading;
	loading = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS_URL}"]`);
		const script = existing ?? document.createElement("script");
		const done = () => (typeof globalThis.Stripe === "function" ? resolve() : reject(new Error("Stripe.js did not load")));
		script.addEventListener("load", done, { once: true });
		script.addEventListener("error", () => reject(new Error("Stripe.js could not be loaded")), { once: true });
		if (!existing) {
			script.src = STRIPE_JS_URL;
			script.async = true;
			document.head.appendChild(script);
		}
	}).catch((error) => {
		loading = null;
		throw error;
	});
	return loading;
}

/**
 * The Stripe.js client for a publishable key, loading the script on first use. Rejects when the key is
 * missing (the server withholds a key from the other mode) or the script cannot load (offline, blocked).
 */
export async function loadStripe(publishableKey: string | null): Promise<StripeJs> {
	if (!publishableKey) throw new Error("Card payments aren't configured in this environment.");
	await loadScript();
	const existing = clients.get(publishableKey);
	if (existing) return existing;
	const client = globalThis.Stripe!(publishableKey);
	clients.set(publishableKey, client);
	return client;
}
// #endregion

// #region Appearance
/**
 * Paint the Payment Element in the live design tokens. The Element renders in Stripe's own iframe, so it
 * cannot read `var(--*)`; the RESOLVED values are read from the document and handed over, which keeps
 * it on-theme in light, dark and high contrast without a hard-coded colour anywhere.
 */
export function appearanceFromTokens(root: Element = document.documentElement): StripeAppearance {
	const css = getComputedStyle(root);
	const token = (name: string) => css.getPropertyValue(name).trim();
	const dark = document.documentElement.dataset.theme === "dark";
	const variables: Record<string, string> = {};
	const set = (key: string, value: string) => {
		if (value) variables[key] = value;
	};
	set("colorPrimary", token("--primary"));
	set("colorBackground", token("--surface"));
	set("colorText", token("--on-surface"));
	set("colorTextSecondary", token("--on-surface-variant"));
	set("colorDanger", token("--danger"));
	set("borderRadius", token("--radius-md"));
	// The type family lives on <body>, not on the root; a family the iframe cannot load falls back to
	// Stripe's own default rather than a serif, so the system stack is appended.
	set("fontFamily", `${getComputedStyle(document.body).fontFamily}, system-ui, sans-serif`);
	return { theme: dark ? "night" : "stripe", variables };
}
// #endregion
