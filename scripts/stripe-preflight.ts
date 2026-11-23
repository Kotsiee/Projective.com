/**
 * `deno task stripe:preflight` proves a Stripe account is configured the way the code expects
 * (PRD-F17, FINANCE_BUILD_PROMPTS MR6): the three event destinations (URL on APP_URL's host, enabled,
 * pinned API version, exactly the handled events), the platform account (country, default currency,
 * activation, manual payouts of its own balance), the settlement currencies in its balance, and the
 * payout schedule of its connected accounts. The checks are
 * `packages/backend/services/finance/stripe-preflight.ts`; the go-live runbook a human follows around
 * this run is SYSTEM_ARCHITECTURE.md §Stripe 1.4.
 *
 * READ-ONLY. It makes `GET` requests to api.stripe.com and nothing else: it never creates, edits or
 * deletes anything at Stripe, and never writes a file. It prints the mode and masked ids, never a key
 * or a signing secret (only whether each one is set).
 *
 * Keys. The account is read with `STRIPE_PREFLIGHT_KEY` when that is set (a restricted key with Read
 * on Webhook Endpoints, Event Destinations, Account, Balance and Connect accounts, and nothing else),
 * else with `STRIPE_SECRET_KEY`. Both pass the same live-key guard the server boots with
 * (`assertStripeKeyAllowed`, PRD-H3): a LIVE key runs only under `DENO_ENV=production`, so a live
 * account is checked from the production host's environment and nowhere else. There is no flag that
 * relaxes this. `STRIPE_API_BASE` (stripe-mock) is ignored: the point is the real account.
 *
 * Inputs come from the shell first, then `.env.local`, then `.env` (§Environment Variable Contract).
 *
 * Exit codes: 0 every check passes (warnings allowed) · 1 one or more checks fail · 2 cannot run (no
 * usable key, a live key outside production, or the two keys in different modes).
 */
import { load } from "@std/dotenv";
import { serverEnv } from "@projective/backend/core/env.ts";
import { isFinanceBackendLive } from "@projective/backend/core/supabase.ts";
import {
	assertStripeKeyAllowed,
	createStripeClient,
	parseStripeSettings,
	STRIPE_API_VERSION,
	stripeSettings,
} from "@projective/backend/core/stripe.ts";
import {
	PREFLIGHT_GROUPS,
	type PreflightContext,
	type PreflightReport,
	runStripePreflight,
	stripePreflightPort,
} from "@server/services/finance/stripe-preflight.ts";

// #region Output
const MARK = { pass: "pass", fail: "FAIL", warn: "warn" } as const;

/** The report as the lines the script prints. Pure, so its shape can be read without a run. */
export function formatReport(
	report: PreflightReport,
	ctx: PreflightContext,
	keySource: string,
): string[] {
	const lines = [
		`Stripe preflight · mode ${report.mode} · key ${keySource} · account ${
			report.account ?? "unreadable"
		} · API ${STRIPE_API_VERSION}`,
		`APP_URL ${ctx.appUrl} · DENO_ENV ${ctx.appEnv}`,
	];
	for (const group of PREFLIGHT_GROUPS) {
		const checks = report.checks.filter((c) => c.group === group);
		if (!checks.length) continue;
		lines.push("", group.toUpperCase());
		for (const c of checks) {
			lines.push(`  ${MARK[c.status]}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
			if (c.status !== "pass" && c.fix) lines.push(`        fix: ${c.fix}`);
		}
	}
	if (report.checks.some((c) => c.group === "destinations" && c.status === "fail")) {
		lines.push("", "WHAT THE CODE EXPECTS (one destination per block; Workbench → Webhooks)");
		for (const r of report.requirements) {
			const from = r.scope === "@self" ? "your account" : "connected accounts";
			const version = r.payload === "snapshot" ? ` · API ${STRIPE_API_VERSION}` : "";
			lines.push(
				`  ${r.label}: ${r.payload} · events from ${from} · ${
					ctx.appUrl.replace(/\/+$/, "")
				}${r.path}${version} · secret → ${r.secretEnv}`,
				`    ${r.events.join(", ")}`,
			);
		}
		lines.push(
			"  The account and Connect blocks may be ONE destination with events from both (its secret is STRIPE_WEBHOOK_SECRET).",
		);
	}
	const passed = report.checks.filter((c) => c.status === "pass").length;
	lines.push(
		"",
		`${passed} passed · ${report.failed} failed · ${report.warned} warnings — ${
			report.ok ? "configured" : "NOT configured"
		}`,
	);
	return lines;
}
// #endregion

// #region Run
function refuse(message: string): never {
	console.error(`stripe:preflight cannot run: ${message}`);
	Deno.exit(2);
}

async function main(): Promise<void> {
	await load({ envPath: ".env.local", export: true });
	await load({ export: true });

	const env = serverEnv();
	const settings = stripeSettings();
	if (!settings) refuse("STRIPE_SECRET_KEY is absent or not shaped like a Stripe secret key.");

	const raw = Deno.env.get("STRIPE_PREFLIGHT_KEY")?.trim() ?? "";
	const preflight = raw ? parseStripeSettings({ secretKey: raw, appEnv: env.appEnv }) : null;
	const guard = (name: string, secretKey: string) => {
		try {
			assertStripeKeyAllowed({ stripeSecretKey: secretKey, appEnv: env.appEnv });
		} catch (error) {
			refuse((error as Error).message.replace("STRIPE_SECRET_KEY", name));
		}
	};
	guard("STRIPE_SECRET_KEY", settings.secretKey);
	if (preflight) guard("STRIPE_PREFLIGHT_KEY", preflight.secretKey);
	if (preflight && preflight.mode !== settings.mode) {
		refuse(
			`STRIPE_PREFLIGHT_KEY is a ${preflight.mode} key but STRIPE_SECRET_KEY is ${settings.mode}: it would check another account.`,
		);
	}
	const key = preflight ?? settings;
	const keySource = `${key.restricted ? "restricted (rk_)" : "secret (sk_)"} via ${
		preflight ? "STRIPE_PREFLIGHT_KEY" : "STRIPE_SECRET_KEY"
	}`;

	const ctx: PreflightContext = {
		mode: settings.mode,
		appEnv: env.appEnv,
		appUrl: env.appUrl,
		financeLive: isFinanceBackendLive(),
		secrets: {
			webhook: settings.webhookSecret !== null,
			thin: settings.thinWebhookSecret !== null,
			connect: settings.connectWebhookSecret !== null,
			publishable: settings.publishableKey !== null,
		},
	};
	const report = await runStripePreflight(
		stripePreflightPort(createStripeClient(key.secretKey)),
		ctx,
	);
	for (const line of formatReport(report, ctx, keySource)) console.log(line);
	Deno.exit(report.ok ? 0 : 1);
}

if (import.meta.main) await main();
// #endregion
