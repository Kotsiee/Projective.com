import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	DEFAULT_UI_SETTINGS,
	resolveUiSettings,
	splitPreferencesPatch,
	UserPreferencesSchema,
	UserPreferencesUpdateSchema,
} from "./preferences.ts";
import { NotificationCenterUpdateSchema } from "../comms/preferences.ts";

Deno.test("preferences contract — carries no email/push toggle", () => {
	assertFalse("notificationEmail" in UserPreferencesSchema.shape);
	assertFalse("notificationPush" in UserPreferencesSchema.shape);
	assertFalse("notificationEmail" in UserPreferencesUpdateSchema.shape);
	assertFalse("notificationPush" in UserPreferencesUpdateSchema.shape);
});

Deno.test("preferences PATCH — refuses the toggles rather than storing a copy", () => {
	for (const patch of [{ notificationEmail: false }, { notificationPush: true }]) {
		const parsed = UserPreferencesUpdateSchema.safeParse(patch);
		assertFalse(parsed.success, JSON.stringify(patch));
		assertEquals(parsed.error?.issues[0]?.code, "unrecognized_keys");
	}
	assertFalse(
		UserPreferencesUpdateSchema.safeParse({ locale: "fr-FR", notificationEmail: true }).success,
	);
});

Deno.test("notification centre — the one save that accepts the email/push toggles", () => {
	const parsed = NotificationCenterUpdateSchema.safeParse({ prefs: { email: false, push: true } });
	assert(parsed.success);
	assertEquals(parsed.data.prefs, { email: false, push: true });
});

Deno.test("splitPreferencesPatch — the display half is display only", () => {
	assertEquals(splitPreferencesPatch({ theme: "dark", locale: "fr-FR", dateFormat: null }), {
		appearance: { theme: "dark" },
		display: { locale: "fr-FR", dateFormat: null },
		ui: {},
	});
});

Deno.test("splitPreferencesPatch — ui_settings is its own half, never display", () => {
	const ui = { show_tooltip_shortcuts: true };
	assertEquals(splitPreferencesPatch({ locale: "fr-FR", uiSettings: ui }), {
		appearance: {},
		display: { locale: "fr-FR" },
		ui,
	});
});

Deno.test("ui_settings — a protected or unknown shortcut cannot be switched off", () => {
	const patch = (ids: string[]) =>
		UserPreferencesUpdateSchema.safeParse({ uiSettings: { disabled_shortcuts: ids } }).success;
	assert(patch(["save"]));
	assertFalse(patch(["toggle-sidebar"]));
	assertFalse(UserPreferencesUpdateSchema.safeParse({ uiSettings: { theme: "dark" } }).success);
});

Deno.test("ui_settings — a stored value resolves field by field and never throws", () => {
	assertEquals(resolveUiSettings({}), DEFAULT_UI_SETTINGS);
	assertEquals(resolveUiSettings(null), DEFAULT_UI_SETTINGS);
	assertEquals(
		resolveUiSettings({
			show_tooltip_shortcuts: "yes",
			disabled_shortcuts: ["save", "retired-shortcut", "save", 4],
		}),
		{ show_tooltip_shortcuts: false, disabled_shortcuts: ["save"] },
	);
});
