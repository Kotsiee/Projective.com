import type { SupabaseClient } from "supabaseClient";
import type { NotificationCenter, NotificationCenterUpdate } from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	buildCenter,
	CATALOG_COLUMNS,
	type CatalogRow,
	CATEGORY_COLUMNS,
	type CategoryRow,
	type CenterWritePlan,
	defaultCenter,
	isEmptyPlan,
	planUpdate,
	PREFS_COLUMNS,
	prefsFieldErrors,
	type PrefsRow,
	writeFailure,
} from "./notification-center.ts";

/**
 * NotificationCenterBackendService — the FAT service behind the settings console's Notifications
 * section (`GET` / `PUT /api/user/notifications`).
 *
 * It reads and writes the acting person's OWN routing preferences in the `comms` schema — the global
 * `notification_prefs` row (channel masters, quiet hours, snooze, time zone) and the sparse
 * `notification_category_prefs` overrides — and summarises the enabled `notification_types` catalog
 * into what no preference can silence. Every query runs under the caller's JWT through
 * {@link getUserClient}; the `user_id = auth.uid()` policies on both preference tables, not this
 * code, are what keep a person to their own rows. The `.eq("user_id", …)` predicates state the intent
 * in the query as well.
 *
 * The mapping rules live in the pure `notification-center.ts` so they are testable without a client;
 * this class only sequences the reads and writes.
 *
 * **Never claims a save.** When the live path is unavailable the read answers the column defaults with
 * `live: false`, and a write is refused rather than echoed back.
 */

// #region Client
/** An RLS-scoped client on the `comms` schema profile. */
function commsDb(accessToken: string): SupabaseClient {
	return getUserClient(accessToken).schema("comms") as unknown as SupabaseClient;
}

/** The message a write needs when it cannot reach the database at all. */
const UNREACHABLE = "We couldn't reach the server. Try again in a moment.";
// #endregion

export class NotificationCenterBackendService {
	/**
	 * The acting person's {@link NotificationCenter}: their global row, all eight categories (absent
	 * rows as `null` = follow the master), and the per-category required-alerts summary from the
	 * enabled catalog.
	 *
	 * A guest is refused (401). Without a live backend or a token, or when the read fails, it answers
	 * the column defaults with `live: false` and no required-alerts summary — something truthful to
	 * draw, never something presented as saved. A person whose prefs row is missing (one provisioned
	 * before the seed trigger) gets it created through the `INSERT own` policy, because the router
	 * treats a missing row as in-app only, not as the column defaults this screen would otherwise show.
	 */
	static async center(actor: ReadActor): Promise<ServiceResult<{ center: NotificationCenter }>> {
		if (!actor.userId) {
			return fail(401, { message: "Sign in to manage your notifications." });
		}
		if (!isAuthBackendLive() || !canReadLive(actor)) return ok({ center: defaultCenter() });

		const center = await NotificationCenterBackendService.readCenter(actor);
		if (center) return ok({ center });
		return ok({ center: defaultCenter() }, {
			message: "We couldn't load your notification settings, so these are the defaults.",
		});
	}

	/**
	 * Apply a partial save and return the fresh {@link NotificationCenter}.
	 *
	 * Applied in a fixed order, each step only when the update asks for it:
	 *  1. `prefs` — an upsert of the person's global row carrying ONLY the fields sent;
	 *  2. `resetChannels` — every own category row's column for each named channel set to `NULL`, so a
	 *     master toggle is not left outranked by older per-category values;
	 *  3. `categories` — one upsert per category carrying ONLY the channels sent (`null` writes `NULL`,
	 *     an omitted channel is left as stored). Because it runs after the reset, a save that resets a
	 *     channel and sets one category's value for it keeps that category's value.
	 *
	 * The steps are separate statements, not one transaction: a failure part-way leaves the earlier
	 * steps applied, and the refusal says so by asking for a refresh rather than reporting a rollback.
	 *
	 * A guest is refused (401), an expired session too; without a live backend the save is refused
	 * (503) rather than echoed. An enabled quiet-hours window missing a bound — the table's CHECK — is a
	 * 422 with a sentence, as are a time zone the router could not evaluate and a malformed snooze.
	 */
	static async updateCenter(
		actor: ReadActor,
		update: NotificationCenterUpdate,
	): Promise<ServiceResult<{ center: NotificationCenter }>> {
		if (!actor.userId) {
			return fail(401, { message: "Sign in to manage your notifications." });
		}
		if (!isAuthBackendLive()) {
			return fail(503, { message: "Notification settings can't be saved in this environment." });
		}
		if (!canReadLive(actor)) {
			return fail(401, { message: "Your session has expired. Please sign in again." });
		}

		const plan = planUpdate(update);
		if (isEmptyPlan(plan)) {
			return fail(422, { message: "No notification changes were supplied." });
		}
		const fieldErrors = prefsFieldErrors(update.prefs);
		const firstError = Object.values(fieldErrors)[0];
		if (firstError) return fail(422, { message: firstError, errors: fieldErrors });

		const refusal = await NotificationCenterBackendService.applyPlan(actor, plan);
		if (refusal) return refusal;

		const center = await NotificationCenterBackendService.readCenter(actor);
		if (!center) {
			return fail(502, {
				message:
					"Your notification settings were saved, but we couldn't reload them. Refresh to see them.",
			});
		}
		return ok({ center }, { message: "Notification settings saved." });
	}

	// #region Reads
	/** The three live reads composed into a centre, or `null` when any of them fails. */
	private static async readCenter(
		actor: ReadActor & { accessToken: string },
	): Promise<NotificationCenter | null> {
		try {
			const db = commsDb(actor.accessToken);
			const [prefs, categories, catalog] = await Promise.all([
				NotificationCenterBackendService.readPrefs(db, actor.userId),
				db.from("notification_category_prefs").select(CATEGORY_COLUMNS).eq(
					"user_id",
					actor.userId,
				),
				// The catalog policy also admits disabled rows to an admin; a disabled type is never
				// delivered, so it is filtered here rather than counted.
				db.from("notification_types").select(CATALOG_COLUMNS).eq("enabled", true),
			]);
			if (!prefs || categories.error || catalog.error) return null;
			return buildCenter({
				prefs,
				categories: (categories.data ?? []) as unknown as CategoryRow[],
				catalog: (catalog.data ?? []) as unknown as CatalogRow[],
			});
		} catch {
			return null;
		}
	}

	/**
	 * The person's global row, creating it first when it is missing. `undefined` when it cannot be read
	 * or created — the caller then reads as failed, since a missing row routes differently from the
	 * defaults this screen would otherwise draw.
	 */
	private static async readPrefs(
		db: SupabaseClient,
		userId: string,
	): Promise<PrefsRow | undefined> {
		const select = () =>
			db.from("notification_prefs").select(PREFS_COLUMNS).eq("user_id", userId).maybeSingle();
		const first = await select();
		if (first.error) return undefined;
		if (first.data) return first.data as unknown as PrefsRow;

		const created = await db
			.from("notification_prefs")
			.upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
		if (created.error) return undefined;
		const second = await select();
		if (second.error || !second.data) return undefined;
		return second.data as unknown as PrefsRow;
	}
	// #endregion

	// #region Writes
	/** Run a {@link CenterWritePlan} in order; a refusal on the first failing step, else `null`. */
	private static async applyPlan(
		actor: ReadActor & { accessToken: string },
		plan: CenterWritePlan,
	): Promise<ServiceResult<{ center: NotificationCenter }> | null> {
		let wrote = false;
		const refuse = (error: { code?: string; message?: string; details?: string | null }) => {
			const refusal = writeFailure(error);
			// A later step failing after an earlier one landed: say so, so nobody trusts the screen.
			return wrote && refusal.status >= 500
				? fail<{ center: NotificationCenter }>(refusal.status, {
					message:
						"Some of your notification settings were saved, but not all. Refresh and try again.",
				})
				: refusal;
		};

		try {
			const db = commsDb(actor.accessToken);

			if (Object.keys(plan.prefs).length > 0) {
				// An upsert sets only the columns it carries on conflict, so untouched fields keep their
				// stored values — and a person with no row yet gets one with the column defaults.
				const { error } = await db
					.from("notification_prefs")
					.upsert({ user_id: actor.userId, ...plan.prefs }, { onConflict: "user_id" });
				if (error) return refuse(error);
				wrote = true;
			}

			if (Object.keys(plan.reset).length > 0) {
				const { error } = await db
					.from("notification_category_prefs")
					.update(plan.reset)
					.eq("user_id", actor.userId);
				if (error) return refuse(error);
				wrote = true;
			}

			// One statement per category: a single bulk upsert would align every row to the union of
			// keys and write `NULL` into channels a row did not send.
			for (const patch of plan.categories) {
				const { error } = await db
					.from("notification_category_prefs")
					.upsert(
						{ user_id: actor.userId, category: patch.category, ...patch.columns },
						{ onConflict: "user_id,category" },
					);
				if (error) return refuse(error);
				wrote = true;
			}
			return null;
		} catch {
			return wrote
				? fail(503, {
					message:
						"Some of your notification settings were saved, but not all. Refresh and try again.",
				})
				: fail(503, { message: UNREACHABLE });
		}
	}
	// #endregion
}
