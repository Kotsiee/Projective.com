import type {
	ConnectAccountStatus,
	KycStatus,
	VerificationStatus,
} from "@projective/types/finance";
import type { EarnedVerificationStamp } from "@projective/types/org";

/**
 * verification-model — the pure wording of Settings → Verification & payouts: what each status means to
 * the person reading it, and what (if anything) they can do next. Kept apart from the island so every
 * state is testable and the island only renders.
 */

/** A status as a reader sees it: a word, a tone (never the only channel), and the one next step. */
export interface StatusCopy {
	label: string;
	tone: "success" | "warning" | "info" | "neutral" | "danger";
	detail: string;
	/** The action the section offers, or `null` when there is nothing the person can do right now. */
	action: string | null;
}

/** The Level-2 identity check, for a freelancer. */
export function kycCopy(status: KycStatus): StatusCopy {
	switch (status) {
		case "verified":
			return {
				label: "Verified",
				tone: "success",
				detail: "Your identity is confirmed. You can earn on Projective.",
				action: null,
			};
		case "pending":
			return {
				label: "In review",
				tone: "info",
				detail:
					"Stripe is checking your document. This usually takes a few minutes; we'll update this page when it's done.",
				action: null,
			};
		case "rejected":
			return {
				label: "Needs another try",
				tone: "danger",
				detail:
					"The last check couldn't confirm your identity — often a blurry photo or an expired document.",
				action: "Try again",
			};
		case "expired":
			return {
				label: "Expired",
				tone: "warning",
				detail: "Your verification has lapsed. Verify again to keep earning.",
				action: "Verify again",
			};
		default:
			return {
				label: "Not verified",
				tone: "warning",
				detail:
					"Verify your identity with a photo ID and a quick selfie to start earning. It takes about two minutes.",
				action: "Verify your identity",
			};
	}
}

/** The personal payout account (the Stripe Connect account a withdrawal goes to). */
export function payoutCopy(account: ConnectAccountStatus | null): StatusCopy {
	switch (account?.status ?? "not_started") {
		case "verified":
			return {
				label: "Ready",
				tone: "success",
				detail: "Withdrawals go to your payout account, which pays your bank.",
				action: "Update payout details",
			};
		case "pending_verification":
			return {
				label: "Pending",
				tone: "info",
				detail: "Stripe is confirming your details.",
				action: "Continue setup",
			};
		case "restricted":
			return {
				label: "Needs attention",
				tone: "warning",
				detail: "Stripe needs a little more information before you can be paid.",
				action: "Continue setup",
			};
		case "disabled":
			return {
				label: "Unavailable",
				tone: "danger",
				detail: "Payouts can't be sent to this account. Contact support.",
				action: null,
			};
		default:
			return {
				label: "Not set up",
				tone: "neutral",
				detail:
					"Add the bank account your earnings are paid into. Stripe collects the details securely.",
				action: "Set up payouts",
			};
	}
}

/** A client business's Level-3 KYB check. */
export function kybCopy(status: KycStatus, canManage: boolean): StatusCopy {
	const base = kycCopy(status);
	if (status === "verified") {
		return { ...base, detail: "This business is verified. Its vault can operate and pay out." };
	}
	if (status === "pending") {
		return { ...base, detail: "Stripe is reviewing the business's details." };
	}
	return {
		...base,
		label: status === "unverified" ? "Not verified" : base.label,
		detail: canManage
			? "Verify the business with its registration details to operate its vault."
			: "An owner of this business can start its verification.",
		action: canManage
			? (status === "unverified" ? "Verify business" : "Continue verification")
			: null,
	};
}

/** The personal check that is the page's ONE filled action, or `null` when none is outstanding. */
export type VerificationStep = "kyc" | "payouts" | null;

/**
 * The single next step (DESIGN_SYSTEM §B.8.2 — one fill per view): a freelancer's identity check
 * first, then the payout account. Only this step's action is filled — identity in tier 3 teal, the
 * payout setup in tier 1 amber — and every other action on the page is tier-4 neutral outlined.
 * Business KYB rows are repeated actions and are never the filled step. Nothing is filled while
 * the processor is not connected, because nothing can start.
 */
export function nextVerificationStep(s: VerificationStatus): VerificationStep {
	if (!s.processorConnected) return null;
	if (s.isFreelancer && kycCopy(s.kycStatus).action) return "kyc";
	const payout = s.payoutAccount?.status ?? "not_started";
	if (payout !== "verified" && payoutCopy(s.payoutAccount).action) return "payouts";
	return null;
}

/**
 * The crests the page may show (Decision #155): `seal-check` for a verified identity, `shield-check`
 * only for a verified identity AND a verified payout account — the same pair the earning gate
 * (`finance.fn_freelancer_payout_ready`) and the standing stamp require. `payoutReady` alone is the
 * account half, so it never earns the payout crest by itself.
 */
export function verificationStamps(
	s: VerificationStatus,
): { identity: EarnedVerificationStamp | null; payouts: EarnedVerificationStamp | null } {
	const kycVerified = s.kycStatus === "verified";
	return {
		identity: kycVerified ? "id_verified" : null,
		payouts: kycVerified && s.payoutAccount?.status === "verified" ? "vault_verified" : null,
	};
}

/**
 * The payout countries offered when an account is created (ISO 3166-1 alpha-2). Stripe fixes an
 * account's country at creation and it can never change, so it is asked explicitly.
 */
export const PAYOUT_COUNTRIES: readonly { value: string; label: string }[] = [
	{ value: "GB", label: "United Kingdom" },
	{ value: "US", label: "United States" },
	{ value: "IE", label: "Ireland" },
	{ value: "FR", label: "France" },
	{ value: "DE", label: "Germany" },
	{ value: "ES", label: "Spain" },
	{ value: "IT", label: "Italy" },
	{ value: "NL", label: "Netherlands" },
	{ value: "BE", label: "Belgium" },
	{ value: "PT", label: "Portugal" },
	{ value: "AT", label: "Austria" },
	{ value: "FI", label: "Finland" },
	{ value: "SE", label: "Sweden" },
	{ value: "DK", label: "Denmark" },
	{ value: "NO", label: "Norway" },
	{ value: "PL", label: "Poland" },
	{ value: "CH", label: "Switzerland" },
	{ value: "CA", label: "Canada" },
	{ value: "AU", label: "Australia" },
	{ value: "NZ", label: "New Zealand" },
	{ value: "SG", label: "Singapore" },
	{ value: "JP", label: "Japan" },
	{ value: "AE", label: "United Arab Emirates" },
];

/** The notice a return from a Stripe-hosted flow lands with (`?identity=`, `?payouts=`, `?kyb=`). */
export function returnNotice(
	params: URLSearchParams,
): { tone: "info" | "success" | "warning"; text: string } | null {
	if (params.get("identity") === "returned") {
		return {
			tone: "info",
			text: "Thanks — Stripe is checking your identity. This page updates when the result arrives.",
		};
	}
	const payouts = params.get("payouts");
	if (payouts === "verified") return { tone: "success", text: "Your payout account is ready." };
	if (payouts === "restricted" || payouts === "pending_verification") {
		return { tone: "info", text: "Stripe is still confirming your payout details." };
	}
	if (payouts === "unavailable" || payouts === "invalid_link") {
		return {
			tone: "warning",
			text: "We couldn't confirm your payout setup just now. Check back in a moment.",
		};
	}
	const kyb = params.get("kyb");
	if (kyb === "verified") return { tone: "success", text: "The business is verified." };
	if (kyb) return { tone: "info", text: "Stripe is reviewing the business's details." };
	return null;
}
