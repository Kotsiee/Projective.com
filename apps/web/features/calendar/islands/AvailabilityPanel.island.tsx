import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import "../styles/availability-page.css";
import { AvailabilityScheduler, type SchedulerStore } from "@projective/ui/calendar";
import { Drawer } from "@projective/ui/feedback";
import { useMediaQuery } from "@projective/ui/navigation";
import type { PresetListResult } from "@projective/types/scheduling";
import { workspaceSchedulerEngine } from "@features/catalogue/core/availability-conflict-store.ts";
import { archiveWorking } from "@features/catalogue/core/availability-store.ts";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
	contextPanelDocked,
	contextPanelInflow,
	toggleContextPanel,
} from "@web/features/shell/core/context-panel-state.ts";
import {
	AVAILABILITY_PANEL_ID,
	pageViewerOf,
	usePageScheduler,
} from "../core/availability-page.ts";
import { pageValueOf, presetListOf, ServiceLinks } from "../components/AvailabilityPageParts.tsx";
import { SchedulerMenu } from "../components/AvailabilityMenus.tsx";

/** Props for {@link AvailabilityPanel}. */
export interface AvailabilityPanelProps {
	initial: PresetListResult | null;
	presetSlug: string | null;
	/** The viewer's `org.user_preferences.locale`; the weekday rail starts on its first day. */
	locale?: string;
}

/**
 * AvailabilityPanel — the middle-nav PANEL on `/calendar?view=availability`: the open template's
 * Settings (name, default, zone, Archive), the Services that book against it, its Rules and any
 * Issues — or, while a rule is open, that rule's editor in their place (Decision #377). From 1280px it
 * docks in the frame; below it is a drawer. The header band's panel toggle opens and closes it through
 * the shell's shared panel state, as on the agenda, and opening a rule from the grid opens it too.
 *
 * Its parts edit the page's one scheduler store through a satellite `Root`, so the body's Root speaks
 * the announcements and owns the shortcut sheet. A right-click on a rule card opens that rule's rows,
 * anywhere else the workspace's, the same rows as the grid (`SchedulerMenu`).
 */
export default function AvailabilityPanel(props: AvailabilityPanelProps): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const list = presetListOf(props.initial);
	const value = pageValueOf(props.initial, props.presetSlug);
	const viewer = pageViewerOf(props.locale);
	const store = usePageScheduler(value, viewer);
	const stored = list?.presets.find((p) => p.id === value.id) ?? null;
	const asideRef = useRef<HTMLElement>(null);
	const drawerRef = useRef<HTMLDivElement>(null);

	// A rule opened on the grid is edited here, so the panel comes forward with it.
	useSignalEffect(() => {
		if (store.editing.value === null) return;
		if (!contextPanelInflow()) contextDrawerOpen.value = true;
		else if (!contextPanelDocked.peek()) toggleContextPanel();
	});

	const body = (
		<AvailabilityScheduler.Root
			value={value}
			engine={workspaceSchedulerEngine}
			store={store}
			weekStartsOn={viewer.weekStartsOn}
			satellite
			label={`Settings and rules · ${value.name}`}
			class="cal-avpanel__scheduler"
		>
			<PanelParts
				store={store}
				open={value}
				list={list}
				lockDefault={stored?.isDefault ?? false}
				canArchive={Boolean(stored && !stored.isDefault)}
			/>
		</AvailabilityScheduler.Root>
	);

	return (
		<>
			<aside
				id={AVAILABILITY_PANEL_ID}
				class="cal-panel cal-avpanel"
				aria-label="Settings and rules"
				ref={asideRef}
			>
				{body}
				<SchedulerMenu store={store} surface={asideRef} />
			</aside>
			{!inflow && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header="Settings and rules"
					size="min(24rem, 100vw)"
					class="cal-panel-drawer"
				>
					<div class="cal-panel cal-panel--drawer cal-avpanel" ref={drawerRef}>
						{body}
						<SchedulerMenu store={store} surface={drawerRef} />
					</div>
				</Drawer>
			)}
		</>
	);
}

/** The rule editor while a rule is open, else the template's settings, services, rules and issues. */
function PanelParts(
	props: {
		store: SchedulerStore;
		open: { id: string };
		list: PresetListResult | null;
		lockDefault: boolean;
		canArchive: boolean;
	},
): JSX.Element {
	if (props.store.editing.value !== null) return <AvailabilityScheduler.RuleEditor />;
	return (
		<>
			<AvailabilityScheduler.Details
				lockDefault={props.lockDefault}
				onArchive={props.canArchive ? () => void archiveWorking() : undefined}
			/>
			<ServiceLinks open={props.open} list={props.list} />
			<AvailabilityScheduler.RuleList />
			<AvailabilityScheduler.Issues />
		</>
	);
}
