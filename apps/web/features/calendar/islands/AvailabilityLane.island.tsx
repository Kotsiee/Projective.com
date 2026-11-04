import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import "../styles/availability-page.css";
import { Icon } from "@projective/ui/icons";
import {
	ActionMenu,
	LaneCollapseButton,
	LaneFooter,
	LaneFooterActions,
	LaneIconButton,
	LaneList,
	LaneSection,
	LaneSections,
} from "@projective/ui/navigation";
import type { MenuItem } from "@projective/ui/navigation";
import type { PresetListResult } from "@projective/types/scheduling";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { working } from "@features/catalogue/core/availability-store.ts";
import { pageViewerOf } from "../core/availability-page.ts";
import {
	fallbackZone,
	initialPresetOf,
	NewTemplateMenu,
	PresetList,
	presetListOf,
	presetRows,
	TimeOffManager,
} from "../components/AvailabilityPageParts.tsx";
import { newTemplateItems } from "../components/AvailabilityMenus.tsx";

/**
 * AvailabilityLane — the middle-nav lane on `/calendar?view=availability`: which template is open, and
 * the time off every template shares. Two sections of the shared lane accordion inside the lane's own
 * padded list — Templates (each a link to its own `?preset=` address, the open one on a solid
 * `--surface-2` step) and Time off (whole days, booked and removed here) — over the lane footer's
 * actions: Scheduling settings, where the zone and publishing live (Decision #378), and the one create
 * action, New template, which also copies the open one. A right-click anywhere in the lane opens the
 * same three duties as a menu: New template (its choices as a submenu), Book time off (which opens the
 * Time off section on its form) and Scheduling settings.
 *
 * It fetches nothing: the body island seeds the shared store from the server's read and this lane
 * renders that, the server's read covering the first frame. Below 767px the shell removes the lane
 * and the body carries the same parts.
 */
export interface AvailabilityLaneProps {
	initial: PresetListResult | null;
	presetSlug: string | null;
	/** The viewer's `org.user_preferences.locale`; the time-off calendar starts on its first day. */
	locale?: string;
}

type SectionKey = "templates" | "timeoff";

export default function AvailabilityLane(props: AvailabilityLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const open = useSignal<Record<SectionKey, boolean>>({ templates: true, timeoff: true });
	const laneRef = useRef<HTMLDivElement>(null);
	/** The lane's Time off form, opened by its own button or by the right-click menu. */
	const bookingTimeOff = useSignal(false);

	useEffect(() => {
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};
	const toggle =
		(key: SectionKey) => () => (open.value = { ...open.value, [key]: !open.value[key] });

	const list = presetListOf(props.initial);
	const settings = list?.schedule ?? null;
	const zone = fallbackZone(settings);
	const activeId = working.value?.id ?? initialPresetOf(props.initial, props.presetSlug)?.id ??
		null;
	const rows: MenuItem[] = [
		{ key: "new", label: "New template", items: newTemplateItems(zone) },
		{
			key: "timeoff",
			label: "Book time off",
			disabled: !settings,
			disabledReason: "Save a template first — time off belongs to your schedule",
			command: () => {
				open.value = { ...open.value, timeoff: true };
				bookingTimeOff.value = true;
			},
		},
		{ separator: true },
		{ key: "settings", label: "Scheduling settings", command: () => openSettings("scheduling") },
	];

	return (
		<div class="cal-lanewrap">
			<div class="cal-rail">
				<div class="cal-rail__bottom">
					<LaneCollapseButton
						collapsed
						icon={<SidebarToggleIcon />}
						tooltipPlacement="right"
						onToggle={() => setCollapsed(false)}
					/>
				</div>
			</div>

			<div class="cal-lane" ref={laneRef}>
				<LaneList label="Availability">
					<LaneSections>
						<LaneSection
							id="av-templates"
							icon={<Icon name="clock" />}
							label="Templates"
							open={open.value.templates}
							onToggle={toggle("templates")}
						>
							<PresetList rows={presetRows(list)} activeId={activeId} zone={zone} />
						</LaneSection>
						<LaneSection
							id="av-timeoff"
							icon={<Icon name="sun" />}
							label="Time off"
							open={open.value.timeoff}
							onToggle={toggle("timeoff")}
						>
							<TimeOffManager
								settings={settings}
								weekStartsOn={pageViewerOf(props.locale).weekStartsOn}
								composing={bookingTimeOff}
							/>
						</LaneSection>
					</LaneSections>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
					<LaneFooterActions>
						<LaneIconButton
							icon={<Icon name="settings" />}
							label="Scheduling settings"
							tooltipPlacement="top"
							onClick={() => openSettings("scheduling")}
						/>
						<NewTemplateMenu tone="lane" zone={zone} />
					</LaneFooterActions>
				</LaneFooter>
				<ActionMenu model={rows} surface={laneRef} aria-label="Availability lane actions" />
			</div>
		</div>
	);
}
