import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/availability-page.css";
import { AvailabilityScheduler, type SchedulerContextTarget } from "@projective/ui/calendar";
import { TabStrip } from "@projective/ui/navigation";
import type { PresetListResult } from "@projective/types/scheduling";
import { workspaceSchedulerEngine } from "@features/catalogue/core/availability-conflict-store.ts";
import {
	openPreset,
	presets,
	seedPresets,
	working,
} from "@features/catalogue/core/availability-store.ts";
import { calendarModeHref } from "../core/availability-view.ts";
import { restoreDraft, syncDraft } from "../core/availability-draft.ts";
import { SchedulerMenu } from "../components/AvailabilityMenus.tsx";
import {
	availabilityFocus,
	availabilityPresent,
	availabilityView,
	availabilityZoom,
	pageViewerOf,
	usePageScheduler,
} from "../core/availability-page.ts";
import {
	fallbackZone,
	initialPresetOf,
	NewTemplateMenu,
	pageValueOf,
	presetListOf,
	presetRows,
	TimeOffManager,
} from "../components/AvailabilityPageParts.tsx";

/**
 * AvailabilityStudio — the BODY of `/calendar?view=availability`: the open template's week on the
 * shared Calendar engine, full height, and nothing else (Decisions #376, #377).
 *
 * Drag on empty time paints a band on the active layer (a long press starts the same drag on touch);
 * a band opens its rule in the panel. Everything around the grid is the shell's, as on the agenda:
 * the period, undo, redo and Go to now are the header band's; the template's settings, its services,
 * its rules and the rule editor are the panel's; the layer, the zoom ruler and Save are the footer
 * band's; choosing a template, time off and the zone are the lane's. All of them edit one scheduler
 * store ({@link usePageScheduler}) and one position ({@link availabilityFocus}).
 *
 * Below `--bp-md` the shell removes the lane, so this body takes its duties: the templates as tabs
 * above the grid and time off below it, in one column.
 *
 * It seeds the shared availability store from the server's read, which every other region reads too,
 * and keeps `?preset=` on whichever template is open. Edits are kept in the owner's local draft as
 * they are made (`availability-draft.ts`), so leaving asks nothing and the next visit restores them.
 * A right-click on the grid opens the rule's or the workspace's rows (`SchedulerMenu`).
 */
export interface AvailabilityStudioProps {
	/** The acting owner's presets as the server read them; `null` when they could not be read. */
	initial: PresetListResult | null;
	/** The template the address names, if any. */
	presetSlug: string | null;
	/** The acting owner (the entity acted as, else the user) — the local draft is kept per owner. */
	owner: string;
	/** The viewer's `org.user_preferences.locale`; the week is ordered from its first day. */
	locale?: string;
}

export default function AvailabilityStudio(props: AvailabilityStudioProps): JSX.Element {
	const list = presetListOf(props.initial);
	const settings = list?.schedule ?? null;
	const zone = fallbackZone(settings);
	const value = pageValueOf(props.initial, props.presetSlug);
	const viewer = pageViewerOf(props.locale);
	const store = usePageScheduler(value, viewer);
	const studioRef = useRef<HTMLDivElement>(null);
	const target = useSignal<SchedulerContextTarget | null>(null);

	useEffect(() => {
		if (props.initial && presets.peek() === null) seedPresets(props.initial);
		// A draft is only restored against a read it can be compared with.
		const restored = props.initial ? restoreDraft(props.owner) : null;
		const named = initialPresetOf(props.initial, props.presetSlug)?.id ?? null;
		openPreset(props.presetSlug ? named : restored ?? named, zone);
		return props.initial ? syncDraft(props.owner) : undefined;
	}, []);

	// The address follows the open template; one never saved has no slug yet.
	useSignalEffect(() => {
		const open = working.value;
		if (!open) return;
		const slug = presets.value?.find((p) => p.id === open.id)?.slug ?? null;
		const href = calendarModeHref("availability", slug);
		if (location.pathname + location.search !== href) {
			history.replaceState(history.state, "", href);
		}
	});

	const rows = presetRows(list);

	return (
		<div class="cal-avpage">
			<div class="cal-avpage__mobilehead">
				<TabStrip
					tone="lane"
					label="Templates"
					items={rows.map((r) => ({ key: r.id, label: r.name, dot: r.unsaved }))}
					activeKey={value.id}
					onSelect={(id) => openPreset(id, zone)}
				/>
				<NewTemplateMenu tone="inline" zone={zone} />
			</div>

			<div class="cal-avpage__studio" ref={studioRef}>
				<AvailabilityScheduler.Root
					value={value}
					engine={workspaceSchedulerEngine}
					store={store}
					weekStartsOn={viewer.weekStartsOn}
					label={`Availability · ${value.name}`}
				>
					<AvailabilityScheduler.Calendar
						bar={false}
						focus={availabilityFocus}
						view={availabilityView}
						zoom={availabilityZoom}
						present={availabilityPresent}
						onContextTarget={(t) => (target.value = t)}
					/>
				</AvailabilityScheduler.Root>
				<SchedulerMenu
					store={store}
					surface={studioRef}
					target={target}
				/>
			</div>

			<div class="cal-avpage__mobilefoot">
				<section class="cal-avpage__block" aria-labelledby="cal-avpage-timeoff">
					<h2 class="cal-avpage__heading" id="cal-avpage-timeoff">Time off</h2>
					<TimeOffManager settings={settings} weekStartsOn={viewer.weekStartsOn} />
				</section>
			</div>
		</div>
	);
}
