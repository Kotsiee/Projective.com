import { z } from "zod";

/**
 * org account lifecycle — the Zod SSOT for a person's own @handle changes and scheduled removals
 * (migration 00001060, `org.handle_changes` · `org.deletion_requests`).
 *
 * The RULES live in SQL (`org.fn_handle_change_policy`, `org.fn_account_blockers`); this module only
 * carries their answers, so a dev simulation substitutes an answer rather than re-deriving one.
 */

// #region Constants
/** The handle change policy — mirrored by `org.fn_handle_change_policy`. */
export const HANDLE_POLICY = Object.freeze({
	/** Changes allowed inside one window. */
	changesPerWindow: 2,
	/** The window a correction must land in, in days. */
	windowDays: 3,
	/** How long changes lock after the window's last change, in days. */
	lockDays: 90,
	/** How long a released handle is held for its previous owner, in days. */
	holdDays: 90,
});

/** How long each scheduled removal waits before the erasure runs, in days. */
export const DELETION_WINDOW_DAYS = Object.freeze({ freelancer_profile: 90, account: 30 });

/** The phrase a person types to confirm a removal — checked again by the definer. */
export const DELETION_CONFIRMATION = "CONFIRM";
// #endregion

// #region Handle policy
/** Where a person stands under the handle change policy. */
export const HandlePolicySchema = z.object({
	handle: z.string(),
	/** Changes left right now: 2 (a fresh window), 1 (inside a window), 0 (locked). */
	remaining: z.number().int().min(0).max(2),
	/** When the open correction window closes, while one is open. */
	windowEndsAt: z.string().nullable(),
	/** When changes unlock, while locked. */
	lockedUntil: z.string().nullable(),
	lastChangedAt: z.string().nullable(),
	totalChanges: z.number().int().min(0),
});
export type HandlePolicy = z.infer<typeof HandlePolicySchema>;

/** The definer's snake_case answer, parsed straight into {@link HandlePolicy}. */
export const HandlePolicyRowSchema = z
	.object({
		handle: z.string(),
		remaining: z.number().int().min(0).max(2),
		window_ends_at: z.string().nullable(),
		locked_until: z.string().nullable(),
		last_changed_at: z.string().nullable(),
		total_changes: z.number().int().min(0),
	})
	.transform((row): HandlePolicy => ({
		handle: row.handle,
		remaining: row.remaining,
		windowEndsAt: row.window_ends_at,
		lockedUntil: row.locked_until,
		lastChangedAt: row.last_changed_at,
		totalChanges: row.total_changes,
	}));

/** `POST /api/user/handle`. */
export const ChangeHandleSchema = z.object({
	handle: z.string().trim().min(1).max(40),
}).strict();
export type ChangeHandle = z.infer<typeof ChangeHandleSchema>;
// #endregion

// #region Scheduled removals
export const DeletionScope = z.enum(["freelancer_profile", "account"]);
export type DeletionScope = z.infer<typeof DeletionScope>;

/** What stands between a person and scheduling a removal (`org.fn_account_blockers`). */
export const DeletionBlocker = z.enum([
	"escrow_held",
	"live_work",
	"wallet_balance",
	"active_projects",
	"owns_workspaces",
]);
export type DeletionBlocker = z.infer<typeof DeletionBlocker>;

/** One open request. */
export const DeletionRequestSchema = z.object({
	id: z.string(),
	scope: DeletionScope,
	requestedAt: z.string(),
	scheduledFor: z.string(),
});
export type DeletionRequest = z.infer<typeof DeletionRequestSchema>;

const DeletionRequestRowSchema = z
	.object({
		id: z.string(),
		scope: DeletionScope,
		status: z.literal("scheduled"),
		requested_at: z.string(),
		scheduled_for: z.string(),
	})
	.transform((row): DeletionRequest => ({
		id: row.id,
		scope: row.scope,
		requestedAt: row.requested_at,
		scheduledFor: row.scheduled_for,
	}));

/** The person's account lifecycle as Settings → Account draws it. */
export const AccountLifecycleSchema = z.object({
	isFreelancer: z.boolean(),
	/** A seller profile exists (it outlives the persona until its erasure runs). */
	hasFreelancerProfile: z.boolean(),
	freelancerRemoval: DeletionRequestSchema.nullable(),
	accountDeletion: DeletionRequestSchema.nullable(),
	freelancerBlockers: z.array(DeletionBlocker),
	accountBlockers: z.array(DeletionBlocker),
});
export type AccountLifecycle = z.infer<typeof AccountLifecycleSchema>;

/** `org.get_account_lifecycle`'s snake_case answer. */
export const AccountLifecycleRowSchema = z
	.object({
		is_freelancer: z.boolean(),
		has_freelancer_profile: z.boolean(),
		freelancer_removal: DeletionRequestRowSchema.nullable(),
		account_deletion: DeletionRequestRowSchema.nullable(),
		freelancer_blockers: z.array(DeletionBlocker),
		account_blockers: z.array(DeletionBlocker),
	})
	.transform((row): AccountLifecycle => ({
		isFreelancer: row.is_freelancer,
		hasFreelancerProfile: row.has_freelancer_profile,
		freelancerRemoval: row.freelancer_removal,
		accountDeletion: row.account_deletion,
		freelancerBlockers: row.freelancer_blockers,
		accountBlockers: row.account_blockers,
	}));

/** `POST /api/user/lifecycle` — schedule a removal, confirmed by the typed phrase. */
export const ScheduleDeletionSchema = z.object({
	scope: DeletionScope,
	confirmation: z.string().max(40),
}).strict();
export type ScheduleDeletion = z.infer<typeof ScheduleDeletionSchema>;
// #endregion

// #region Refusals
/** Every refusal the 00001060 definers raise, as the exception message. */
export const AccountRefusal = z.enum([
	"handle_unchanged",
	"handle_locked",
	"handle_refused",
	"account_closing",
	"confirmation_mismatch",
	"already_scheduled",
	"not_freelancer",
	"blocked",
	"not_scheduled",
	"scope_invalid",
]);
export type AccountRefusal = z.infer<typeof AccountRefusal>;

/** Whether a raised message is one of the {@link AccountRefusal} codes. */
export function isAccountRefusal(value: unknown): value is AccountRefusal {
	return AccountRefusal.safeParse(value).success;
}
// #endregion

// #region Copy
/** What each blocker asks the person to do — the refusal's sentence and the UI's checklist line. */
export const DELETION_BLOCKER_COPY: Readonly<Record<DeletionBlocker, string>> = {
	escrow_held: "Money is held in escrow for or by you. Let it release first.",
	live_work: "You're still assigned to live work. Finish it or hand it back first.",
	wallet_balance: "Your wallet still holds money. Withdraw it first.",
	active_projects: "You own projects that are still running. Complete or close them first.",
	owns_workspaces: "You own a team, business or organisation. Transfer or archive it first.",
};
// #endregion
