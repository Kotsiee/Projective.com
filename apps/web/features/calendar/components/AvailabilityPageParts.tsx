import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Button, DatePicker, InputText, ToggleSwitch, useId } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { LaneCreateButton } from "@projective/ui/navigation";
import {
	type AvailabilityPreset,
	isoDateOf,
	type PresetListResult,
	type PresetUser,
	type ScheduleSettings,
} from "@projective/types/scheduling";
import type { SchedulerPreset } from "@projective/ui/calendar";
import {
	defaultPreset,
	libraryPresets,
	schedulerPresetOf,
	starterPreset,
	UNSAVED_PRESET_ID,
} from "@features/catalogue/core/availability-model.ts";
import { SCHEDULER_TEMPLATES } from "@features/catalogue/core/scheduler-engine.ts";
import {
	addTimeOff,
	availabilityBusy,
	drafts,
	duplicateWorking,
	isUnsaved,
	linkService,
	newPreset,
	openPreset,
	presets,
	removeTimeOff,
	schedule,
	usage,
	working,
	writesSettled,
} from "@features/catalogue/core/availability-store.ts";
import { calendarModeHref } from "../core/availability-view.ts";

/**
 * AvailabilityPageParts — the pieces of `/calendar?view=availability` that live outside the scheduler:
 * the template list, the new-template menu, time off, the schedule's zone and publishing, and which
 * services book against the open template. The lane renders them above `--bp-md`; below it the shell
 * removes the lane and the body renders the same parts, so each duty moves rather than doubling.
 *
 * Every part reads the shared availability store, falling back to the server-rendered read until the
 * body island has seeded it, so the first byte and the hydrated page agree.
 */

// #region Reads
/** The presets read: the store's once seeded, else the server's. */
export function presetListOf(initial: PresetListResult | null): PresetListResult | null {
	return presets.value
		? { presets: presets.value, usage: usage.value, schedule: schedule.value }
		: initial;
}

/** The template a page opens on: the one its address names, else the default. */
export function initialPresetOf(
	initial: PresetListResult | null,
	slug: string | null,
): AvailabilityPreset | null {
	const list = initial?.presets ?? [];
	return (slug ? list.find((p) => p.slug === slug) : undefined) ?? defaultPreset(list);
}

/** The zone a first template is made in: the schedule's, else the reader's own. */
export function fallbackZone(settings: ScheduleSettings | null): string {
	return settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

/**
 * The template the page is editing: the working copy once the body has opened one, else the one the
 * address names (or the default), else a first template in the schedule's zone. Every island derives
 * it the same way, so the server's render and the first hydrated frame agree.
 */
export function pageValueOf(
	initial: PresetListResult | null,
	slug: string | null,
): SchedulerPreset {
	const first = initialPresetOf(initial, slug);
	return working.value ??
		(first ? schedulerPresetOf(first) : starterPreset(fallbackZone(initial?.schedule ?? null)));
}

/** A follower as one muted word: the service's title, or the owner the default mirrors into. */
function followerLabel(user: PresetUser): string {
	if (user.kind === "service") return user.name;
	return user.kind === "profile" ? "Profile" : user.kind === "team" ? "Team" : "Business";
}

/** One library template as the page lists it. */
export interface PresetRow {
	id: string;
	slug: string | null;
	name: string;
	meta: string;
	unsaved: boolean;
}

/** The templates in list order, the open one under its live name, an unsaved new one last. */
export function presetRows(list: PresetListResult | null): PresetRow[] {
	const open = working.value;
	const pending = drafts.value;
	const rows: PresetRow[] = libraryPresets(list?.presets ?? []).map((p) => ({
		id: p.id,
		slug: p.slug,
		name: p.id === open?.id ? open.name : p.name,
		meta: [p.isDefault ? "Default" : "", ...(list?.usage[p.id] ?? []).map(followerLabel)]
			.filter(Boolean).join(" · "),
		unsaved: Boolean(pending[p.id]) || (p.id === open?.id && isUnsaved(open)),
	}));
	const fresh = open?.id === UNSAVED_PRESET_ID ? open : pending[UNSAVED_PRESET_ID];
	if (fresh) {
		rows.push({
			id: UNSAVED_PRESET_ID,
			slug: null,
			name: fresh.name,
			meta: "Not saved",
			unsaved: true,
		});
	}
	return rows;
}

/** A leave span as a plain date range in the schedule's zone; the stored end is exclusive. */
function spanLabel(startMs: number, endMs: number, tz: string): string {
	const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" });
	const start = fmt.format(new Date(startMs));
	const end = fmt.format(new Date(endMs - 1));
	return start === end ? start : `${start} – ${end}`;
}
// #endregion

// #region Templates
/** Props for {@link PresetList}. */
export interface PresetListProps {
	rows: readonly PresetRow[];
	activeId: string | null;
	zone: string;
}

/**
 * The templates as rows. Each is a link to its own address, so it opens in a new tab and survives a
 * reload; a plain click opens it in place, and the page keeps the address in step.
 */
export function PresetList(props: PresetListProps): JSX.Element {
	return (
		<ul class="cal-avpage__presets" role="list">
			{props.rows.map((row) => (
				<li key={row.id}>
					<a
						href={calendarModeHref("availability", row.slug)}
						class="cal-avpage__preset"
						aria-current={row.id === props.activeId ? "page" : undefined}
						onClick={(e) => {
							if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
							e.preventDefault();
							openPreset(row.id, props.zone);
						}}
					>
						<span class="cal-avpage__preset-name">
							{row.name}
							{row.unsaved && (
								<span class="cal-avpage__dot">
									<span class="ui-visually-hidden">, unsaved changes</span>
								</span>
							)}
						</span>
						{row.meta && <span class="cal-avpage__preset-meta">{row.meta}</span>}
					</a>
				</li>
			))}
		</ul>
	);
}

/** Props for {@link NewTemplateMenu}. */
export interface NewTemplateMenuProps {
	/** `lane`: the lane footer's create pill. `inline`: a small outlined button in the body. */
	tone: "lane" | "inline";
	zone: string;
}

/** New template: a copy of the open one, or one of the starting points. */
export function NewTemplateMenu(props: NewTemplateMenuProps): JSX.Element {
	const open = useSignal(false);
	const pick = (run: () => void) => () => {
		open.value = false;
		run();
	};
	return (
		<Popover
			open={open}
			label="New template"
			placement={props.tone === "lane" ? "top-start" : "bottom-start"}
			trigger={(api) =>
				props.tone === "lane"
					? (
						<LaneCreateButton
							label="New template"
							icon={<Icon name="plus" />}
							triggerRef={api.ref}
							ariaHasPopup="dialog"
							ariaExpanded={api.expanded}
							ariaControls={api.panelId}
							onClick={api.toggle}
						/>
					)
					: (
						<Button
							size="sm"
							variant="outlined"
							severity="secondary"
							label="New"
							icon={<Icon name="plus" size="sm" />}
							triggerRef={api.ref}
							aria-haspopup="dialog"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
						/>
					)}
		>
			<ul class="ui-avsched__menu-list">
				<li>
					<button
						type="button"
						class="ui-avsched__menu-item"
						disabled={!working.value}
						onClick={pick(duplicateWorking)}
					>
						<span class="ui-avsched__menu-name">
							Copy of {working.value?.name ?? "this template"}
						</span>
					</button>
				</li>
				{SCHEDULER_TEMPLATES.map((t) => (
					<li key={t.key}>
						<button
							type="button"
							class="ui-avsched__menu-item"
							onClick={pick(() => newPreset(t, props.zone))}
						>
							<span class="ui-avsched__menu-name">{t.name}</span>
						</button>
					</li>
				))}
			</ul>
		</Popover>
	);
}
// #endregion

// #region Time off
/** Props for {@link TimeOffManager}. */
export interface TimeOffManagerProps {
	settings: ScheduleSettings | null;
	/** The viewer's first weekday (0 = Sunday), from their locale; the range calendar starts on it. */
	weekStartsOn?: number;
	/**
	 * Whether the form is open, when the host opens it too (the lane's right-click menu); else the
	 * manager's own. Per instance: the lane, the body's mobile foot and the modal each hold one.
	 */
	composing?: Signal<boolean>;
}

/**
 * Booked whole days off, soonest first, then one quiet full-width "Book time off" button. Nothing is
 * asked for until that button is pressed: it opens an inline form in its place — the dates (one
 * range), an optional reason, and whether visitors may read that reason (`label_is_public`, off by
 * default: a visitor sees "Unavailable" unless the owner opts in). Book or Cancel returns to the
 * button, and focus returns with it.
 */
export function TimeOffManager(props: TimeOffManagerProps): JSX.Element {
	const own = useSignal(false);
	const composing = props.composing ?? own;
	const range = useSignal<Date[] | null>(null);
	const label = useSignal("");
	const shared = useSignal(false);
	const formRef = useRef<HTMLFormElement>(null);
	const openerRef = useRef<HTMLButtonElement>(null);
	const restoreFocus = useRef(false);
	const privacyNote = useId(undefined, "cal-leave-privacy");
	const settings = props.settings;

	useEffect(() => {
		if (composing.value) {
			formRef.current?.querySelector<HTMLElement>("input, button")?.focus();
		} else if (restoreFocus.current) {
			restoreFocus.current = false;
			openerRef.current?.focus();
		}
	}, [composing.value]);

	if (!settings) {
		return (
			<p class="cal-avpage__note">Save a template first — time off belongs to your schedule.</p>
		);
	}
	const tz = settings.timezone;
	const busy = availabilityBusy.value;
	const iso = (d: Date) => isoDateOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
	const close = () => {
		range.value = null;
		label.value = "";
		shared.value = false;
		restoreFocus.current = true;
		composing.value = false;
	};
	const book = async () => {
		const [from, to] = range.peek() ?? [];
		if (!from) return;
		const added = await addTimeOff({
			startsOn: iso(from),
			endsOn: iso(to ?? from),
			label: label.peek().trim() || "Unavailable",
			labelIsPublic: shared.peek(),
		});
		if (added) close();
	};

	return (
		<div class="cal-avpage__timeoff">
			{settings.blackouts.length > 0 && (
				<ul class="cal-avpage__leave" role="list">
					{settings.blackouts.map((b) => {
						const when = spanLabel(b.start, b.end, tz);
						return (
							<li key={b.id} class="cal-avpage__leave-row">
								<span class="cal-avpage__leave-main">
									<span class="cal-avpage__leave-label">{b.label}</span>
									<span class="cal-avpage__leave-when">
										{when}
										{b.labelIsPublic && " · Reason shown to visitors"}
									</span>
								</span>
								<Tooltip content="Remove" density="compact">
									<button
										type="button"
										class="cal-avpage__leave-remove ui-hit"
										aria-label={`Remove ${b.label}, ${when}`}
										disabled={busy}
										onClick={() => void removeTimeOff(b.id)}
									>
										<Icon name="close" size="xs" />
									</button>
								</Tooltip>
							</li>
						);
					})}
				</ul>
			)}

			{composing.value
				? (
					<form
						ref={formRef}
						class="cal-avpage__leave-form"
						aria-label="Book time off"
						onSubmit={(e) => {
							e.preventDefault();
							void book();
						}}
						onKeyDown={(e) => {
							if (e.key === "Escape" && !e.defaultPrevented) {
								e.preventDefault();
								close();
							}
						}}
					>
						<div class="cal-avpage__leave-field">
							<span class="cal-avpage__leave-caption" aria-hidden="true">Dates</span>
							<DatePicker
								selectionMode="range"
								variant="bare"
								value={range}
								minDate={new Date()}
								dateFormat="d M yyyy"
								placeholder="First and last day"
								firstDayOfWeek={props.weekStartsOn === 0 ? 0 : 1}
								showIcon
								aria-label="Days off, first and last"
								size="sm"
								fluid
							/>
						</div>
						<div class="cal-avpage__leave-field">
							<span class="cal-avpage__leave-caption" aria-hidden="true">Reason</span>
							<InputText
								value={label}
								variant="bare"
								placeholder="e.g. Holiday, Personal"
								aria-label="Reason, optional"
								maxLength={80}
								size="sm"
								fluid
							/>
						</div>
						<div class="cal-avpage__leave-field">
							<ToggleSwitch
								value={shared}
								label="Show the reason to visitors"
								aria-describedby={privacyNote}
							/>
							<p class="cal-avpage__note" id={privacyNote}>
								Otherwise they see “Unavailable”.
							</p>
						</div>
						<div class="cal-avpage__leave-actions">
							<Button label="Cancel" size="sm" variant="text" onClick={close} />
							<Button
								type="submit"
								label="Book time off"
								size="sm"
								loading={busy}
								disabled={!range.value?.length || busy}
							/>
						</div>
					</form>
				)
				: (
					<Button
						label="Book time off"
						icon={<Icon name="plus" size="sm" />}
						size="sm"
						variant="outlined"
						severity="neutral"
						fluid
						triggerRef={openerRef}
						onClick={() => (composing.value = true)}
					/>
				)}
		</div>
	);
}
// #endregion

// #region Services
/**
 * Which session services book against the open template. Every Session and Group Session the owner
 * sells is listed once, switched on where it follows this template; switching one on moves it here,
 * switching it off returns it to the default. On the default template a service on it can only leave
 * by joining another, so its switch is locked on. A forked service keeps its own hours and is not
 * listed.
 */
export function ServiceLinks(
	props: { open: { id: string }; list: PresetListResult | null },
): JSX.Element {
	const { open, list: read } = props;
	const services = new Map<string, { listing: string; name: string; presetId: string }>();
	for (const [presetId, users] of Object.entries(read?.usage ?? {})) {
		for (const u of users) {
			if (u.kind === "service" && u.listing) {
				services.set(u.listing, { listing: u.listing, name: u.name, presetId });
			}
		}
	}
	const list = [...services.values()].sort((a, b) => a.name.localeCompare(b.name));
	const stored = read?.presets.find((p) => p.id === open.id && p.scope === "library") ?? null;
	const busy = availabilityBusy.value;

	return (
		<section class="ui-avsched__section cal-avpage__services" aria-label="Services">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">Services</h3>
			</div>
			{list.length === 0
				? <p class="cal-avpage__note">Sessions you sell book against these hours.</p>
				: !stored
				? <p class="cal-avpage__note">Save this template to book services against it.</p>
				: (
					<>
						<ul class="cal-avpage__services-list" role="list">
							{list.map((s) => {
								const on = s.presetId === stored.id;
								return (
									<li key={s.listing}>
										<ToggleSwitch
											key={`${stored.id}:${on}:${writesSettled.value}`}
											value={on}
											label={s.name}
											disabled={busy || (on && stored.isDefault)}
											onValueChange={(next) =>
												void linkService(s.listing, next && !stored.isDefault ? stored.id : null)}
										/>
									</li>
								);
							})}
						</ul>
						{stored.isDefault && (
							<p class="cal-avpage__note">
								A service leaves the default by joining another template.
							</p>
						)}
					</>
				)}
		</section>
	);
}
// #endregion
