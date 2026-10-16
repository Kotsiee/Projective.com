import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { VerificationStatus } from "@projective/types/finance";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { logger } from "@web/utils/logger.ts";

/** Props for {@link DevPayoutReadyAction}. */
export interface DevPayoutReadyActionProps {
	/** True while the Payout-ready simulation forces `not_ready`, which still answers the 403. */
	simulatedNotReady: boolean;
}

function isReady(status: VerificationStatus): boolean {
	return status.kycStatus === "verified" && status.payoutReady;
}

function describe(status: VerificationStatus): string {
	if (!status.isFreelancer) return "No freelancer profile";
	if (isReady(status)) return "Identity verified · payout ready";
	return `Identity ${status.kycStatus} · payout ${status.payoutReady ? "ready" : "not ready"}`;
}

function reloadVerificationPage(): void {
	if (globalThis.location?.pathname.startsWith("/settings")) globalThis.location.reload();
}

/**
 * DevPayoutReadyAction — the Context Switcher's **Earning gate** control: the signed-in freelancer's
 * live KYC + payout state, and a button that makes them Stripe identity-verified with a verified payout
 * account through the development-only `POST /api/finance/verify/force`. A real database write, not a
 * simulation, so it is not gated by the master switch.
 */
export function DevPayoutReadyAction(props: DevPayoutReadyActionProps): JSX.Element {
	const status = useSignal<VerificationStatus | null>(null);
	const line = useSignal("Checking…");
	const busy = useSignal(false);

	useEffect(() => {
		let current = true;
		PaymentsService.verificationStatus().then((res) => {
			if (!current) return;
			status.value = res.ok && res.data ? res.data : null;
			line.value = res.ok && res.data
				? describe(res.data)
				: res.message ?? "The verification status could not be read.";
		});
		return () => {
			current = false;
		};
	}, []);

	async function force(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		line.value = "Verifying…";
		const res = await PaymentsService.forcePayoutReady();
		busy.value = false;
		if (!res.ok || !res.data) {
			line.value = res.message ?? "The account could not be verified.";
			logger.warn("Dev: forced payout-ready refused", { message: res.message });
			return;
		}
		status.value = res.data;
		line.value = describe(res.data);
		logger.info("Dev: forced identity verified + payout ready");
		reloadVerificationPage();
	}

	const ready = status.value !== null && isReady(status.value);

	return (
		<>
			<button
				type="button"
				class="dev-ctx__reset"
				disabled={busy.value || ready || status.value?.isFreelancer === false}
				onClick={() => void force()}
			>
				{busy.value ? "Verifying…" : "Verify identity + payout"}
			</button>
			<span class="dev-ctx__hint" role="status">{line.value}</span>
			{props.simulatedNotReady && (
				<span class="dev-ctx__hint">
					Payout-ready is simulated as Not ready — the 403 still fires.
				</span>
			)}
		</>
	);
}
