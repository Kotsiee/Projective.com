import type { BusinessKyb, KybRequirement } from "@projective/types/workspace";
import { ownerVerificationStamp, type VerificationStamp } from "@projective/types/org";
import { BUSINESS_REFUSAL_COPY } from "./refusal-copy.ts";

/**
 * kyb-model — the pure wording of a business's Verification module (BU4): the lifecycle Tag, the
 * MetaLine fact, what each outstanding requirement means, the one next step and what verification
 * unlocks. Everything here is derived from the server's `BusinessKyb` read and the `startKyb` flag
 * BB9 decided in SQL; nothing recomputes who may act. Kept apart from the island so every state is
 * testable and the island only renders.
 */

// #region Status
/** The lifecycle Tag: a word and the Tag severity that carries it (never the only channel). */
export interface KybTag {
	label: "Unverified" | "In review" | "Verified" | "Action needed";
	severity: "secondary" | "info" | "success" | "warning";
}

/** Requirements that ask the business to act again rather than wait. */
const ACTION_NEEDED: ReadonlySet<KybRequirement> = new Set<KybRequirement>([
	"provider_restricted",
	"kyb_rejected",
	"kyb_expired",
]);

/**
 * The Tag for a KYB picture. A cleared check is Verified; anything the provider or the platform
 * refused reads Action needed, even while the stored status is pending; a business with no Connect
 * account has nothing with Stripe to review, so it reads Unverified whatever the stored status; then
 * In review; else Unverified.
 */
export function kybTag(kyb: BusinessKyb): KybTag {
	if (kyb.status === "verified") return { label: "Verified", severity: "success" };
	if (kyb.requirementsDue.some((code) => ACTION_NEEDED.has(code))) {
		return { label: "Action needed", severity: "warning" };
	}
	if (kyb.status === "pending" && !kyb.requirementsDue.includes("connect_account")) {
		return { label: "In review", severity: "info" };
	}
	return { label: "Unverified", severity: "secondary" };
}

/**
 * The crest the status line draws (Decision #227: every owner crest resolves through
 * `ownerVerificationStamp`) — `corporate_verified` (`keystone-check`) once the business is verified,
 * else none (Decision #225 (C)).
 */
export function kybStamp(kyb: BusinessKyb): VerificationStamp {
	return ownerVerificationStamp({ kind: "business", verified: kyb.status === "verified" });
}

const VERIFIED_DATE = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

/**
 * The verified date as "4 Feb 2026", always with its year and in UTC so the server render and the
 * hydrated island agree; `""` for a missing or unreadable instant.
 */
export function kybVerifiedDate(iso: string | null): string {
	if (!iso) return "";
	const at = new Date(iso);
	return Number.isNaN(at.getTime()) ? "" : VERIFIED_DATE.format(at);
}

/**
 * One MetaLine fact, in the shape `MetaLine` takes. Declared here rather than imported, because the
 * `@projective/ui/display` barrel pulls stylesheets and this module must load under `deno test`.
 */
export interface KybMetaEntry {
	text: string;
	/** A changing figure — set in `tabular-nums`. */
	tabular?: boolean;
}

/** The MetaLine beside the Tag: when it was verified, or how much is still due. */
export function kybMeta(kyb: BusinessKyb): KybMetaEntry[] {
	if (kyb.status === "verified") {
		const date = kybVerifiedDate(kyb.verifiedAt);
		return date ? [{ text: `Verified on ${date}`, tabular: true }] : [];
	}
	const due = kyb.requirementsDue.length;
	if (due === 0) return [];
	return [{ text: due === 1 ? "1 requirement due" : `${due} requirements due`, tabular: true }];
}
// #endregion

// #region What is due
/**
 * What each outstanding requirement means to the person reading it. The provider's own field-level
 * list is not stored, so these name the stage, never invented fields.
 */
export const KYB_REQUIREMENT_TEXT: Readonly<Record<KybRequirement, string>> = {
	connect_account:
		"Verification hasn't started with Stripe yet. Stripe collects the company's registration details and its beneficial owners.",
	finish_onboarding: "Stripe is waiting on details it asked for, or is still checking them.",
	provider_restricted: "Stripe needs more information before it can verify the business.",
	kyb_rejected: "The last check couldn't verify the business. Verify again with Stripe.",
	kyb_expired:
		"The verification has lapsed. The pooled wallet is on hold until the business is verified again.",
};
// #endregion

// #region The next step
/**
 * The module's one next step, or `null` when there is none (the business is verified). `ask` and
 * `unavailable` are sentences, not controls: who acts, or why nothing can start here.
 */
export type KybAction =
	| { kind: "start"; label: string }
	| { kind: "resume"; label: string; href: string }
	| { kind: "ask"; text: string }
	| { kind: "unavailable"; text: string };

/** The words Settings → Verification & payouts uses for the same environment (Decision #225 (B)). */
export const KYB_PROCESSOR_OFFLINE =
	"Verification runs through our payment processor, which isn't connected in this environment.";

/** Requirements after which the business verifies again rather than carrying on. */
const VERIFY_AGAIN: ReadonlySet<KybRequirement> = new Set<KybRequirement>([
	"kyb_rejected",
	"kyb_expired",
]);

/**
 * The next step for this viewer. Someone without the billing right is told who acts; where the
 * processor is not connected nothing can start, so a holder is told why instead of being offered a
 * control that cannot reach Stripe (§3.11); a holder resumes the business's EXISTING Connect account
 * through the refresh door when BB9 sent its URL — "Verify again" after a refusal or a lapse — else
 * starts onboarding, which creates the account, so it asks for the registration country.
 */
export function kybAction(name: string, kyb: BusinessKyb, canStart: boolean): KybAction | null {
	if (kyb.status === "verified") return null;
	if (!canStart) return { kind: "ask", text: BUSINESS_REFUSAL_COPY.kyb_required.ask({}) };
	if (!kyb.processorConnected) return { kind: "unavailable", text: KYB_PROCESSOR_OFFLINE };
	if (kyb.connectOnboardingUrl) {
		const again = kyb.requirementsDue.some((code) => VERIFY_AGAIN.has(code));
		return {
			kind: "resume",
			label: again ? "Verify again" : "Continue verification",
			href: kyb.connectOnboardingUrl,
		};
	}
	return { kind: "start", label: `Verify ${name}` };
}

/** What starting needs — the start door's answer and the browser's navigation, injected for tests. */
export interface KybStartDeps {
	/** `POST /api/finance/verify/kyb` — answers the Stripe-hosted onboarding link. */
	start: () => Promise<{ ok: boolean; data?: { url?: string } | null; message?: string }>;
	/** Hand the tab to Stripe (`location.assign`). */
	navigate: (url: string) => void;
}

/** The sentence when the start door answers without a reason. */
export const KYB_START_FAILED = "Verification couldn't be started just now.";

/**
 * Start onboarding and hand the tab to the link the door answered. Returns `null` once navigating,
 * else the sentence to show — the server's own refusal (403 for a viewer without the billing right,
 * 503 where the processor is unavailable) or {@link KYB_START_FAILED}.
 */
export async function runKybStart(deps: KybStartDeps): Promise<string | null> {
	const res = await deps.start();
	const url = res.ok ? res.data?.url : null;
	if (url) {
		deps.navigate(url);
		return null;
	}
	return res.message ?? KYB_START_FAILED;
}
// #endregion

// #region What verification unlocks
/**
 * What a verified business may do that an unverified one may not — exactly three, each from the
 * specification, no new claims:
 *   1. finance-model §10 (the Business owner row: "Operating the pooled Business Wallet (fund/spend)")
 *      and PRODUCT_SPEC §Escrow, Wallets & Finance ("Business owners verify to operate the pool";
 *      every way the pool's money moves checks KYB);
 *   2. PRODUCT_SPEC §Identity Verification Level 3 ("Necessary to … utilise Intervaled Invoicing")
 *      and "Paying on account" (a KYB-verified business in intervaled invoicing);
 *   3. PRODUCT_SPEC "Money leaves only to a verified payout account" — a business's is its KYB
 *      Connect account (Decision #126 (C)).
 */
export const KYB_UNLOCKS: readonly string[] = [
	"Funding and spending from the pooled wallet — checkouts, escrow and transfers out.",
	"Monthly invoicing, and paying on account at checkout.",
	"Withdrawals from the business wallet to its verified payout account.",
];
// #endregion

// #region Dev Context Switcher
/**
 * The positions of the Dev Context Switcher's `businessKyb` axis — `DevBusinessKyb` in
 * `@web/utils/dev-seam.ts`, spelled out here because that module reads the DOM and cannot load under
 * `deno test`. The island passes the seam's value straight in, so the two cannot drift unnoticed.
 */
export type KybSimulation = "auto" | "unverified" | "in_review" | "action_needed" | "verified";

/**
 * The KYB picture the Dev Context Switcher's `businessKyb` axis substitutes. `auto` (or no override)
 * is the server's read unchanged; every other value keeps the server's resume URL, so the requirement
 * it shows matches whether the business already has a Connect account — except In review, which is
 * only ever a check Stripe holds, so it always shows `finish_onboarding` (the action still follows the
 * real door: without an account it starts one). Client-side only.
 */
export function simulateKyb(kyb: BusinessKyb, sim: KybSimulation | undefined): BusinessKyb {
	if (!sim || sim === "auto") return kyb;
	const account = kyb.connectOnboardingUrl !== null;
	const waiting: KybRequirement = account ? "finish_onboarding" : "connect_account";
	switch (sim) {
		case "unverified":
			return { ...kyb, status: "unverified", verifiedAt: null, requirementsDue: [waiting] };
		case "in_review":
			return {
				...kyb,
				status: "pending",
				verifiedAt: null,
				requirementsDue: ["finish_onboarding"],
			};
		case "action_needed":
			return {
				...kyb,
				status: "unverified",
				verifiedAt: null,
				requirementsDue: [account ? "provider_restricted" : "kyb_rejected"],
			};
		case "verified":
			return { ...kyb, status: "verified", requirementsDue: [] };
	}
}
// #endregion
