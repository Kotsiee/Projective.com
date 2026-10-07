import { apiFetch } from "@web/utils/api-client.ts";
import type {
	CardSetupConfig,
	CardSetupHandoff,
	ConfirmCardSetup,
	ConnectOnboardingInput,
	CreateCardSetup,
	ConnectOnboardingLink,
	IdentitySessionHandoff,
	InboundPayment,
	KybOnboardingInput,
	SavedCardResult,
	VerificationStatus,
} from "@projective/types/finance";
import type { PaymentsResponse } from "./respond.ts";

/**
 * PaymentsService — the THIN client controller for `/api/finance/*` (the Stripe fiat rails). Islands
 * call this, never Stripe's server API and never the database: it only moves JSON to and from the thin
 * routes, folding any network failure into a soft `{ ok: false, message }`.
 */

async function send<T>(path: string, init?: RequestInit): Promise<PaymentsResponse<T>> {
	try {
		const res = await apiFetch(path, {
			...init,
			headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as PaymentsResponse<T>;
		return { ok: false, message: "Unexpected response from the payments service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

const post = <T>(path: string, body: unknown) => send<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const PaymentsService = {
	/** Where one card payment stands — `succeeded` only once the webhook has credited the wallet. */
	payment(id: string): Promise<PaymentsResponse<{ payment: InboundPayment }>> {
		return send(`/api/finance/payments/${encodeURIComponent(id)}`);
	},

	/**
	 * Poll a payment until the webhook settles (or fails) it, or the wait runs out. `succeeded` means the
	 * wallet has been credited; `timeout` means Stripe accepted it but the ledger has not heard yet —
	 * the surface says so rather than claiming the money arrived.
	 */
	async waitForSettlement(
		id: string,
		opts: { timeoutMs?: number; intervalMs?: number } = {},
	): Promise<"succeeded" | "failed" | "timeout"> {
		const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
		const interval = opts.intervalMs ?? 1_500;
		while (Date.now() < deadline) {
			const res = await PaymentsService.payment(id);
			const status = res.ok ? res.data?.payment.status : undefined;
			if (status === "succeeded") return "succeeded";
			if (status === "failed" || status === "canceled") return "failed";
			await new Promise((resolve) => setTimeout(resolve, interval));
		}
		return "timeout";
	},

	/**
	 * What the card form needs to mount before any SetupIntent exists (the publishable key and the
	 * mode). Read when an Add card surface opens; the intent itself waits for Save.
	 */
	cardSetupConfig(): Promise<PaymentsResponse<CardSetupConfig>> {
		return send("/api/finance/cards/setup");
	},

	/**
	 * Open a SetupIntent to save a card for an owner — at Save, after the deferred card form has
	 * collected the card; `stripe.confirmSetup` confirms it with this answer's client secret.
	 */
	createCardSetup(input: CreateCardSetup): Promise<PaymentsResponse<CardSetupHandoff>> {
		return post("/api/finance/cards/setup", input);
	},

	/** Record the card a confirmed SetupIntent saved. */
	confirmCard(input: ConfirmCardSetup): Promise<PaymentsResponse<SavedCardResult>> {
		return post("/api/finance/cards/confirm", input);
	},

	/** The caller's verification picture. */
	verificationStatus(): Promise<PaymentsResponse<VerificationStatus>> {
		return send("/api/finance/verify/status");
	},

	/** Start the Level-2 identity check; the answer carries Stripe's hosted URL. */
	startKyc(): Promise<PaymentsResponse<IdentitySessionHandoff>> {
		return post("/api/finance/verify/kyc", {});
	},

	/** Start (or resume) a client business's Level-3 KYB check. */
	startKyb(input: KybOnboardingInput): Promise<PaymentsResponse<ConnectOnboardingLink>> {
		return post("/api/finance/verify/kyb", input);
	},

	/** Start (or resume) payout onboarding (the Connect account a withdrawal goes to). */
	startPayoutOnboarding(input: ConnectOnboardingInput): Promise<PaymentsResponse<ConnectOnboardingLink>> {
		return post("/api/finance/connect/onboarding", input);
	},
};
