import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { DataView, type DataViewLayout } from "@projective/ui/display";
import "../styles/profile.css";
import { EntityCard } from "@features/explore/components/cards/EntityCard.tsx";
import type { ProfileItem } from "../types/profile-types.ts";

/**
 * ProfileEntityGrid — the Teams / Businesses tab body: a TOGGLEABLE grid ⇄ list of profile-shaped
 * entity cards (root CLAUDE.md Part 2.2). It wraps the `@projective/ui` {@link DataView} (which owns the
 * layout toggle + responsive `auto-fill` grid) and reuses the explore {@link EntityCard} verbatim so a
 * team/business reads identically to `/explore`. It MUST be an island: `DataView`'s `itemTemplate` is a
 * render-prop, which cannot cross the server→island boundary — so the template is defined here,
 * client-side.
 */
export interface ProfileEntityGridProps {
	items: ProfileItem[];
	/** Owning profile handle — scopes the card deep-links under `/[handle]/view/[id]`. */
	handle: string;
	/** Accessible label for the collection. */
	label: string;
	/** Whether the viewer is signed in (surfaces the card quick-actions). */
	authed?: boolean;
}

export default function ProfileEntityGrid(
	{ items, handle, label, authed = false }: ProfileEntityGridProps,
): JSX.Element {
	const layout = useSignal<DataViewLayout>("grid");
	if (!items.length) {
		return <p class="pf-empty">Nothing here yet.</p>;
	}
	return (
		<DataView
			value={items}
			layout={layout}
			dataKey="id"
			gridMinWidth="18rem"
			aria-label={label}
			class="pf-entitygrid"
			itemTemplate={(item) => (
				<EntityCard item={item} ctx={{ scope: "profile", handle }} authed={authed} />
			)}
		/>
	);
}
