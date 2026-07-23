import type { JSX } from "preact";
import ProfileEntityGrid from "../../islands/ProfileEntityGrid.island.tsx";
import type { ProfileItem } from "../../types/profile-types.ts";

/**
 * EntitiesTab — the profile's Teams / Businesses tab body. Reuses the toggleable
 * {@link ProfileEntityGrid} island (grid ⁄ list view) for the linked-entity roster (root CLAUDE.md
 * Part 2). `label` names the collection ("Teams" / "Businesses").
 */
export function EntitiesTab(
	{ items, handle, label, authed }: {
		items: ProfileItem[];
		handle: string;
		label: string;
		authed: boolean;
	},
): JSX.Element {
	return <ProfileEntityGrid items={items} handle={handle} label={label} authed={authed} />;
}
