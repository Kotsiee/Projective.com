import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { LaneCollapseButton, LaneFooter, LaneHead, LaneList } from "@projective/ui/navigation";
import type { UserContext } from "@projective/types/auth";
import type { SettingsSectionKey } from "@projective/types/settings";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { useEffectiveContext } from "@features/shell/core/effective-context.ts";
import { isEditableTarget, isFocusSearchShortcut } from "@features/shell/core/shortcuts.ts";
import { entryByAnchor, settingsHref, visibleSections } from "../core/settings-registry.ts";
import { requestSettingsFocus } from "../core/settings-bridge.ts";
import type { AttentionTone } from "../core/attention-model.ts";
import { type SettingsLocation, SettingsNavigator } from "../components/SettingsNavigator.tsx";

// #region Stylesheet carrier
import "../styles/settings.css";
import "../styles/settings-lane.css";
// #endregion

/**
 * SettingsLane — the `/settings` console's middle-nav lane (Decision #150), resolved by
 * `settingsLaneFor`: the search field and the section tree (the same `SettingsNavigator` the modal
 * uses), each section marked when it needs attention, and the shell's collapse to an icon rail.
 *
 * Choosing a section NAVIGATES to its page; choosing an entry of the section already open asks the
 * page body to bring it into view (the two are separate islands). `/` focuses the search unless the
 * person is typing.
 */

export interface SettingsLaneProps {
	context: UserContext;
	/** The section the page shows, or `null` on the console root. */
	section: SettingsSectionKey | null;
	marks: Partial<Record<SettingsSectionKey, AttentionTone>>;
}

export default function SettingsLane(props: SettingsLaneProps): JSX.Element {
	const effective = useEffectiveContext(props.context);
	const collapsed = useSignal(false);
	const query = useSignal("");
	const anchor = useSignal<string | null>(null);
	const searchRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		try {
			const el = globalThis.document?.querySelector(".ui-splitter");
			collapsed.value = (el as HTMLElement | null)?.dataset.mode === "collapsed";
		} catch { /* no DOM — non-fatal */ }
		const readHash = () => {
			const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
			anchor.value = hash && entryByAnchor(hash)?.section === props.section ? hash : null;
		};
		readHash();
		globalThis.addEventListener("hashchange", readHash);
		const onKey = (event: KeyboardEvent) => {
			if (!isFocusSearchShortcut(event) || isEditableTarget(event.target as Element | null)) return;
			if (document.querySelector(".ui-dialog")) return;
			const input = searchRef.current?.querySelector<HTMLInputElement>("input");
			if (!input || input.offsetParent === null) return;
			event.preventDefault();
			input.focus();
			input.select();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			globalThis.removeEventListener("hashchange", readHash);
			document.removeEventListener("keydown", onKey);
		};
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* no window — non-fatal */ }
	};

	function select(location: SettingsLocation, focus: boolean): void {
		if (location.section === props.section) {
			const hash = location.anchor ? `#${location.anchor}` : "";
			const state = history.state && typeof history.state === "object" ? history.state : {};
			history.replaceState(
				{ ...state, fClientNav: false },
				"",
				`${globalThis.location.pathname}${globalThis.location.search}${hash}`,
			);
			anchor.value = location.anchor;
			requestSettingsFocus(location.anchor, focus);
			return;
		}
		globalThis.location.assign(settingsHref(location.section, location.anchor));
	}

	const ctx = effective.value.context;
	const selected = props.section ? { section: props.section, anchor: anchor.value } : null;

	return (
		<div class="stg-lane">
			<div class="stg-rail" aria-label="Settings (collapsed)">
				<nav class="stg-rail__group" aria-label="Settings sections">
					{visibleSections(ctx).map((section) => (
						<Tooltip key={section.key} content={section.label} placement="right">
							<a
								class="stg-rail__item"
								href={settingsHref(section.key)}
								aria-label={props.marks[section.key]
									? `${section.label}, needs attention`
									: section.label}
								aria-current={section.key === props.section ? "page" : undefined}
							>
								<Icon name={section.icon} size="md" />
								{props.marks[section.key]
									? (
										<span
											class={`stg-rail__pip stg-rail__pip--${props.marks[section.key]}`}
											aria-hidden="true"
										/>
									)
									: null}
							</a>
						</Tooltip>
					))}
				</nav>
				<div class="stg-rail__bottom">
					<LaneCollapseButton
						collapsed
						icon={<SidebarToggleIcon />}
						tooltipPlacement="right"
						onToggle={() => setCollapsed(false)}
					/>
				</div>
			</div>

			<div class="stg-lane__full">
				<LaneHead>
					<a
						class="stg-lane__title"
						href="/settings"
						aria-current={props.section === null ? "page" : undefined}
					>
						Settings
					</a>
				</LaneHead>
				<LaneList label="Settings">
					<div class="stg-lane__body">
						<SettingsNavigator
							context={ctx}
							selected={selected}
							query={query}
							marks={props.marks}
							searchRef={searchRef}
							onSelect={select}
						/>
					</div>
				</LaneList>
				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
				</LaneFooter>
			</div>
		</div>
	);
}
