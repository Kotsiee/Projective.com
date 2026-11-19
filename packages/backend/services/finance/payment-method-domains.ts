import type { Stripe, StripeSettings } from "../../core/stripe.ts";
import { redactSecrets } from "./stripe-preflight.ts";

/**
 * payment-method-domains.ts — which web hosts show Stripe's Express Checkout Element, and whether
 * Stripe has each registered as a payment method domain (work order CK6, Decision #153).
 *
 * Apple Pay, Google Pay, Link and PayPal appear in Elements only on a registered domain, in test mode
 * as in live (Stripe: "Register domains for payment methods"). Checkout charges on the PLATFORM
 * account (Separate Charges & Transfers, Decision #125), so the platform registers its own hosts and
 * no `Stripe-Account` header is sent. Stripe performs Apple's merchant validation itself; a domain's
 * per-wallet `status` says whether a wallet is eligible on it, and an `inactive` one carries Stripe's
 * own `error_message` naming the step left.
 *
 * ## Shape
 *
 * - **Hosts** ({@link paymentMethodDomainHosts}): `STRIPE_PAYMENT_METHOD_DOMAINS`, else the host of
 *   `APP_URL`, normalised and de-duplicated; a host Stripe cannot verify (localhost, a reserved test
 *   name, an IP literal) is listed and skipped, never sent.
 * - **A plan per host** ({@link planDomain}), pure: register · validate · disabled · ok · skip.
 * - **A run** ({@link runPaymentMethodDomains}) over a {@link PaymentMethodDomainsPort}. A dry run only
 *   reads (`GET /v1/payment_method_domains?domain_name=`). `apply` creates a missing domain (one
 *   idempotency key per host) and re-validates one with an inactive wallet; it never re-enables a
 *   domain somebody disabled, never deletes one, and a second apply changes nothing.
 * - **Apple Pay's association file** ({@link appleDomainAssociation}): served only when a human sets
 *   `STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION` because Stripe asked for it.
 *
 * Nothing here holds or prints a key: ids are masked and every Stripe error is redacted.
 */

// #region Hosts
/** Where a host came from. */
export type DomainHostSource = "STRIPE_PAYMENT_METHOD_DOMAINS" | "APP_URL";

/** One host to register, or to list and skip. */
export interface DomainHost {
	/** The lower-case hostname, without scheme, port or path. */
	host: string;
	source: DomainHostSource;
	/** Why Stripe cannot register it (`null` when it can). */
	skip: string | null;
}

/** Top-level names reserved for testing and private networks (RFC 2606, RFC 6761, RFC 6762). */
const RESERVED_SUFFIXES = [".localhost", ".test", ".example", ".invalid", ".local", ".internal"];
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOSTNAME =
	/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A hostname out of `example.com`, `https://example.com:443/x` or `example.com/x`; `null` if none. */
function hostOf(token: string): string | null {
	const raw = token.trim();
	if (!raw) return null;
	try {
		return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(
			/\.$/,
			"",
		);
	} catch {
		return null;
	}
}

/** Why a hostname cannot be a payment method domain, or `null` when it can. */
function skipReason(host: string): string | null {
	if (host === "localhost" || RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return "a local or reserved test name; Stripe can only verify a public domain (use an HTTPS tunnel)";
	}
	if (IPV4.test(host) || host.startsWith("[")) return "an IP address, not a domain";
	if (!HOSTNAME.test(host)) return "not a public domain name";
	return null;
}

/**
 * The hosts to register: every entry of `domains` (comma- or space-separated), else the host of
 * `appUrl`. Order is kept and a repeat dropped; an entry that is not a hostname at all is listed with
 * its reason, so a typo is said rather than silently ignored.
 */
export function paymentMethodDomainHosts(
	input: { domains?: string; appUrl: string },
): DomainHost[] {
	const raw = input.domains?.includes("XXXX-XXXX") ? "" : input.domains ?? "";
	const listed = raw.split(/[\s,]+/).filter(Boolean);
	const source: DomainHostSource = listed.length ? "STRIPE_PAYMENT_METHOD_DOMAINS" : "APP_URL";
	const tokens = listed.length ? listed : [input.appUrl];
	const seen = new Set<string>();
	const out: DomainHost[] = [];
	for (const token of tokens) {
		const host = hostOf(token);
		if (host === null) {
			out.push({ host: token.trim(), source, skip: "not a hostname or URL" });
			continue;
		}
		if (seen.has(host)) continue;
		seen.add(host);
		out.push({ host, source, skip: skipReason(host) });
	}
	return out;
}
// #endregion

// #region What Stripe holds
/** The wallets the Express Checkout Element can show, as a payment method domain reports them. */
export const EXPRESS_WALLETS = ["apple_pay", "google_pay", "link", "paypal"] as const;
export type ExpressWallet = (typeof EXPRESS_WALLETS)[number];

/** One wallet's eligibility on a domain. */
export interface WalletStatus {
	status: "active" | "inactive";
	/** Stripe's own reason an inactive wallet is not eligible, redacted; else `null`. */
	error: string | null;
}

/** A registered payment method domain, as the run needs it. */
export interface DomainView {
	id: string;
	domain: string;
	enabled: boolean;
	livemode: boolean;
	wallets: Record<ExpressWallet, WalletStatus>;
}

/** The three calls the run makes. A fixture implements it in the tests. */
export interface PaymentMethodDomainsPort {
	/** `GET /v1/payment_method_domains?domain_name=` — the domain's registration, or `null`. */
	find(domain: string): Promise<DomainView | null>;
	/** `POST /v1/payment_method_domains` with one idempotency key per host. */
	create(domain: string): Promise<DomainView>;
	/** `POST /v1/payment_method_domains/:id/validate` — re-check each wallet's eligibility. */
	validate(id: string): Promise<DomainView>;
}

function walletOf(
	raw: { status?: string; status_details?: { error_message?: string } } | undefined,
): WalletStatus {
	const message = raw?.status_details?.error_message;
	return {
		status: raw?.status === "active" ? "active" : "inactive",
		error: message ? redactSecrets(message) : null,
	};
}

/** Read the SDK's object into a {@link DomainView}. */
export function domainViewOf(d: Stripe.PaymentMethodDomain): DomainView {
	return {
		id: d.id,
		domain: d.domain_name,
		enabled: d.enabled,
		livemode: d.livemode,
		wallets: {
			apple_pay: walletOf(d.apple_pay),
			google_pay: walletOf(d.google_pay),
			link: walletOf(d.link),
			paypal: walletOf(d.paypal),
		},
	};
}

/**
 * Bind the port to a Stripe client on the platform account (no `Stripe-Account` header). A
 * restricted key needs Write on Payment Method Domains and nothing else.
 */
export function paymentMethodDomainsPort(stripe: Stripe): PaymentMethodDomainsPort {
	return {
		async find(domain) {
			const page = await stripe.paymentMethodDomains.list({ domain_name: domain, limit: 1 });
			return page.data[0] ? domainViewOf(page.data[0]) : null;
		},
		async create(domain) {
			return domainViewOf(
				await stripe.paymentMethodDomains.create(
					{ domain_name: domain },
					{ idempotencyKey: `projective-pmd-register-${domain}` },
				),
			);
		},
		async validate(id) {
			return domainViewOf(await stripe.paymentMethodDomains.validate(id));
		},
	};
}
// #endregion

// #region Plan
/** What a run does about one host. */
export type DomainAction =
	| { kind: "skip"; reason: string }
	| { kind: "register" }
	| { kind: "validate"; inactive: ExpressWallet[] }
	| { kind: "disabled" }
	| { kind: "ok" };

/** The wallets inactive on a registered domain. */
export function inactiveWallets(view: DomainView): ExpressWallet[] {
	return EXPRESS_WALLETS.filter((wallet) => view.wallets[wallet].status === "inactive");
}

/**
 * What to do about one host given its registration: skip one Stripe cannot verify; register one it
 * does not hold; leave a disabled one to the human who disabled it; re-validate one with an inactive
 * wallet; else nothing.
 */
export function planDomain(host: DomainHost, existing: DomainView | null): DomainAction {
	if (host.skip) return { kind: "skip", reason: host.skip };
	if (!existing) return { kind: "register" };
	if (!existing.enabled) return { kind: "disabled" };
	const inactive = inactiveWallets(existing);
	return inactive.length ? { kind: "validate", inactive } : { kind: "ok" };
}
// #endregion

// #region Run
/** One host's line of the report. */
export interface DomainRow {
	host: DomainHost;
	/** What the plan said before anything was sent. */
	action: DomainAction;
	/** What Stripe holds after the run (before it, on a dry run); `null` when it holds nothing. */
	view: DomainView | null;
	/** What the run did: `listed` on a dry run; `registered` / `validated` on apply; else `unchanged`. */
	done: "listed" | "registered" | "validated" | "unchanged" | "skipped" | "failed";
	/** A redacted Stripe error, when a call failed. */
	error: string | null;
}

/** The whole run. */
export interface DomainsReport {
	apply: boolean;
	rows: DomainRow[];
	/**
	 * Every host that can be registered is registered and enabled, and there is at least one. An
	 * inactive wallet is a warning, not a failure: PayPal, for one, is offered only to some accounts.
	 */
	ok: boolean;
}

function describe(error: unknown): string {
	const e = error as { type?: unknown; code?: unknown; message?: unknown };
	const head = [e?.type, e?.code].filter((x) => typeof x === "string").join(" ");
	const message = typeof e?.message === "string" ? e.message : String(error);
	return redactSecrets(head ? `${head}: ${message}` : message);
}

/**
 * Plan every host and, with `apply`, carry the plan out. A dry run makes one read per registrable
 * host and nothing else.
 */
export async function runPaymentMethodDomains(
	port: PaymentMethodDomainsPort,
	hosts: readonly DomainHost[],
	opts: { apply: boolean },
): Promise<DomainsReport> {
	const rows: DomainRow[] = [];
	for (const host of hosts) {
		if (host.skip) {
			rows.push({ host, action: planDomain(host, null), view: null, done: "skipped", error: null });
			continue;
		}
		let existing: DomainView | null;
		try {
			existing = await port.find(host.host);
		} catch (error) {
			rows.push({
				host,
				action: { kind: "register" },
				view: null,
				done: "failed",
				error: describe(error),
			});
			continue;
		}
		const action = planDomain(host, existing);
		if (!opts.apply || action.kind === "ok" || action.kind === "disabled") {
			rows.push({
				host,
				action,
				view: existing,
				done: opts.apply ? "unchanged" : "listed",
				error: null,
			});
			continue;
		}
		try {
			const view = action.kind === "register"
				? await port.create(host.host)
				: await port.validate(existing!.id);
			rows.push({
				host,
				action,
				view,
				done: action.kind === "register" ? "registered" : "validated",
				error: null,
			});
		} catch (error) {
			rows.push({ host, action, view: existing, done: "failed", error: describe(error) });
		}
	}
	const registrable = rows.filter((row) => !row.host.skip);
	const ok = registrable.length > 0 &&
		registrable.every((row) => row.done !== "failed" && row.view !== null && row.view.enabled);
	return { apply: opts.apply, rows, ok };
}
// #endregion

// #region Keys
/**
 * Why the task must not run with these settings, or `null` when it may: it needs a well-formed key,
 * and it refuses a LIVE one everywhere — production included. A live domain is registered by a human
 * in the Dashboard (Settings → Payment method domains), which also registers it in test mode.
 */
export function domainsKeyRefusal(settings: StripeSettings | null): string | null {
	if (!settings) return "STRIPE_SECRET_KEY is absent or not shaped like a Stripe secret key.";
	if (settings.mode === "live") {
		return "STRIPE_SECRET_KEY is a LIVE key. This task runs in test mode only; register live domains in the Dashboard.";
	}
	return null;
}
// #endregion

// #region Apple Pay's association file
/** The path Apple fetches a merchant's domain association file from. */
export const APPLE_PAY_ASSOCIATION_PATH =
	"/.well-known/apple-developer-merchantid-domain-association";

/** Apple's file is short printable text; anything larger or binary is a mistake, not a file. */
const ASSOCIATION_MAX = 64 * 1024;
const PRINTABLE = /^[\x20-\x7E\t\r\n]+$/;

/**
 * The association file's body from `STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION`, or `null` when none is
 * configured: blank, the `XXXX-XXXX` placeholder, over 64 KiB or not printable text all count as none.
 * The value is served verbatim (trimmed), since Apple compares it byte for byte.
 */
export function appleDomainAssociation(raw: string | undefined): string | null {
	const body = raw?.trim() ?? "";
	if (!body || body.includes("XXXX-XXXX")) return null;
	if (body.length > ASSOCIATION_MAX || !PRINTABLE.test(body)) return null;
	return body;
}
// #endregion
