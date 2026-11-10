import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../../styles/availability-scheduler.css";
import { cx } from "../../../core/cx.ts";
import { useId } from "../../../hooks/useId.ts";
import { todayIn } from "./civil.ts";
import { SchedulerContext, type SchedulerContextValue } from "./context.ts";
import { isTextInput, type KeyCommand, keyToAction } from "./keymap.ts";
import { ShortcutSheet } from "./ShortcutSheet.tsx";
import { createSchedulerStore, type SchedulerStore } from "./store.ts";
import type { Preset, SchedulerBlackout, SchedulerEngine, SchedulerPricing } from "./types.ts";

// #region Props
/** Props for `AvailabilityScheduler.Root`. */
export interface AvailabilitySchedulerRootProps {
	/** The preset being edited. A new object that is not the last one emitted resets the editor. */
	value: Preset;
	/** Every edit, undo and redo, with the whole preset. */
	onChange?: (preset: Preset) => void;
	/** The injected scheduling engine. Read once, on mount. */
	engine: SchedulerEngine;
	/** The zone "today" is read in; defaults to the preset's own. */
	timezone?: string;
	/** First column of the week, 0 = Sunday (default Monday). */
	weekStartsOn?: number;
	/** Today as `YYYY-MM-DD`; defaults to the clock in `timezone`. */
	today?: string;
	/** Locale for weekday, month and date names (default `en-GB`). */
	locale?: string;
	/** Blackout dates the month preview marks. */
	blackouts?: readonly SchedulerBlackout[];
	/** The viewer owns the schedule, so private blackout labels show (default `true`). */
	viewerOwns?: boolean;
	/**
	 * The rule editor's price field (Decision #408). Pass it only while paid calls are live: without it
	 * the field is not drawn, and a rule's stored price is kept as it is.
	 */
	pricing?: SchedulerPricing;
	/** The region's accessible name. */
	label?: string;
	/** Mount the built-in shortcut sheet (default `true`). */
	shortcutSheet?: boolean;
	/**
	 * A store to use instead of making one — shared by several Roots on one page whose parts live in
	 * separate regions (a header, a panel, the body). It was made with its own `onChange`, so this
	 * Root's `onChange` is not called. Read once, on mount.
	 */
	store?: SchedulerStore;
	/**
	 * This Root shares `store` with a primary Root elsewhere on the page: it renders no shortcut sheet
	 * and no live region, so the primary's speak once for both (default `false`).
	 */
	satellite?: boolean;
	class?: string;
	children?: ComponentChildren;
}
// #endregion

// #region Root
/**
 * The scheduler's provider and layout block. Owns a local store, routes the scheduler-wide keys
 * (`[`/`]`, undo/redo, `?`), hosts the polite live region, and sizes from its container,
 * so it behaves the same inside a `Dialog` and on a full page.
 */
export function Root(props: AvailabilitySchedulerRootProps): JSX.Element {
	const {
		value,
		onChange,
		engine,
		timezone = value.timezone,
		weekStartsOn = 1,
		locale = "en-GB",
		blackouts = [],
		viewerOwns = true,
		label = "Availability scheduler",
		shortcutSheet = true,
		satellite = false,
		class: className,
		children,
	} = props;
	const idBase = useId(undefined, "avsched");
	const today = props.today ?? todayIn(timezone);
	const lastEmitted = useRef<Preset>(value);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const store = useMemo(
		() =>
			props.store ?? createSchedulerStore(value, engine, {
				today,
				weekStartsOn,
				locale,
				onChange: (preset) => {
					lastEmitted.current = preset;
					onChangeRef.current?.(preset);
				},
			}),
		[],
	);

	useEffect(() => {
		if (value === lastEmitted.current || value === store.draft.peek()) return;
		lastEmitted.current = value;
		store.dispatch({ type: "reset", preset: value });
	}, [value]);

	const run = (command: KeyCommand) => {
		if (command.type === "openShortcuts") store.shortcutsOpen.value = true;
		else store.dispatch(command);
	};

	const ctx: SchedulerContextValue = {
		store,
		timezone,
		locale,
		weekStartsOn,
		today,
		blackouts,
		viewerOwns,
		pricing: props.pricing ?? null,
		idBase,
		run,
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
		if (e.defaultPrevented) return;
		const command = keyToAction(e, store.state.peek(), {
			scope: "scheduler",
			inTextInput: isTextInput(e.target),
		});
		if (!command) return;
		e.preventDefault();
		run(command);
	};

	const announcement = store.announcement.value;

	return (
		<SchedulerContext.Provider value={ctx}>
			<div class={cx("ui-avsched-scope", className)}>
				<section class="ui-avsched" aria-label={label} onKeyDown={onKeyDown}>
					{children}
					{!satellite && (
						<div class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
							<span key={announcement.seq}>{announcement.text}</span>
						</div>
					)}
				</section>
				{shortcutSheet && !satellite && <ShortcutSheet />}
			</div>
		</SchedulerContext.Provider>
	);
}
// #endregion
