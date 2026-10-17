import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import { Button, FormControl, Select } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { MetaLine, Tag, VerificationStampBadge } from "@projective/ui/display";
import type { BusinessKyb } from "@projective/types/workspace";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { PAYOUT_COUNTRIES } from "@features/settings/core/verification-model.ts";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import {
	KYB_REQUIREMENT_TEXT,
	KYB_UNLOCKS,
	kybAction,
	kybMeta,
	type KybSimulation,
	kybStamp,
	kybTag,
	runKybStart,
	simulateKyb,
} from "../core/kyb-model.ts";

/**
 * BusinessVerificationScreen — the business console's Verification module (BU4; PRODUCT_SPEC
 * §Identity Verification, Level 3 KYB; Decisions #126, #225, #230 (d), #238).
 *
 * In the order the questions arrive: where the check stands (the lifecycle Tag, the corporate crest
 * once earned, and when it cleared or how much is still due), what is still due, the one next step,
 * and what verification unlocks. Everything renders from BB9's server-decided read — `kyb` and
 * `viewerCan.startKyb` — so the screen never recomputes who may act.
 *
 * The next step is the page's ONE filled control, tier 3 (`severity="primary"`, Decision #225 (A):
 * a business's KYB gates its vault, it does not receive money). Starting creates the business's
 * Stripe Connect account through `POST /api/finance/verify/kyb` (the same door Settings uses), which
 * needs the registration country; resuming follows the refresh door BB9 sent, which mints a fresh
 * link for the existing account. Both NAVIGATE to Stripe, which collects the details and runs the
 * check, and Stripe returns to Settings → Verification & payouts (#225 (D)), which the page says up
 * front. Where the processor is not connected neither door can reach Stripe, so the step is the
 * sentence Settings shows instead of a control (#225 (B)). Coming Back from Stripe restores the page
 * from the back/forward cache, so `pageshow` clears the in-flight state the navigation left behind.
 *
 * The Dev Context Switcher's `businessKyb` axis substitutes the picture after mount (never during
 * hydration); the database and every door are unchanged.
 */

/** Props for {@link BusinessVerificationScreen} — slim and serialisable. */
export interface BusinessVerificationScreenProps {
	businessId: string;
	/** The business's display name, for the start label. */
	name: string;
	/** BB9's KYB read. */
	kyb: BusinessKyb;
	/** `viewerCan.startKyb` — the billing right, decided in SQL. */
	canStart: boolean;
}

const COUNTRY_OPTIONS = PAYOUT_COUNTRIES.map((c) => ({ label: c.label, value: c.value }));

/** The Verification module's body — see the module header. */
export default function BusinessVerificationScreen(
	props: BusinessVerificationScreenProps,
): JSX.Element {
	const busy = useSignal(false);
	const failure = useSignal<string | null>(null);
	const country = useSignal("GB");
	const forced = useSignal<KybSimulation | undefined>(undefined);

	useEffect(() => {
		forced.value = readDevSeam()?.businessKyb;
		const unsubscribe = subscribeDevSeam((s) => {
			forced.value = s?.businessKyb;
		});
		const onPageShow = (event: PageTransitionEvent) => {
			if (!event.persisted) return;
			busy.value = false;
			failure.value = null;
		};
		globalThis.addEventListener("pageshow", onPageShow);
		return () => {
			unsubscribe();
			globalThis.removeEventListener("pageshow", onPageShow);
		};
	}, []);

	const kyb = simulateKyb(props.kyb, forced.value);
	const verified = kyb.status === "verified";
	const tag = kybTag(kyb);
	const stamp = kybStamp(kyb);
	const action = kybAction(props.name, kyb, props.canStart);
	const due = kyb.requirementsDue;

	// #region Actions
	async function start(): Promise<void> {
		busy.value = true;
		failure.value = null;
		const refused = await runKybStart({
			start: () =>
				PaymentsService.startKyb({ businessId: props.businessId, country: country.value }),
			navigate: (url) => globalThis.location.assign(url),
		});
		if (refused === null) return;
		busy.value = false;
		failure.value = refused;
	}

	function resume(href: string): void {
		busy.value = true;
		failure.value = null;
		globalThis.location.assign(href);
	}
	// #endregion

	let band = 0;
	const next = () => band++;

	return (
		<div class="wsp" data-kind="business">
			<div class="wsp__stack">
				{/* #region Status */}
				<section class="wsp-band wsp-band--head" data-i={next()} aria-labelledby="wsp-kyb-title">
					<div class="wsp-band__inner wsp-kyb">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title" id="wsp-kyb-title">Verification</h1>
						</div>
						<div class="wsp-kyb__status">
							<span class="wsp-kyb__badges">
								<Tag value={tag.label} severity={tag.severity} variant="subtle" rounded />
								<VerificationStampBadge stamp={stamp} size="sm" />
							</span>
							<MetaLine as="span" items={kybMeta(kyb)} />
						</div>
						<p class="wsp-pagehead__note">
							Business verification (KYB) checks{" "}
							{props.name}'s registration details and the people who own it. Stripe collects the
							details and runs the check.
						</p>
					</div>
				</section>
				{/* #endregion */}

				{/* #region What is due, and the next step */}
				{(due.length > 0 || action) && (
					<section class="wsp-band wsp-band--plain" data-i={next()} aria-labelledby="wsp-kyb-due">
						<div class="wsp-band__inner wsp-kyb">
							<div class="wsp-band__head">
								<h2 class="wsp-band__title" id="wsp-kyb-due">
									{due.length > 0 ? "Still due" : "Next step"}
								</h2>
							</div>
							<div class="wsp-band__body">
								{due.length > 0 && (
									<ul class="wsp-kyb__list">
										{due.map((code) => (
											<li key={code} class="wsp-kyb__row">{KYB_REQUIREMENT_TEXT[code]}</li>
										))}
									</ul>
								)}

								{(action?.kind === "ask" || action?.kind === "unavailable") && (
									<MetaLine class="wsp-kyb__foot" items={[action.text]} />
								)}

								{(action?.kind === "start" || action?.kind === "resume") && (
									<>
										<div class="wsp-kyb__action">
											{action.kind === "start" && (
												<FormControl
													label="Country the business is registered in"
													collapseHint
													class="wsp-kyb__field"
												>
													{({ id, describedBy }) => (
														<Select
															id={id}
															aria-describedby={describedBy}
															options={COUNTRY_OPTIONS}
															value={country}
															disabled={busy.value}
															fluid
														/>
													)}
												</FormControl>
											)}
											<Button
												severity="primary"
												label={action.label}
												loading={busy.value}
												disabled={busy.value}
												onClick={() =>
													action.kind === "resume" ? resume(action.href) : void start()}
											/>
										</div>
										<MetaLine
											class="wsp-kyb__foot"
											items={[
												action.kind === "start" &&
												"Stripe fixes the country when it creates the account",
												"Stripe opens in this tab and brings you back to Settings → Verification & payouts",
											]}
										/>
										{failure.value && (
											<InlineNotice
												class="wsp-kyb__failure"
												assertive
												align="start"
												text={failure.value}
											/>
										)}
									</>
								)}
							</div>
						</div>
					</section>
				)}
				{/* #endregion */}

				{/* #region What verification unlocks */}
				<section
					class="wsp-band wsp-band--plain wsp-band--tail"
					data-i={next()}
					aria-labelledby="wsp-kyb-unlocks"
				>
					<div class="wsp-band__inner wsp-kyb">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title" id="wsp-kyb-unlocks">
								{verified ? "What verification unlocked" : "What verification unlocks"}
							</h2>
						</div>
						<div class="wsp-band__body">
							<ul class="wsp-kyb__list">
								{KYB_UNLOCKS.map((line) => <li key={line} class="wsp-kyb__row">{line}</li>)}
							</ul>
						</div>
					</div>
				</section>
				{/* #endregion */}
			</div>
		</div>
	);
}
