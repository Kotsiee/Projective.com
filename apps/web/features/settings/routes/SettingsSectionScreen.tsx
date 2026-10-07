import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { DEFAULT_SETTINGS_SECTION, isSettingsSectionKey } from "@projective/types/settings";
import { resolveSettingsSection } from "../core/settings-ssr.ts";
import { sectionMeta, settingsHref } from "../core/settings-registry.ts";
import SettingsConsole from "../islands/SettingsConsole.island.tsx";

/**
 * `/settings/[section]` — one section of the Settings console (Decision #150), re-exported by
 * `routes/(dashboard)/settings/[section].tsx`.
 *
 * Thin controller: validate the segment (an unknown one 303s to the canonical first section — a
 * mistyped or retired address still lands somewhere useful), read the section through the SAME
 * composer the modal's `/api/settings/[section]` uses, and hand it to the island. `verification` and
 * `integrations` never reach here — their static routes render their own consoles in the same lane.
 * The guest bounce is the `(dashboard)` middleware's job.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const key = ctx.params.section;
		if (!isSettingsSectionKey(key)) {
			return new Response(null, {
				status: 303,
				headers: { location: settingsHref(DEFAULT_SETTINGS_SECTION) },
			});
		}
		const context = asAuthenticatedContext(ctx.state.userContext);
		const initial = await resolveSettingsSection(key, {
			context,
			actor: readActor(ctx),
			a11y: ctx.state.a11y,
		});
		ctx.state.title = `${sectionMeta(key).label} · Settings · Projective`;
		return page({ section: key, context, initial });
	},
});

export default define.page<typeof handler>(function SettingsSectionPage({ data }) {
	return <SettingsConsole section={data.section} context={data.context} initial={data.initial} />;
});
