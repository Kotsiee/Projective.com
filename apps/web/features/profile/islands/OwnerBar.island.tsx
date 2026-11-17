import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import "../styles/profile.css";
import { SETTINGS_ANCHOR } from "../core/owner-edit.ts";

/**
 * OwnerBar — one quiet line above the owner's own `/[handle]` (Decision #439, replacing the
 * Preview · Edit · Availability owner nav): what visitors see that the owner does not, and the way to
 * the account-level settings that are not edited on the page — visibility and the display switches in
 * Settings → Profile (the contextual modal), or a workspace's console Settings for a team or business.
 *
 * It also takes the one legacy address no block answers: `#privacy` (where `/[handle]/edit#privacy`
 * now lands) opens Settings → Profile, then leaves the address.
 */
export interface OwnerBarProps {
	note: string;
	/** A team's or business's console Settings; absent, the person's own Settings → Profile. */
	consoleSettingsHref?: string | null;
	/** Whether this page is the person's own (Settings → Profile applies). */
	personal: boolean;
}

export default function OwnerBar(
	{ note, consoleSettingsHref, personal }: OwnerBarProps,
): JSX.Element {
	useEffect(() => {
		if (!personal || globalThis.location.hash !== `#${SETTINGS_ANCHOR}`) return;
		globalThis.history?.replaceState(
			globalThis.history.state,
			"",
			`${globalThis.location.pathname}${globalThis.location.search}`,
		);
		openSettings("profile");
	}, [personal]);

	return (
		<div class="pf-ownerbar" role="note">
			<p class="pf-ownerbar__note">
				<Icon name="edit" size="sm" aria-hidden />
				<span>{note}</span>
			</p>
			{personal
				? (
					<Button
						size="sm"
						severity="neutral"
						variant="outlined"
						aria-haspopup="dialog"
						icon={<Icon name="settings" size="sm" />}
						onClick={() => openSettings("profile")}
					>
						Profile settings
					</Button>
				)
				: consoleSettingsHref && (
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm pf-ownerbar__link"
						href={consoleSettingsHref}
					>
						<span class="ui-button__icon" aria-hidden="true">
							<Icon name="settings" size="sm" />
						</span>
						<span class="ui-button__label">Settings</span>
					</a>
				)}
		</div>
	);
}
