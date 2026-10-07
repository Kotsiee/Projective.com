import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { UserBackendService } from "./UserBackendService.ts";
import type { UserContext } from "@projective/types/auth";
import {
	type AppearancePreferences,
	AppearancePreferencesSchema,
	DEFAULT_APPEARANCE,
	type DisplayPreferences,
	splitPreferencesPatch,
	type UserPreferencesUpdate,
} from "@projective/types/org";

/**
 * SettingsBackendService — the fat half of the Settings console's own reads and writes (root
 * CLAUDE.md §8 Decision #150): the account identity block, the appearance & accessibility slice of
 * `org.user_preferences`, and the one preferences save that splits a patch between the display half
 * ({@link UserBackendService}) and the appearance half (here).
 *
 * The other sections read through the services that already own their data (emails, notifications,
 * messaging, scheduling, verification, integrations); this service never re-implements them.
 *
 * ## Why appearance is read and written separately from the display preferences
 *
 * The appearance columns are newer than the display ones. Selecting them in the same statement as the
 * currency would make the currency switcher fail on any database that has not been rebuilt since they
 * landed — a regression in an unrelated, money-adjacent control. So the two halves are separate
 * statements, and an appearance read that fails degrades to the device's own copy (the `pj.a11y`
 * cookie) with `live: false`, never to an error page.
 */

// #region Shapes
/** The names and dates on the account, as the Account section shows them. */
export interface AccountIdentity {
	firstName: string;
	lastName: string;
	username: string | null;
	dob: string | null;
}

/** The device's own copy of the overlays — the fallback base when the account copy is unreadable. */
export type DeviceAppearance = Pick<AppearancePreferences, "contrast" | "font" | "cvd" | "motion">;

/** What a preferences save answers with. */
export interface PreferencesSaveResult {
	/** The resolved display preferences, when the patch touched them. */
	preferences: DisplayPreferences | null;
	/** The appearance after the save, when the patch touched it. */
	appearance: AppearancePreferences | null;
	/** Whether the appearance half reached the account (`false` = this device only). */
	appearancePersisted: boolean;
}

interface AppearanceRow {
	theme: string | null;
	contrast: string | null;
	font: string | null;
	cvd: string | null;
	motion: string | null;
}
// #endregion

// #region Pure helpers
const APPEARANCE_COLUMNS = "theme,contrast,font,cvd,motion";

/**
 * Collapse a raw row into {@link AppearancePreferences}, field by field: a value the schema does not
 * know (a free-text `theme` written before the CHECK existed) falls back to that field's default
 * rather than failing the whole read.
 */
export function appearanceFromRow(
	row: AppearanceRow | null,
	base: AppearancePreferences,
): AppearancePreferences {
	if (!row) return base;
	const pick = <K extends keyof AppearancePreferences>(key: K): AppearancePreferences[K] => {
		const parsed = AppearancePreferencesSchema.shape[key].safeParse(row[key]);
		return parsed.success ? parsed.data as AppearancePreferences[K] : base[key];
	};
	return {
		theme: pick("theme"),
		contrast: pick("contrast"),
		font: pick("font"),
		cvd: pick("cvd"),
		motion: pick("motion"),
	};
}

/** The fallback appearance for a device: its own overlays and a theme that follows the OS. */
export function deviceBase(device: DeviceAppearance | null | undefined): AppearancePreferences {
	if (!device) return { ...DEFAULT_APPEARANCE };
	return {
		...DEFAULT_APPEARANCE,
		contrast: device.contrast,
		font: device.font,
		cvd: device.cvd,
		motion: device.motion,
	};
}
// #endregion

export class SettingsBackendService {
	// #region Identity
	/**
	 * The caller's own names, handle and date of birth (`org.users_public`, own row). `null` when it
	 * cannot be read — the section then says so instead of drawing empty fields that look like data.
	 */
	static async identity(
		actor: ReadActor,
	): Promise<ServiceResult<{ identity: AccountIdentity | null }>> {
		if (!actor.userId) return fail(401, { message: "Sign in to see your account." });
		if (!isAuthBackendLive() || !canReadLive(actor)) return ok({ identity: null });
		try {
			const { data, error } = await getUserClient(actor.accessToken)
				.schema("org")
				.from("users_public")
				.select("first_name,last_name,username,dob")
				.eq("user_id", actor.userId)
				.maybeSingle();
			if (error || !data) return ok({ identity: null });
			const row = data as {
				first_name: string | null;
				last_name: string | null;
				username: string | null;
				dob: string | null;
			};
			return ok({
				identity: {
					firstName: row.first_name ?? "",
					lastName: row.last_name ?? "",
					username: row.username,
					dob: row.dob,
				},
			});
		} catch {
			return ok({ identity: null });
		}
	}
	// #endregion

	// #region Appearance
	/**
	 * The caller's appearance — the account copy when it can be read (`live: true`), else the device's
	 * own overlays with a theme that follows the OS (`live: false`). A guest gets the device copy too:
	 * appearance is a presentation preference, and a signed-out reader still deserves theirs.
	 */
	static async appearance(
		input: { actor: ReadActor; device?: DeviceAppearance | null },
	): Promise<ServiceResult<{ appearance: AppearancePreferences; live: boolean }>> {
		const base = deviceBase(input.device);
		const row = await SettingsBackendService.readAppearance(input.actor);
		return ok({ appearance: appearanceFromRow(row, base), live: row !== null });
	}

	/**
	 * Apply a preferences patch: the display half (currency · locale · direction · the legacy
	 * notification toggles) through {@link UserBackendService.updatePreferences}, the appearance half
	 * here. Each half reports what actually persisted; the appearance half folds the patch over the
	 * device copy when the account write fails, and says `appearancePersisted: false` rather than
	 * claiming a durability it did not get.
	 */
	static async updatePreferences(
		input: {
			context: UserContext;
			actor: ReadActor;
			patch: UserPreferencesUpdate;
			device?: DeviceAppearance | null;
		},
	): Promise<ServiceResult<PreferencesSaveResult>> {
		if (!input.context.userId) {
			return fail(401, { message: "You need to be signed in to change your preferences." });
		}
		const { appearance: appearancePatch, display } = splitPreferencesPatch(input.patch);
		const touchesDisplay = Object.keys(display).length > 0;
		const touchesAppearance = Object.keys(appearancePatch).length > 0;
		if (!touchesDisplay && !touchesAppearance) {
			return fail(422, { message: "No preference changes were supplied." });
		}

		let preferences: DisplayPreferences | null = null;
		if (touchesDisplay) {
			const res = await UserBackendService.updatePreferences({
				context: input.context,
				accessToken: input.actor.accessToken,
				patch: display,
			});
			if (!res.ok || !res.data) {
				return fail(res.status, { message: res.message, errors: res.errors });
			}
			preferences = res.data.preferences;
		}

		let appearance: AppearancePreferences | null = null;
		let appearancePersisted = false;
		if (touchesAppearance) {
			const stored = await SettingsBackendService.writeAppearance(input.actor, appearancePatch);
			if (stored) {
				appearance = appearanceFromRow(stored, deviceBase(input.device));
				appearancePersisted = true;
			} else {
				const current = appearanceFromRow(
					await SettingsBackendService.readAppearance(input.actor),
					deviceBase(input.device),
				);
				appearance = { ...current, ...appearancePatch };
			}
		}

		return ok({ preferences, appearance, appearancePersisted });
	}
	// #endregion

	// #region Live access
	/** The caller's appearance columns, or `null` on any failure (unconfigured, no row, old schema). */
	private static async readAppearance(actor: ReadActor): Promise<AppearanceRow | null> {
		if (!isAuthBackendLive() || !canReadLive(actor)) return null;
		try {
			const { data, error } = await getUserClient(actor.accessToken)
				.schema("org")
				.from("user_preferences")
				.select(APPEARANCE_COLUMNS)
				.eq("user_id", actor.userId)
				.maybeSingle();
			return error ? null : (data as AppearanceRow | null);
		} catch {
			return null;
		}
	}

	/**
	 * Upsert ONLY the appearance columns the patch names, returning the stored row or `null`. An upsert
	 * for the same reason the display writer uses one: an account provisioned before the seed trigger
	 * has no row, and its first change must not silently vanish. RLS limits it to the caller's own row.
	 */
	private static async writeAppearance(
		actor: ReadActor,
		patch: Partial<AppearancePreferences>,
	): Promise<AppearanceRow | null> {
		if (!isAuthBackendLive() || !canReadLive(actor)) return null;
		try {
			const { data, error } = await getUserClient(actor.accessToken)
				.schema("org")
				.from("user_preferences")
				.upsert({ user_id: actor.userId, ...patch }, { onConflict: "user_id" })
				.select(APPEARANCE_COLUMNS)
				.maybeSingle();
			return error ? null : (data as AppearanceRow | null);
		} catch {
			return null;
		}
	}
	// #endregion
}
