import type { JSX } from "preact";
import { Breadcrumb } from "@projective/ui/navigation";
import { sectionMeta, type SettingsSectionKey } from "../core/settings-registry.ts";

// #region Stylesheet carrier
import "../styles/settings.css";
// #endregion

/**
 * SettingsBreadcrumb — the wayfinding trail at the top of every Settings console page:
 * `Settings` (`/settings`) → the section's registry label. Two tiers and never deeper — an entry is an
 * anchor on its section's page, not a page of its own. It is also the page's way back up below the
 * shell breakpoint, where the lane is gone. Zero-JS, so it renders in the first byte.
 */
export function SettingsBreadcrumb(props: { section: SettingsSectionKey }): JSX.Element {
	return (
		<Breadcrumb
			class="stg-crumbs"
			model={[{ label: "Settings", url: "/settings" }, { label: sectionMeta(props.section).label }]}
		/>
	);
}
