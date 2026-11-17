import type { ComponentChildren, JSX } from "preact";
import type { SettingsSectionKey } from "@projective/types/settings";
import { openSettings } from "../core/settings-bridge.ts";
import { settingsHref } from "../core/settings-registry.ts";

/** Props for {@link SettingsLink}. */
export interface SettingsLinkProps {
	section: SettingsSectionKey;
	/** A registry anchor inside the section. */
	anchor?: string | null;
	class?: string;
	children: ComponentChildren;
}

/**
 * A link to a Settings section that opens the contextual Settings modal over the page on a plain
 * click (Decision #150) and stays a real link to the console page otherwise — a modified click, a
 * middle click, or a page with no modal host.
 */
export function SettingsLink(props: SettingsLinkProps): JSX.Element {
	return (
		<a
			class={props.class}
			href={settingsHref(props.section, props.anchor)}
			onClick={(event) => {
				if (
					event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
				) return;
				event.preventDefault();
				openSettings(props.section, props.anchor);
			}}
		>
			{props.children}
		</a>
	);
}
