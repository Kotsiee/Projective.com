import type { AccountLifecycle, HandlePolicy } from "@projective/types/org";
import type { SettingsSectionDataOf } from "@projective/types/settings";

/**
 * account-simulation — the dev `accountLifecycle` axis's substitute answers for Settings → Account
 * (Decision #156). It fakes what `org.get_handle_policy` and `org.get_account_lifecycle` would answer;
 * the section still renders them through its shipping code, and nothing is written.
 */

/** The positions of the dev `accountLifecycle` axis (mirrors `DevAccountLifecycle`). */
export type AccountSimulation =
	| "auto"
	| "handle-window"
	| "handle-locked"
	| "removal-scheduled"
	| "deletion-scheduled";

const DAY = 86_400_000;

function at(now: Date, days: number): string {
	return new Date(now.getTime() + days * DAY).toISOString();
}

function basePolicy(data: SettingsSectionDataOf<"account">): HandlePolicy {
	return data.handlePolicy ?? {
		handle: data.identity?.username ?? "you",
		remaining: 2,
		windowEndsAt: null,
		lockedUntil: null,
		lastChangedAt: null,
		totalChanges: 0,
	};
}

function baseLifecycle(data: SettingsSectionDataOf<"account">): AccountLifecycle {
	return data.lifecycle ?? {
		isFreelancer: true,
		hasFreelancerProfile: true,
		freelancerRemoval: null,
		accountDeletion: null,
		freelancerBlockers: [],
		accountBlockers: [],
	};
}

/** The account payload a simulation position renders; `auto` returns the real one untouched. */
export function simulatedAccountData(
	mode: AccountSimulation,
	data: SettingsSectionDataOf<"account">,
	now: Date,
): SettingsSectionDataOf<"account"> {
	switch (mode) {
		case "handle-window":
			return {
				...data,
				handlePolicy: {
					...basePolicy(data),
					remaining: 1,
					windowEndsAt: at(now, 2),
					lockedUntil: null,
					lastChangedAt: at(now, -1),
					totalChanges: 1,
				},
			};
		case "handle-locked":
			return {
				...data,
				handlePolicy: {
					...basePolicy(data),
					remaining: 0,
					windowEndsAt: null,
					lockedUntil: at(now, 60),
					lastChangedAt: at(now, -30),
					totalChanges: 2,
				},
			};
		case "removal-scheduled":
			return {
				...data,
				lifecycle: {
					...baseLifecycle(data),
					isFreelancer: false,
					hasFreelancerProfile: true,
					freelancerRemoval: {
						id: "dev-removal",
						scope: "freelancer_profile",
						requestedAt: at(now, -5),
						scheduledFor: at(now, 85),
					},
				},
			};
		case "deletion-scheduled":
			return {
				...data,
				lifecycle: {
					...baseLifecycle(data),
					accountDeletion: {
						id: "dev-deletion",
						scope: "account",
						requestedAt: at(now, -5),
						scheduledFor: at(now, 25),
					},
				},
			};
		default:
			return data;
	}
}
