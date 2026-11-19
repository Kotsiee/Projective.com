/**
 * `deno task stripe:domains` lists, and with `--apply` registers, the Stripe payment method domains
 * of the hosts that show the Express Checkout Element (work order CK6): every host in
 * `STRIPE_PAYMENT_METHOD_DOMAINS`, else the host of `APP_URL`. Apple Pay, Google Pay, Link and PayPal
 * appear in Elements only on a registered domain. The rules are
 * `packages/backend/services/finance/payment-method-domains.ts`; the runbook a human follows around
 * this run is EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md §4.3 F.
 *
 * DRY RUN by default: one `GET /v1/payment_method_domains?domain_name=` per host, and nothing else.
 * `--apply` (a human's act: it changes the Stripe account) registers a missing host and re-validates
 * one whose wallet is inactive; a second `--apply` changes nothing. It never re-enables a domain
 * somebody disabled and never deletes one. A host Stripe cannot verify (localhost, `*.localhost`,
 * `*.test`, an IP) is listed and skipped.
 *
 * TEST MODE ONLY. A live key is refused in every environment, production included: live domains are
 * registered in the Dashboard (Settings → Payment method domains), which registers them in test mode
 * too. The key is `STRIPE_SECRET_KEY` (a restricted key with Write on Payment Method Domains is
 * enough); `STRIPE_API_BASE` (stripe-mock) is ignored, because the point is the real account. It
 * prints the mode, the hosts, masked domain ids and each wallet's status; never a key.
 *
 * Inputs come from the shell first, then `.env.local`, then `.env` (§Environment Variable Contract).
 *
 * Exit codes: 0 every registrable host is registered and enabled · 1 a host is not (or a call failed,
 * or no host can be registered) · 2 cannot run (no usable key, or a live one).
 */
import { load } from "@std/dotenv";
import { serverEnv } from "@projective/backend/core/env.ts";
import {
	createStripeClient,
	STRIPE_API_VERSION,
	stripeSettings,
} from "@projective/backend/core/stripe.ts";
import { maskId } from "@server/services/finance/stripe-preflight.ts";
import {
	type DomainRow,
	domainsKeyRefusal,
	type DomainsReport,
	EXPRESS_WALLETS,
	paymentMethodDomainHosts,
	paymentMethodDomainsPort,
	runPaymentMethodDomains,
} from "@server/services/finance/payment-method-domains.ts";

// #region Output
const DONE: Record<DomainRow["done"], string> = {
	listed: "",
	registered: "registered now",
	validated: "re-validated now",
	unchanged: "unchanged",
	skipped: "skipped",
	failed: "FAILED",
};

/** What the plan would do, in words. */
function planWords(row: DomainRow): string {
	switch (row.action.kind) {
		case "skip":
			return `skip — ${row.action.reason}`;
		case "register":
			return "not registered → --apply registers it";
		case "validate":
			return `registered; ${row.action.inactive.join(", ")} inactive → --apply re-validates`;
		case "disabled":
			return "registered but DISABLED — re-enable it in the Dashboard if that was a mistake";
		case "ok":
			return "registered and enabled";
	}
}

/** The report as the lines the script prints. Pure, so its shape can be read without a run. */
export function formatDomainsReport(
	report: DomainsReport,
	mode: string,
	keyKind: string,
): string[] {
	const lines = [
		`Stripe payment method domains · mode ${mode} · key ${keyKind} · API ${STRIPE_API_VERSION} · ${
			report.apply ? "APPLY" : "dry run"
		}`,
	];
	for (const row of report.rows) {
		const done = DONE[row.done];
		lines.push(
			"",
			`${row.host.host}  (from ${row.host.source})`,
			`  ${planWords(row)}${done ? ` · ${done}` : ""}`,
		);
		if (row.error) lines.push(`  error: ${row.error}`);
		if (!row.view) continue;
		lines.push(`  ${maskId(row.view.id)} · ${row.view.enabled ? "enabled" : "disabled"}`);
		for (const wallet of EXPRESS_WALLETS) {
			const status = row.view.wallets[wallet];
			lines.push(
				`    ${wallet.padEnd(10)} ${status.status}${status.error ? ` — ${status.error}` : ""}`,
			);
		}
	}
	const registrable = report.rows.filter((row) => !row.host.skip).length;
	lines.push(
		"",
		registrable === 0
			? "No host here can be registered: set STRIPE_PAYMENT_METHOD_DOMAINS (or APP_URL) to a public HTTPS host."
			: report.ok
			? "Every registrable host is registered and enabled."
			: report.apply
			? "NOT every host is registered and enabled — see above."
			: "Run with --apply to register what is missing (a human's act: it changes the Stripe account).",
	);
	return lines;
}
// #endregion

// #region Run
function refuse(message: string): never {
	console.error(`stripe:domains cannot run: ${message}`);
	Deno.exit(2);
}

async function main(): Promise<void> {
	await load({ envPath: ".env.local", export: true });
	await load({ export: true });
	const apply = Deno.args.includes("--apply");
	const unknown = Deno.args.filter((arg) => arg !== "--apply");
	if (unknown.length) refuse(`unknown argument ${unknown.join(" ")} (the only flag is --apply).`);

	const env = serverEnv();
	const hosts = paymentMethodDomainHosts({
		domains: env.stripePaymentMethodDomains,
		appUrl: env.appUrl,
	});
	const settings = stripeSettings();
	const refusal = domainsKeyRefusal(settings);
	if (refusal || !settings) {
		console.error("Hosts it would read:");
		for (const host of hosts) {
			console.error(`  ${host.host}${host.skip ? ` (skip — ${host.skip})` : ""}`);
		}
		refuse(refusal ?? "no Stripe settings.");
	}

	const report = await runPaymentMethodDomains(
		paymentMethodDomainsPort(createStripeClient(settings.secretKey)),
		hosts,
		{ apply },
	);
	const keyKind = settings.restricted ? "restricted (rk_)" : "secret (sk_)";
	for (const line of formatDomainsReport(report, settings.mode, keyKind)) console.log(line);
	Deno.exit(report.ok ? 0 : 1);
}

if (import.meta.main) await main();
// #endregion
