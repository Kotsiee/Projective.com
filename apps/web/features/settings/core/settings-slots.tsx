import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import SettingsLane from "../islands/SettingsLane.island.tsx";
import { sectionOfPath } from "./settings-registry.ts";
import { attentionBySection, attentionItems } from "./attention-model.ts";
import { attentionFactsFor } from "./settings-ssr.ts";

/**
 * settingsLaneFor — the `/settings` console's middle-nav lane resolver for `(dashboard)/_layout.tsx`'s
 * `laneFor` (Decision #150). A pure URL slot resolver: `null` off `/settings`, otherwise the lane for
 * the section the path names (or the root), with each section's attention mark derived from the same
 * facts — read once per request — that the dashboard page lists.
 */
export async function settingsLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
	state: object,
): Promise<ComponentChildren> {
	const path = url.pathname.replace(/\/+$/, "");
	if (path !== "/settings" && !path.startsWith("/settings/")) return null;
	const where = sectionOfPath(path);
	const facts = await attentionFactsFor(state, actor);
	return (
		<SettingsLane
			context={context}
			section={where === "index" ? null : where}
			marks={attentionBySection(attentionItems(facts))}
		/>
	);
}
