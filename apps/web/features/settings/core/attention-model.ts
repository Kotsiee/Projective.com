import type { SettingsAttentionFacts, SettingsSectionKey } from "@projective/types/settings";
import type { SetupAction } from "@projective/types/org";
import { SETUP_ACTION_LABEL, setupActionHref } from "@features/shell/core/setup-actions.ts";
import { longDate } from "./settings-dates.ts";

/**
 * attention-model — the one rule that turns the settings attention FACTS (verification, connections,
 * email addresses) into the items the `/settings` dashboard lists and the marks the lane draws
 * (Decision #150). Pure and isomorphic: the server derives the lane's marks from it, and the
 * dashboard island re-derives from the same facts — or from a dev simulation's substitute facts —
 * so the shipping rule is what every surface exercises.
 */

// #region Shapes
/** How urgent an item is. `danger` blocks earning or paying; `warning` will; `info` is a nudge. */
export type AttentionTone = "danger" | "warning" | "info";

/** One thing the person should do. */
export interface AttentionItem {
	/** Stable per item — a list key. */
	key: string;
	section: SettingsSectionKey;
	/** The registry anchor the action lands on, when there is one. */
	anchor: string | null;
	tone: AttentionTone;
	title: string;
	detail: string;
	/** The verb on the item's one action. */
	action: string;
	href: string;
}

/** The dev simulation positions (`settingsAttention` axis): the real facts, none, or every problem. */
export type AttentionSimulation = "auto" | "clear" | "all";
// #endregion

// #region Rule
const TONE_RANK: Readonly<Record<AttentionTone, number>> = { danger: 0, warning: 1, info: 2 };

/** Statuses of a connection that a reconnect fixes. `revoked` is the person's own choice — not a problem. */
const BROKEN_CONNECTION = new Set(["expired", "error", "degraded", "disconnected"]);

/**
 * The setup steps the profile item nudges. The others already have an item of their own (an email to
 * confirm, an identity check, a payout account) or are a choice rather than a gap (becoming a
 * freelancer).
 */
const PROFILE_ACTIONS: ReadonlySet<SetupAction> = new Set([
	"add_photo",
	"write_profile",
	"publish_hours",
	"add_skills",
	"complete_account",
]);

/**
 * Derive the attention items, most urgent first (ties keep rule order). A `null` fact contributes
 * nothing — an unreadable verification is neither a problem nor an all-clear — and a processor that
 * is not connected in this environment asks for nothing, because nothing could be started.
 */
export function attentionItems(
	facts: SettingsAttentionFacts,
	options: { locale?: string } = {},
): AttentionItem[] {
	const locale = options.locale ?? "en-GB";
	const items: AttentionItem[] = [];
	const security = facts.security;
	if (security?.accountDeletionAt) {
		items.push({
			key: "account-deletion",
			section: "account",
			anchor: "delete-account",
			tone: "danger",
			title: `Your account will be deleted on ${longDate(security.accountDeletionAt, locale)}`,
			detail: "Your profile is hidden until then. Cancel before that date to keep your account.",
			action: "Review",
			href: "/settings/account#delete-account",
		});
	}
	if (security?.freelancerRemovalAt) {
		items.push({
			key: "freelancer-removal",
			section: "account",
			anchor: "account-type",
			tone: "warning",
			title: `Your freelancer profile will be deleted on ${
				longDate(security.freelancerRemovalAt, locale)
			}`,
			detail: "Your listings are paused. Become a freelancer again before then to keep everything.",
			action: "Review",
			href: "/settings/account#account-type",
		});
	}
	const v = facts.verification;
	if (v && v.processorConnected) {
		if (v.isFreelancer && v.kycStatus !== "verified") {
			const rejected = v.kycStatus === "rejected" || v.kycStatus === "expired";
			const pending = v.kycStatus === "pending";
			items.push({
				key: "kyc",
				section: "verification",
				anchor: "identity-check",
				tone: rejected ? "danger" : pending ? "info" : "warning",
				title: rejected
					? "Your identity check needs another try"
					: pending
					? "Your identity check is in review"
					: "Verify your identity to get paid",
				detail: rejected
					? "The last check didn't go through. Start a new one to keep earning."
					: pending
					? "Stripe is reviewing your documents. You don't need to do anything yet."
					: "A Level 2 check is required before you can withdraw your earnings.",
				action: pending ? "View status" : rejected ? "Try again" : "Start check",
				href: "/settings/verification#identity-check",
			});
		}
		if (v.isFreelancer && !v.payoutReady) {
			items.push({
				key: "payout",
				section: "verification",
				anchor: "payouts",
				tone: "warning",
				title: v.payoutStatus && v.payoutStatus !== "not_started"
					? "Finish setting up your payout account"
					: "Add a payout bank account",
				detail:
					"Withdrawals are paid to a Stripe Connect account. Without one, earnings stay in your wallet.",
				action: v.payoutStatus && v.payoutStatus !== "not_started"
					? "Continue setup"
					: "Add account",
				href: "/settings/verification#payouts",
			});
		}
		for (const business of v.businessesNeedingKyb.filter((b) => b.canManage)) {
			items.push({
				key: `kyb:${business.id}`,
				section: "verification",
				anchor: "business-verification",
				tone: "warning",
				title: `Verify ${business.name}`,
				detail: "The business's vault can't operate until its registration is verified.",
				action: "Verify business",
				href: "/settings/verification#business-verification",
			});
		}
	}
	for (const connection of facts.connections ?? []) {
		if (!BROKEN_CONNECTION.has(connection.status)) continue;
		items.push({
			key: `connection:${connection.id}`,
			section: "integrations",
			anchor: null,
			tone: "warning",
			title: `Reconnect ${connection.label}`,
			detail: connection.status === "expired"
				? "Its sign-in expired, so it has stopped syncing."
				: "It has stopped responding. Reconnecting usually fixes it.",
			action: "Reconnect",
			href: "/settings/integrations",
		});
	}
	const billing = facts.billing;
	if (billing?.subscriptionState === "past_due") {
		items.push({
			key: "plan-past-due",
			section: "billing",
			anchor: "plan",
			tone: "danger",
			title: "Your plan's last payment failed",
			detail: "Update the card it's paid with to keep your plan.",
			action: "Review plan",
			href: "/settings/billing#plan",
		});
	}
	if (billing && billing.expiredCards > 0) {
		items.push({
			key: "cards-expired",
			section: "billing",
			anchor: "cards",
			tone: "warning",
			title: billing.expiredCards === 1
				? "A saved card has expired"
				: `${billing.expiredCards} saved cards have expired`,
			detail: "An expired card can't be charged. Remove it, or add a new card at checkout.",
			action: "Review cards",
			href: "/settings/billing#cards",
		});
	} else if (billing && billing.expiringCards > 0) {
		items.push({
			key: "cards-expiring",
			section: "billing",
			anchor: "cards",
			tone: "info",
			title: billing.expiringCards === 1
				? "A saved card expires soon"
				: `${billing.expiringCards} saved cards expire soon`,
			detail: "Add a replacement at checkout before it stops working.",
			action: "Review cards",
			href: "/settings/billing#cards",
		});
	}
	const profile = facts.profile;
	if (
		profile && profile.score < 100 && profile.nextAction &&
		PROFILE_ACTIONS.has(profile.nextAction)
	) {
		items.push({
			key: "profile",
			section: "profile",
			anchor: null,
			tone: "info",
			title: `Your profile is ${profile.score}% set up`,
			detail: profile.pendingSteps === 1
				? "One step left before your profile is complete."
				: `${profile.pendingSteps} steps left before your profile is complete.`,
			action: SETUP_ACTION_LABEL[profile.nextAction],
			href: setupActionHref(profile.nextAction, profile.handle),
		});
	}
	if (security && security.signInMethods === 1 && security.canAddSignIn) {
		items.push({
			key: "sign-in-backup",
			section: "account",
			anchor: "connected-accounts",
			tone: "info",
			title: "Add a backup way to sign in",
			detail: "With only one sign-in method, losing it would lock you out of your account.",
			action: "Connect an account",
			href: "/settings/account#connected-accounts",
		});
	}
	const unverified = facts.unverifiedEmails ?? 0;
	if (unverified > 0) {
		items.push({
			key: "emails",
			section: "account",
			anchor: "emails",
			tone: "info",
			title: unverified === 1
				? "Confirm your new email address"
				: `Confirm ${unverified} email addresses`,
			detail: "Open the link we sent to start using it for invitations.",
			action: "Review",
			href: "/settings/account#emails",
		});
	}
	return items
		.map((item, order) => ({ item, order }))
		.sort((a, b) => TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone] || a.order - b.order)
		.map(({ item }) => item);
}

/** A saved card's expiry, as the card list reports it. */
export interface CardExpiry {
	expMonth: number | null;
	expYear: number | null;
}

/**
 * How many cards have expired, and how many expire this month or next — the billing facts. A card
 * with no expiry on file is neither.
 */
export function cardExpiryCounts(
	cards: readonly CardExpiry[],
	now: Date,
): { expiredCards: number; expiringCards: number } {
	const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
	let expiredCards = 0;
	let expiringCards = 0;
	for (const card of cards) {
		if (!card.expMonth || !card.expYear) continue;
		const last = card.expYear * 12 + (card.expMonth - 1);
		if (last < current) expiredCards += 1;
		else if (last - current <= 1) expiringCards += 1;
	}
	return { expiredCards, expiringCards };
}

/** The most urgent tone per section — what the lane marks a section with. */
export function attentionBySection(
	items: readonly AttentionItem[],
): Partial<Record<SettingsSectionKey, AttentionTone>> {
	const out: Partial<Record<SettingsSectionKey, AttentionTone>> = {};
	for (const item of items) {
		const current = out[item.section];
		if (!current || TONE_RANK[item.tone] < TONE_RANK[current]) out[item.section] = item.tone;
	}
	return out;
}
// #endregion

// #region Dev simulation
/**
 * The facts a dev simulation substitutes. `clear` is a fully set-up freelancer; `all` trips every
 * rule once. `auto` returns the real facts untouched. The RULE still decides what shows — only the
 * facts are faked (the `profileSetup` axis precedent, Decision #149(G)).
 */
export function simulatedAttentionFacts(
	mode: AttentionSimulation,
	real: SettingsAttentionFacts,
): SettingsAttentionFacts {
	if (mode === "auto") return real;
	if (mode === "clear") {
		return {
			verification: {
				isFreelancer: true,
				kycStatus: "verified",
				payoutReady: true,
				payoutStatus: "active",
				processorConnected: true,
				businessesNeedingKyb: [],
			},
			connections: [],
			unverifiedEmails: 0,
			profile: {
				handle: real.profile?.handle ?? "you",
				score: 100,
				pendingSteps: 0,
				nextAction: null,
			},
			billing: { expiredCards: 0, expiringCards: 0, subscriptionState: "active" },
			security: {
				signInMethods: 2,
				canAddSignIn: true,
				accountDeletionAt: null,
				freelancerRemovalAt: null,
			},
		};
	}
	return {
		verification: {
			isFreelancer: true,
			kycStatus: "unverified",
			payoutReady: false,
			payoutStatus: "not_started",
			processorConnected: true,
			businessesNeedingKyb: [{ id: "dev-business", name: "Helia Finance", canManage: true }],
		},
		connections: [{ id: "dev-drive", label: "Google Drive", status: "expired" }],
		unverifiedEmails: 1,
		profile: {
			handle: real.profile?.handle ?? "you",
			score: 60,
			pendingSteps: 2,
			nextAction: "add_photo",
		},
		billing: { expiredCards: 1, expiringCards: 0, subscriptionState: "past_due" },
		security: {
			signInMethods: 1,
			canAddSignIn: true,
			accountDeletionAt: new Date(Date.UTC(2026, 10, 7)).toISOString(),
			freelancerRemovalAt: null,
		},
	};
}
// #endregion
