import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";

// #region Stylesheet carrier
import "../styles/verification.css";
import "../styles/settings.css";
// #endregion

import { Alert } from "@projective/ui/feedback";
import { Button, FormControl, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { VerificationStatus } from "@projective/types/finance";
import type { EarnedVerificationStamp } from "@projective/types/org";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { StatusMark } from "../components/SettingsParts.tsx";
import {
	kybCopy,
	kycCopy,
	nextVerificationStep,
	PAYOUT_COUNTRIES,
	payoutCopy,
	type StatusCopy,
	verificationStamps,
} from "../core/verification-model.ts";

/** Props for {@link VerificationConsole}. */
export interface VerificationConsoleProps {
	/** The SSR read; `null` when it could not be made (with `error` saying why). */
	initial: VerificationStatus | null;
	error: string | null;
	/** A notice from a return out of a Stripe-hosted flow, resolved server-side. */
	notice: { tone: "info" | "success" | "warning"; text: string } | null;
}

/**
 * How a section's action is weighted (DESIGN_SYSTEM §B.8.1, Decision #157): `accent` is the tier-1
 * amber pill (the payout setup — it starts the account money lands in), `primary` the tier-3 teal
 * fill (the identity check), `utility` the tier-4 neutral outlined button every other action takes.
 */
type ActionWeight = "accent" | "primary" | "utility";

/**
 * VerificationConsole — Settings → Verification & payouts (root CLAUDE.md §8 Decision #126).
 *
 * Three checks, each a section with its status and at most one next step:
 *
 * 1. **Identity (Level 2 KYC)** — a freelancer's Stripe Identity check, the half of the earning gate
 *    `org.freelancer_profiles.kyc_status` records. A client never needs it. Started through
 *    `POST /api/finance/verify/kyc` — the settings-return twin of `POST /api/finance/identity/session`
 *    (the same fat `createIdentitySession`, returning here with `?identity=returned` instead of to
 *    the wallet).
 * 2. **Payouts** — the Stripe Connect account withdrawals are transferred to
 *    (`POST /api/finance/connect/onboarding`), the other half (`payout_ready`). Stripe's `return_url`
 *    and `refresh_url` are `/api/finance/connect/return|refresh`, which re-read the account from Stripe
 *    and land back here with `?payouts=<status>`.
 * 3. **Businesses (Level 3 KYB)** — each client business the person belongs to, verified through its own
 *    Connect onboarding (`POST /api/finance/verify/kyb`), recorded on `org.business_profiles.kyb_status`
 *    and landing back with `?kyb=<status>`.
 *
 * Every start NAVIGATES to Stripe's hosted flow — identity documents and bank details are entered with
 * Stripe, never on this page — and the statuses change only when Stripe reports back (the webhook, or
 * the re-read on return), never on this page's word. The first paint comes from the route's SSR read,
 * so there is no client fetch on load. One action is filled — the next step
 * ({@link nextVerificationStep}) — and every earned check shows its crest (`VerificationStampBadge`).
 * The island never touches Supabase or Stripe's server API: it calls the thin {@link PaymentsService}.
 */
export default function VerificationConsole(props: VerificationConsoleProps): JSX.Element {
	const status = useSignal(props.initial);
	const failure = useSignal<string | null>(props.error);
	const busy = useSignal<string | null>(null);
	const payoutCountry = useSignal("GB");
	const businessCountry = useSignal<Record<string, string>>({});

	const go = async (
		key: string,
		start: () => Promise<
			{ ok: boolean; message?: string; data?: { url: string | null } | { url: string } }
		>,
	) => {
		busy.value = key;
		failure.value = null;
		const res = await start();
		const url = res.ok ? res.data?.url : null;
		if (url) {
			globalThis.location.assign(url);
			return;
		}
		busy.value = null;
		failure.value = res.message ?? "That couldn't be started just now.";
	};

	const refresh = async () => {
		busy.value = "refresh";
		failure.value = null;
		const res = await PaymentsService.verificationStatus();
		busy.value = null;
		if (res.ok && res.data) status.value = res.data;
		else failure.value = res.message ?? "Couldn't refresh your verification.";
	};

	const s = status.value;
	const locked = !s?.processorConnected;
	const kyc = kycCopy(s?.kycStatus ?? "unverified");
	const payout = payoutCopy(s?.payoutAccount ?? null);
	const step = s ? nextVerificationStep(s) : null;
	const stamps = s ? verificationStamps(s) : { identity: null, payouts: null };

	return (
		<section class="vrf" aria-labelledby="vrf-title">
			<header class="vrf__head">
				<h1 id="vrf-title" class="vrf__title">Verification &amp; payouts</h1>
				<p class="vrf__lede">
					Paying on Projective never needs an ID check. Earning does: freelancers verify their
					identity and add a payout account, and a business verifies its registration before its
					vault can operate.
				</p>
			</header>

			{props.notice && (
				<Alert severity={props.notice.tone} description={props.notice.text} class="vrf__banner" />
			)}
			{locked && s && (
				<Alert
					severity="info"
					description="Verification runs through our payment processor, which isn't connected in this environment."
					class="vrf__banner"
				/>
			)}
			{failure.value && <Alert severity="danger" description={failure.value} class="vrf__banner" />}

			{s && (
				<>
					<Section
						title="Identity"
						subtitle="Level 2 · for freelancers"
						copy={s.isFreelancer ? kyc : {
							label: "Not needed",
							tone: "neutral",
							detail:
								"You're paying, not earning — no identity check is needed. It becomes available if you start selling.",
							action: null,
						}}
						stamp={stamps.identity}
						weight={step === "kyc" ? "primary" : "utility"}
						onAction={s.isFreelancer && kyc.action && !locked
							? () => void go("kyc", () => PaymentsService.startKyc())
							: null}
						busy={busy.value === "kyc"}
					/>

					<Section
						title="Payouts"
						subtitle="Where your earnings are paid"
						copy={payout}
						stamp={stamps.payouts}
						weight={step === "payouts" ? "accent" : "utility"}
						onAction={payout.action && !locked
							? () =>
								void go("payouts", () =>
									PaymentsService.startPayoutOnboarding({
										scope: "personal",
										country: payoutCountry.value,
										returnTo: "settings",
									}))
							: null}
						busy={busy.value === "payouts"}
					>
						{!s.payoutAccount?.accountId && payout.action && !locked && (
							<CountryField
								id="vrf-payout-country"
								label="Country your bank is in"
								value={payoutCountry.value}
								onChange={(v) => (payoutCountry.value = v)}
							/>
						)}
					</Section>

					{s.businesses.length > 0 && (
						<section class="vrf__group" aria-labelledby="vrf-biz">
							<h2 id="vrf-biz" class="vrf__h">Businesses</h2>
							<p class="vrf__sub">Level 3 · business verification (KYB)</p>
							<ul class="vrf__list">
								{s.businesses.map((b) => {
									const copy = kybCopy(b.kybStatus, b.canManage);
									const country = businessCountry.value[b.id] ?? "GB";
									return (
										<li key={b.id} class="vrf__row">
											<Section
												title={b.name}
												copy={copy}
												level={3}
												stamp={b.kybStatus === "verified" ? "corporate_verified" : null}
												weight="utility"
												onAction={copy.action && !locked
													? () =>
														void go(
															`kyb:${b.id}`,
															() => PaymentsService.startKyb({ businessId: b.id, country }),
														)
													: null}
												busy={busy.value === `kyb:${b.id}`}
											>
												{copy.action && !locked && b.kybStatus === "unverified" && (
													<CountryField
														id={`vrf-kyb-${b.id}`}
														label="Country the business is registered in"
														value={country}
														onChange={(
															v,
														) => (businessCountry.value = { ...businessCountry.value, [b.id]: v })}
													/>
												)}
											</Section>
										</li>
									);
								})}
							</ul>
						</section>
					)}

					<p class="vrf__foot">
						<Button
							severity="neutral"
							variant="outlined"
							size="sm"
							label="Refresh status"
							icon={<Icon name="refresh" size="sm" />}
							loading={busy.value === "refresh"}
							disabled={busy.value !== null}
							onClick={() => void refresh()}
						/>
					</p>
				</>
			)}
		</section>
	);
}

/**
 * One check: its name, its status as inline Meta text (the crest once it is earned), the
 * explanation, and at most one step, weighted by the matrix tier the page assigned it.
 */
function Section(
	props: {
		title: string;
		subtitle?: string;
		copy: StatusCopy;
		stamp: EarnedVerificationStamp | null;
		weight: ActionWeight;
		level?: 2 | 3;
		onAction: (() => void) | null;
		busy: boolean;
		children?: ComponentChildren;
	},
): JSX.Element {
	const Heading = props.level === 3 ? "h3" : "h2";
	const label = props.copy.action;
	return (
		<div class="vrf__group">
			<div class="vrf__line">
				<Heading class="vrf__h">{props.title}</Heading>
				<StatusMark
					tone={props.copy.tone}
					label={props.copy.label}
					stamp={props.stamp ?? undefined}
				/>
			</div>
			{props.subtitle && <p class="vrf__sub">{props.subtitle}</p>}
			<p class="vrf__detail">{props.copy.detail}</p>
			{props.children}
			{props.onAction && label && (
				<div class="vrf__actions">
					{props.weight === "accent"
						? (
							<Button
								severity="accent"
								rounded
								label={label}
								loading={props.busy}
								disabled={props.busy}
								onClick={props.onAction}
							/>
						)
						: props.weight === "primary"
						? (
							<Button
								severity="primary"
								label={label}
								loading={props.busy}
								disabled={props.busy}
								onClick={props.onAction}
							/>
						)
						: (
							<Button
								severity="neutral"
								variant="outlined"
								label={label}
								loading={props.busy}
								disabled={props.busy}
								onClick={props.onAction}
							/>
						)}
				</div>
			)}
		</div>
	);
}

/** The ISO country a Stripe account is created for (fixed at creation, so asked explicitly). */
function CountryField(
	props: { id: string; label: string; value: string; onChange: (value: string) => void },
): JSX.Element {
	return (
		<FormControl label={props.label}>
			{({ id }) => (
				<Select
					id={id ?? props.id}
					options={PAYOUT_COUNTRIES.map((c) => ({ label: c.label, value: c.value }))}
					value={props.value}
					onValueChange={(v) => props.onChange(v)}
				/>
			)}
		</FormControl>
	);
}
