import { assert, assertEquals } from "@std/assert";
import { parseStripeSettings } from "../../core/stripe.ts";
import {
	appleDomainAssociation,
	domainsKeyRefusal,
	type DomainView,
	type ExpressWallet,
	paymentMethodDomainHosts,
	type PaymentMethodDomainsPort,
	planDomain,
	runPaymentMethodDomains,
} from "./payment-method-domains.ts";

// #region Fixtures
const ACTIVE = { status: "active", error: null } as const;

function view(
	domain: string,
	opts: { enabled?: boolean; inactive?: Partial<Record<ExpressWallet, string>> } = {},
): DomainView {
	const wallet = (name: ExpressWallet) =>
		opts.inactive?.[name] !== undefined
			? { status: "inactive" as const, error: opts.inactive[name]! }
			: ACTIVE;
	return {
		id: `pmd_${domain.replace(/\W/g, "")}0000`,
		domain,
		enabled: opts.enabled ?? true,
		livemode: false,
		wallets: {
			apple_pay: wallet("apple_pay"),
			google_pay: wallet("google_pay"),
			link: wallet("link"),
			paypal: wallet("paypal"),
		},
	};
}

/** A Stripe account in memory: what it holds, and every write the run sent it. */
function account(held: DomainView[] = []) {
	const domains = new Map(held.map((d) => [d.domain, d]));
	const writes: string[] = [];
	const port: PaymentMethodDomainsPort = {
		find: (domain) => Promise.resolve(domains.get(domain) ?? null),
		create: (domain) => {
			writes.push(`create ${domain}`);
			if (domains.has(domain)) throw new Error("a domain is registered once per account");
			const created = view(domain);
			domains.set(domain, created);
			return Promise.resolve(created);
		},
		validate: (id) => {
			writes.push(`validate ${id}`);
			const found = [...domains.values()].find((d) => d.id === id)!;
			const validated = { ...found, wallets: { ...found.wallets, apple_pay: ACTIVE } };
			domains.set(found.domain, validated);
			return Promise.resolve(validated);
		},
	};
	return { port, writes };
}
// #endregion

// #region Hosts
Deno.test("hosts: the listed domains, normalised and de-duplicated, else APP_URL's host", () => {
	assertEquals(
		paymentMethodDomainHosts({
			domains:
				"https://Projective.app:443/x, www.projective.app staging.projective.app,projective.app",
			appUrl: "https://ignored.example.com",
		}).map((h) => [h.host, h.source, h.skip]),
		[
			["projective.app", "STRIPE_PAYMENT_METHOD_DOMAINS", null],
			["www.projective.app", "STRIPE_PAYMENT_METHOD_DOMAINS", null],
			["staging.projective.app", "STRIPE_PAYMENT_METHOD_DOMAINS", null],
		],
	);
	assertEquals(paymentMethodDomainHosts({ appUrl: "https://app.projective.app/" }), [
		{ host: "app.projective.app", source: "APP_URL", skip: null },
	]);
	assertEquals(
		paymentMethodDomainHosts({ domains: "XXXX-XXXX", appUrl: "https://app.projective.app" }),
		[
			{ host: "app.projective.app", source: "APP_URL", skip: null },
		],
	);
});

Deno.test("hosts: a local, reserved, IP or malformed host is listed with its reason and never sent", () => {
	const hosts = paymentMethodDomainHosts({
		domains: "localhost:13041 noor.localhost shop.test 127.0.0.1 http://[::1]:3000 intranet",
		appUrl: "",
	});
	assertEquals(hosts.length, 6);
	assert(hosts.every((h) => h.skip !== null), JSON.stringify(hosts));
	assertEquals(paymentMethodDomainHosts({ appUrl: "http://localhost:3000" })[0].host, "localhost");
});
// #endregion

// #region Plan
Deno.test("plan: register a missing domain, leave a disabled one, re-validate an inactive wallet", () => {
	const host = { host: "projective.app", source: "APP_URL" as const, skip: null };
	assertEquals(planDomain(host, null), { kind: "register" });
	assertEquals(planDomain(host, view("projective.app")), { kind: "ok" });
	assertEquals(planDomain(host, view("projective.app", { enabled: false })), { kind: "disabled" });
	assertEquals(
		planDomain(host, view("projective.app", { inactive: { apple_pay: "Host the file." } })),
		{
			kind: "validate",
			inactive: ["apple_pay"],
		},
	);
	assertEquals(planDomain({ ...host, skip: "local" }, null), { kind: "skip", reason: "local" });
});
// #endregion

// #region Run
const HOSTS = paymentMethodDomainHosts({
	domains: "projective.app,www.projective.app,staging.projective.app,localhost",
	appUrl: "",
});

Deno.test("a dry run reads each registrable host and writes nothing", async () => {
	const stripe = account([
		view("projective.app"),
		view("www.projective.app", { inactive: { paypal: "Not enabled." } }),
	]);
	const report = await runPaymentMethodDomains(stripe.port, HOSTS, { apply: false });
	assertEquals(stripe.writes, []);
	assertEquals(report.rows.map((r) => [r.host.host, r.action.kind, r.done]), [
		["projective.app", "ok", "listed"],
		["www.projective.app", "validate", "listed"],
		["staging.projective.app", "register", "listed"],
		["localhost", "skip", "skipped"],
	]);
	assertEquals(report.ok, false, "staging is not registered yet");
});

Deno.test("apply registers what is missing, re-validates what is inactive, and a second apply changes nothing", async () => {
	const stripe = account([
		view("projective.app"),
		view("www.projective.app", { inactive: { apple_pay: "Host the domain association file." } }),
	]);
	const first = await runPaymentMethodDomains(stripe.port, HOSTS, { apply: true });
	assertEquals(stripe.writes, [
		"validate pmd_wwwprojectiveapp0000",
		"create staging.projective.app",
	]);
	assertEquals(first.rows.map((r) => r.done), ["unchanged", "validated", "registered", "skipped"]);
	assertEquals(first.ok, true);

	stripe.writes.length = 0;
	const second = await runPaymentMethodDomains(stripe.port, HOSTS, { apply: true });
	assertEquals(stripe.writes, [], "a second apply wrote again");
	assertEquals(second.rows.map((r) => r.done), ["unchanged", "unchanged", "unchanged", "skipped"]);
});

Deno.test("apply never re-enables a domain somebody disabled, and the run says it is not configured", async () => {
	const stripe = account([view("projective.app", { enabled: false })]);
	const hosts = paymentMethodDomainHosts({ domains: "projective.app", appUrl: "" });
	const report = await runPaymentMethodDomains(stripe.port, hosts, { apply: true });
	assertEquals(stripe.writes, []);
	assertEquals(report.rows[0].action, { kind: "disabled" });
	assertEquals(report.ok, false);
});

Deno.test("a failed Stripe call is reported redacted, and nothing but local hosts is not ok", async () => {
	const port: PaymentMethodDomainsPort = {
		find: () =>
			Promise.reject({
				type: "StripeAuthenticationError",
				message: "Invalid API Key provided: sk_test_51AbCdEfGhIjKlMn",
			}),
		create: () => Promise.reject(new Error("unreachable")),
		validate: () => Promise.reject(new Error("unreachable")),
	};
	const report = await runPaymentMethodDomains(
		port,
		paymentMethodDomainHosts({ domains: "projective.app", appUrl: "" }),
		{
			apply: true,
		},
	);
	assertEquals(report.rows[0].done, "failed");
	assert(!report.rows[0].error!.includes("sk_test_51"), report.rows[0].error!);
	const local = await runPaymentMethodDomains(
		account().port,
		paymentMethodDomainHosts({ appUrl: "http://localhost:13041" }),
		{
			apply: false,
		},
	);
	assertEquals(local.ok, false, "a run that can register nothing is not configured");
});
// #endregion

// #region Keys
Deno.test("the task refuses a missing or LIVE key, in every environment", () => {
	assert(domainsKeyRefusal(null));
	const live = parseStripeSettings({
		secretKey: "sk_live_51AbCdEfGhIjKlMnOp",
		appEnv: "production",
	});
	assert(domainsKeyRefusal(live)?.includes("LIVE"));
	const test = parseStripeSettings({
		secretKey: "rk_test_51AbCdEfGhIjKlMnOp",
		appEnv: "development",
	});
	assertEquals(domainsKeyRefusal(test), null);
});
// #endregion

// #region Apple Pay's association file
Deno.test("the association file is served verbatim only when one is configured", () => {
	assertEquals(appleDomainAssociation(undefined), null);
	assertEquals(appleDomainAssociation("  "), null);
	assertEquals(appleDomainAssociation("XXXX-XXXX"), null);
	assertEquals(appleDomainAssociation("7B22707370496422\n"), "7B22707370496422");
	assertEquals(appleDomainAssociation("\u0000binary"), null);
	assertEquals(appleDomainAssociation("A".repeat(64 * 1024 + 1)), null);
});
// #endregion
