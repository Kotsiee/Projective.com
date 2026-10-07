import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import type { UserContext } from "@projective/types/auth";
import type { SettingsSectionEnvelope, SettingsSectionKey } from "@projective/types/settings";
import { useEffectiveContext } from "@features/shell/core/effective-context.ts";
import { entryByAnchor, settingsHref } from "../core/settings-registry.ts";
import { SETTINGS_FOCUS_EVENT, type SettingsFocusDetail } from "../core/settings-bridge.ts";
import { SettingsSectionView } from "../components/SettingsSectionView.tsx";

// #region Stylesheet carrier
import "../styles/settings.css";
// #endregion

/**
 * SettingsConsole — phase two of the Settings engine (Decision #150): the body of a
 * `/settings/[section]` page, server-rendered from the same section read the modal fetches. The lane
 * (a separate island) navigates between sections and asks this body to bring an anchor into view;
 * the URL hash (`/settings/appearance#contrast`) does the same on arrival — including from the modal's
 * "Expand to full page", which lands here with any unsaved draft adopted from session storage.
 */

export interface SettingsConsoleProps {
	section: SettingsSectionKey;
	context: UserContext;
	initial: SettingsSectionEnvelope;
}

export default function SettingsConsole(props: SettingsConsoleProps): JSX.Element {
	const effective = useEffectiveContext(props.context);
	const anchor = useSignal<string | null>(null);
	const focusRequest = useSignal(0);

	useEffect(() => {
		const fromHash = () => {
			const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
			anchor.value = hash && entryByAnchor(hash)?.section === props.section ? hash : null;
		};
		fromHash();
		const onFocus = (event: Event) => {
			const detail = (event as CustomEvent<SettingsFocusDetail>).detail;
			anchor.value = detail.anchor;
			if (detail.focus) focusRequest.value += 1;
		};
		globalThis.addEventListener("hashchange", fromHash);
		globalThis.addEventListener(SETTINGS_FOCUS_EVENT, onFocus);
		return () => {
			globalThis.removeEventListener("hashchange", fromHash);
			globalThis.removeEventListener(SETTINGS_FOCUS_EVENT, onFocus);
		};
	}, []);

	return (
		<div class="stg-console">
			<a class="stg-console__back" href="/settings">
				<Icon name="chevron-left" size="sm" aria-hidden="true" />
				All settings
			</a>
			<SettingsSectionView
				section={props.section}
				mode="page"
				context={effective.value.context}
				initial={props.initial}
				anchor={anchor.value}
				focusRequest={focusRequest.value}
				onEscalate={(section, target) => globalThis.location.assign(settingsHref(section, target))}
			/>
		</div>
	);
}
