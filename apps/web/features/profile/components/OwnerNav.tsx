import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";

/**
 * OwnerNav — the owner's management sub-nav, above their own profile: **Preview** (the public page,
 * exactly as a visitor sees it) · **Edit profile & settings** · **Availability**.
 *
 * Three real anchors with `aria-current="page"` on the one the reader is on — a view held in a
 * signal has no address, cannot be linked or reloaded, and could not be guarded on the server.
 * Rendered only when the DATABASE says the viewer owns the profile; the edit routes refuse anyone
 * else from their own handlers, so this is navigation, never the gate.
 *
 * A server component: its sheet (`profile-edit.css`) rides the profile islands' barrel import.
 */
export type OwnerNavTab = "preview" | "edit" | "availability";

export interface OwnerNavProps {
	/** The profile's `@handle`. */
	handle: string;
	active: OwnerNavTab;
}

const TABS: ReadonlyArray<{ id: OwnerNavTab; label: string; icon: "eye" | "edit" | "calendar"; path: string }> = [
	{ id: "preview", label: "Preview profile", icon: "eye", path: "" },
	{ id: "edit", label: "Edit profile & settings", icon: "edit", path: "/edit" },
	{ id: "availability", label: "Availability", icon: "calendar", path: "/edit/availability" },
];

export function OwnerNav({ handle, active }: OwnerNavProps): JSX.Element {
	const base = `/${handle.startsWith("@") ? handle : `@${handle}`}`;
	return (
		<nav class="pf-ownernav" aria-label="Manage your profile">
			<ul class="pf-ownernav__list" role="list">
				{TABS.map((tab) => (
					<li key={tab.id} class="pf-ownernav__item">
						<a
							class="pf-ownernav__link"
							href={`${base}${tab.path}`}
							aria-current={tab.id === active ? "page" : undefined}
						>
							<Icon name={tab.icon} size="sm" aria-hidden />
							<span>{tab.label}</span>
						</a>
					</li>
				))}
			</ul>
			{active === "preview" && (
				<p class="pf-ownernav__note">This is how your profile looks to visitors.</p>
			)}
		</nav>
	);
}
