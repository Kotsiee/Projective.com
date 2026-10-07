import { type ReadonlySignal, type Signal, useComputed, useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import type { CardSetupConfig } from "@projective/types/finance";
import { PaymentsService } from "../core/PaymentsService.ts";
import {
	appearanceFromTokens,
	loadStripe,
	type StripeElements,
	type StripeElementsOptions,
	type StripeJs,
	type StripePaymentElement,
} from "../core/stripe-js.ts";
import { cardSetupElementsOptions, returnPathOf } from "../core/stripe-flow.ts";

/**
 * The Stripe Payment Element as a CONTROLLER, separate from the view that mounts it.
 *
 * A dialog's commit belongs in its `footer` slot (DESIGN_SYSTEM §B.10.8), not at the end of its
 * scrolling body, so the button that confirms the card cannot live inside the component that draws
 * the card form. These hooks own the Stripe.js objects and expose what a footer needs — `ready`,
 * `complete`, `confirming`, `error`, `canConfirm` and `confirm()` — while `StripeElementMount` only
 * draws the frame and hands its node to {@link StripeElementController.mount}.
 *
 * - {@link useStripeCardSetup} — save a card with the DEFERRED flow: the card form mounts at once
 *   (`elements({ mode: 'setup', currency, allowedPaymentMethodTypes: ['card'] })`), and only on
 *   confirm does it run `elements.submit()` → open the SetupIntent server-side →
 *   `stripe.confirmSetup({ elements, clientSecret })`.
 * - {@link useStripeIntent} — confirm an intent that already exists (a top-up, a card checkout).
 *
 * The card number is typed into Stripe's own iframe and never reaches Projective's DOM, network or
 * server. `useEffect`/`useRef` are the sanctioned exception for an external, non-reactive DOM library
 * (root CLAUDE.md §3); every value a surface renders is a signal.
 */

// #region Types
/** What happened when the person confirmed: the intent's id and Stripe's status, or why not. */
export type StripeConfirmOutcome =
	| { ok: true; status: string; id: string }
	| { ok: false; message: string };

/** The controller a card form's host renders from and confirms through. */
export interface StripeElementController {
	/** `setup` saves a card; `payment` charges one. */
	mode: "payment" | "setup";
	/** Callback ref for the node the Payment Element mounts into (`StripeElementMount` wires it). */
	mount: (node: HTMLDivElement | null) => void;
	/** The Element has rendered and can take a card. */
	ready: ReadonlySignal<boolean>;
	/** The details typed so far are complete enough to submit. */
	complete: ReadonlySignal<boolean>;
	/** A confirmation is in flight. */
	confirming: ReadonlySignal<boolean>;
	/** Why the form can't load or the last confirmation failed — Stripe's own text, safe to show. */
	error: ReadonlySignal<string | null>;
	/** Whether the confirming control may be pressed: ready, complete, nothing in flight. */
	canConfirm: ReadonlySignal<boolean>;
	/** Confirm with Stripe. Never throws; a failure also lands in {@link error}. */
	confirm: () => Promise<StripeConfirmOutcome>;
}

/** The SetupIntent a card-setup host opens at confirm time, or why it couldn't. */
export type SetupIntentStart =
	| { ok: true; setupIntentId: string; clientSecret: string }
	| { ok: false; message: string };

/** Options for {@link useStripeCardSetup}. */
export interface StripeCardSetupOptions {
	/**
	 * Mount only while true — the dialog is open and on the card tab. Nothing is fetched and Stripe.js
	 * is not loaded before the first time it is.
	 */
	enabled: boolean;
	/** The account's currency (ISO); the Payment Element requires one in deferred mode. */
	currency: string;
	/**
	 * Open the SetupIntent server-side — called on confirm, after `elements.submit()` has validated
	 * the card, with the host's own authorisation (the wallet's `add_method`, the checkout's owner).
	 */
	createIntent: () => Promise<SetupIntentStart>;
	/**
	 * Where Stripe returns a browser after a redirect-based step (a bank's 3-D Secure page): a
	 * same-origin path. Defaults to the page in view with its query intact, read at confirm time.
	 */
	returnPath?: string;
}

/** Options for {@link useStripeIntent}. */
export interface StripeIntentOptions {
	/** `payment` confirms a PaymentIntent (a charge); `setup` a SetupIntent (a saved card). */
	mode: "payment" | "setup";
	/** The intent's client secret, from the server's handoff. Never stored, never logged. */
	clientSecret: string;
	/** The publishable key from the same handoff (`null` when the server has none for this mode). */
	publishableKey: string | null;
	/** As {@link StripeCardSetupOptions.returnPath}. */
	returnPath?: string;
}
// #endregion

// #region Shared mount
/** What to mount: `key` changes exactly when a different Elements group is needed. */
interface GroupSource {
	key: string;
	publishableKey: string | null;
	options: () => StripeElementsOptions;
}

interface ElementGroup {
	mount: (node: HTMLDivElement | null) => void;
	stripe: { current: StripeJs | null };
	elements: { current: StripeElements | null };
	ready: Signal<boolean>;
	complete: Signal<boolean>;
	confirming: Signal<boolean>;
	error: Signal<string | null>;
}

const LOAD_FAILED = "Couldn't load the card form.";

/** The absolute return URL Stripe needs, from a same-origin path (or the page in view). */
function returnUrlOf(path: string | undefined): string {
	const location = globalThis.location;
	return new URL(path ?? returnPathOf(location), location.origin).toString();
}

/**
 * Load Stripe.js, create the Elements group and mount one Payment Element into the node the view
 * hands over — again whenever the source's key or the node changes, destroying the previous one.
 */
function useElementGroup(source: GroupSource | null): ElementGroup {
	const node = useSignal<HTMLDivElement | null>(null);
	const stripe = useRef<StripeJs | null>(null);
	const elements = useRef<StripeElements | null>(null);
	const ready = useSignal(false);
	const complete = useSignal(false);
	const confirming = useSignal(false);
	const error = useSignal<string | null>(null);
	const latest = useRef(source);
	latest.current = source;

	const mount = useCallback((el: HTMLDivElement | null) => {
		node.value = el;
	}, []);

	const el = node.value;
	const key = source?.key ?? null;

	useEffect(() => {
		const current = latest.current;
		if (!el || !current) return;
		let element: StripePaymentElement | null = null;
		let cancelled = false;
		ready.value = false;
		complete.value = false;
		error.value = null;
		loadStripe(current.publishableKey).then((client) => {
			if (cancelled) return;
			stripe.current = client;
			const group = client.elements({ ...current.options(), appearance: appearanceFromTokens() });
			elements.current = group;
			element = group.create("payment", { layout: "tabs" });
			element.on("ready", () => {
				if (!cancelled) ready.value = true;
			});
			element.on("change", (event) => {
				if (!cancelled) complete.value = event.complete === true;
			});
			element.on("loaderror", (event) => {
				if (!cancelled) error.value = event.error?.message ?? LOAD_FAILED;
			});
			element.mount(el);
		}).catch((reason) => {
			if (!cancelled) error.value = reason instanceof Error ? reason.message : LOAD_FAILED;
		});
		return () => {
			cancelled = true;
			element?.destroy();
			elements.current = null;
			ready.value = false;
			complete.value = false;
		};
	}, [el, key]);

	return { mount, stripe, elements, ready, complete, confirming, error };
}

/** Run one confirmation: guard re-entry, clear the last error, record a failure where it shows. */
async function confirmWith(
	group: ElementGroup,
	run: (client: StripeJs, elements: StripeElements) => Promise<StripeConfirmOutcome>,
): Promise<StripeConfirmOutcome> {
	const client = group.stripe.current;
	const elements = group.elements.current;
	if (!client || !elements || !group.ready.value) {
		return { ok: false, message: "The card form isn't ready yet." };
	}
	if (group.confirming.value) return { ok: false, message: "Already confirming." };
	group.confirming.value = true;
	group.error.value = null;
	try {
		const outcome = await run(client, elements);
		if (!outcome.ok) group.error.value = outcome.message;
		return outcome;
	} catch {
		const message = "That didn't go through. Check your connection and try again.";
		group.error.value = message;
		return { ok: false, message };
	} finally {
		group.confirming.value = false;
	}
}

function controllerOf(
	mode: "payment" | "setup",
	group: ElementGroup,
	error: ReadonlySignal<string | null>,
	canConfirm: ReadonlySignal<boolean>,
	confirm: () => Promise<StripeConfirmOutcome>,
): StripeElementController {
	return {
		mode,
		mount: group.mount,
		ready: group.ready,
		complete: group.complete,
		confirming: group.confirming,
		error,
		canConfirm,
		confirm,
	};
}
// #endregion

// #region Deferred card setup
type ConfigAnswer = { ok: true; config: CardSetupConfig } | { ok: false; message: string };

/** One read of the card-setup config per page; a refusal is not kept, so signing in can clear it. */
let configLoad: Promise<ConfigAnswer> | null = null;

function loadCardSetupConfig(): Promise<ConfigAnswer> {
	configLoad ??= PaymentsService.cardSetupConfig().then((res): ConfigAnswer => {
		if (res.ok && res.data) return { ok: true, config: res.data };
		configLoad = null;
		return { ok: false, message: res.message ?? LOAD_FAILED };
	});
	return configLoad;
}

/**
 * Save a card with Stripe's deferred-intent flow: the card form mounts as soon as the host is
 * enabled, before any SetupIntent exists, and the intent is opened only when the person confirms.
 */
export function useStripeCardSetup(options: StripeCardSetupOptions): StripeElementController {
	const config = useSignal<CardSetupConfig | null>(null);
	const configError = useSignal<string | null>(null);
	const latest = useRef(options);
	latest.current = options;

	const enabled = options.enabled;
	useEffect(() => {
		if (!enabled || config.value) return;
		let cancelled = false;
		configError.value = null;
		void loadCardSetupConfig().then((answer) => {
			if (cancelled) return;
			if (answer.ok) config.value = answer.config;
			else configError.value = answer.message;
		});
		return () => {
			cancelled = true;
		};
	}, [enabled]);

	const loaded = config.value;
	const currency = options.currency.trim().toLowerCase();
	const group = useElementGroup(
		enabled && loaded
			? {
				key: `setup:${loaded.publishableKey ?? ""}:${currency}`,
				publishableKey: loaded.publishableKey,
				options: () => cardSetupElementsOptions(currency),
			}
			: null,
	);
	const error = useComputed(() => configError.value ?? group.error.value);
	const canConfirm = useComputed(() =>
		group.ready.value && group.complete.value && !group.confirming.value
	);

	const confirm = () =>
		confirmWith(group, async (client, elements) => {
			const submitted = await elements.submit();
			if (submitted.error) {
				return { ok: false, message: submitted.error.message ?? "Check the card details." };
			}
			const intent = await latest.current.createIntent();
			if (!intent.ok) return intent;
			const result = await client.confirmSetup({
				elements,
				clientSecret: intent.clientSecret,
				redirect: "if_required",
				confirmParams: { return_url: returnUrlOf(latest.current.returnPath) },
			});
			if (result.error) {
				return { ok: false, message: result.error.message ?? "The card couldn't be saved." };
			}
			return {
				ok: true,
				status: result.setupIntent?.status ?? "processing",
				id: result.setupIntent?.id ?? intent.setupIntentId,
			};
		});

	return controllerOf("setup", group, error, canConfirm, confirm);
}
// #endregion

// #region Existing intent
/** Confirm an intent the server already opened — a top-up's or a card checkout's PaymentIntent. */
export function useStripeIntent(options: StripeIntentOptions): StripeElementController {
	const latest = useRef(options);
	latest.current = options;
	const group = useElementGroup({
		key: `${options.mode}:${options.publishableKey ?? ""}:${options.clientSecret}`,
		publishableKey: options.publishableKey,
		options: () => ({ clientSecret: latest.current.clientSecret }),
	});
	const canConfirm = useComputed(() =>
		group.ready.value && group.complete.value && !group.confirming.value
	);

	const confirm = () =>
		confirmWith(group, async (client, elements) => {
			const submitted = await elements.submit();
			if (submitted.error) {
				return { ok: false, message: submitted.error.message ?? "Check the card details." };
			}
			const confirmParams = { return_url: returnUrlOf(latest.current.returnPath) };
			if (latest.current.mode === "payment") {
				const result = await client.confirmPayment({
					elements,
					redirect: "if_required",
					confirmParams,
				});
				if (result.error) {
					return { ok: false, message: result.error.message ?? "The payment didn't go through." };
				}
				return {
					ok: true,
					status: result.paymentIntent?.status ?? "processing",
					id: result.paymentIntent?.id ?? "",
				};
			}
			const result = await client.confirmSetup({
				elements,
				redirect: "if_required",
				confirmParams,
			});
			if (result.error) {
				return { ok: false, message: result.error.message ?? "The card couldn't be saved." };
			}
			return {
				ok: true,
				status: result.setupIntent?.status ?? "processing",
				id: result.setupIntent?.id ?? "",
			};
		});

	return controllerOf(options.mode, group, group.error, canConfirm, confirm);
}
// #endregion
