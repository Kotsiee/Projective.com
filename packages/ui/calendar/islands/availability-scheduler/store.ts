import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { monthMatrix } from "./civil.ts";
import {
	type Cursor,
	initialState,
	reduce,
	type SchedulerAction,
	type SchedulerState,
	type Selection,
} from "./reducer.ts";
import type {
	Issue,
	Layer,
	Occurrence,
	Preset,
	SchedulerEngine,
	SchedulerTemplate,
	SchedulerView,
	Snap,
	Weekday,
} from "./types.ts";

export { reduce } from "./reducer.ts";
export type { Cursor, SchedulerAction, SchedulerState, Selection } from "./reducer.ts";

// #region Types
/** Options for {@link createSchedulerStore}. */
export interface SchedulerStoreOptions {
	/** Today in the preset's zone, `YYYY-MM-DD`. */
	today: string;
	weekStartsOn?: number;
	locale?: string;
	/** Fired by {@link SchedulerStore.commit} with the current draft. */
	onChange?: (preset: Preset) => void;
}

/** The scheduler's signals and actions (plan §5.4). */
export interface SchedulerStore {
	readonly engine: SchedulerEngine;
	/** The whole state, for consumers that want one subscription. */
	readonly state: ReadonlySignal<SchedulerState>;
	readonly draft: ReadonlySignal<Preset>;
	/** Undo stack, oldest first. */
	readonly history: ReadonlySignal<Preset[]>;
	readonly cursor: ReadonlySignal<Cursor>;
	readonly selection: ReadonlySignal<Selection | null>;
	readonly editing: ReadonlySignal<string | null>;
	readonly layer: ReadonlySignal<Layer>;
	readonly snap: ReadonlySignal<Snap>;
	readonly view: ReadonlySignal<SchedulerView>;
	readonly focusMonth: ReadonlySignal<string>;
	readonly announcement: ReadonlySignal<{ text: string; seq: number }>;
	readonly canUndo: ReadonlySignal<boolean>;
	readonly canRedo: ReadonlySignal<boolean>;
	/** Evaluated spans over the six weeks the month preview shows. */
	readonly occurrences: ReadonlySignal<Occurrence[]>;
	readonly issues: ReadonlySignal<Issue[]>;
	/** Whether the shortcut sheet is open. */
	readonly shortcutsOpen: Signal<boolean>;

	dispatch(action: SchedulerAction): void;
	createBand(day: Weekday, start: number, end: number): void;
	moveBand(sel: Selection, toDay: Weekday, minutes: number): void;
	resizeBand(sel: Selection, edge: "start" | "end", minutes: number): void;
	duplicateBand(sel: Selection, toDay: Weekday): void;
	deleteBand(sel: Selection): void;
	upsertRule(rule: Preset["rules"][number]): void;
	deleteRule(ruleId: string, name?: string): void;
	setLayer(layer: Layer): void;
	undo(): void;
	redo(): void;
	loadTemplate(template: SchedulerTemplate): void;
	/** Emit the current draft through `onChange`. */
	commit(): void;
	/** Swap the change listener (a host re-render hands a new closure). */
	setOnChange(fn: ((preset: Preset) => void) | undefined): void;
}
// #endregion

// #region Store
/**
 * Create the scheduler's local store: one state signal driven by the pure {@link reduce}, with
 * projections for each plan §5.4 signal. Any action that changes the draft commits it, so the host's
 * `onChange` sees every edit, undo and redo.
 */
export function createSchedulerStore(
	initial: Preset,
	engine: SchedulerEngine,
	options: SchedulerStoreOptions,
): SchedulerStore {
	const state = signal(initialState(initial, options));
	const today = options.today;
	let onChange = options.onChange;

	const draft = computed(() => state.value.draft);
	const focusMonth = computed(() => state.value.focusMonth);
	const weekStartsOn = state.peek().weekStartsOn;

	const commit = () => onChange?.(state.peek().draft);
	const dispatch = (action: SchedulerAction) => {
		const prev = state.peek();
		const next = reduce(prev, action);
		if (next === prev) return;
		state.value = next;
		if (next.draft !== prev.draft) commit();
	};

	return {
		engine,
		state,
		draft,
		history: computed(() => state.value.past),
		cursor: computed(() => state.value.cursor),
		selection: computed(() => state.value.selection),
		editing: computed(() => state.value.editing),
		layer: computed(() => state.value.layer),
		snap: computed(() => state.value.snap),
		view: computed(() => state.value.view),
		focusMonth,
		announcement: computed(() => ({
			text: state.value.announcement,
			seq: state.value.seq,
		})),
		canUndo: computed(() => state.value.past.length > 0),
		canRedo: computed(() => state.value.future.length > 0),
		occurrences: computed(() => {
			const dates = monthMatrix(focusMonth.value, weekStartsOn);
			return engine.evaluate(draft.value, { from: dates[0], to: dates[dates.length - 1] });
		}),
		issues: computed(() => engine.validate(draft.value, { today })),
		shortcutsOpen: signal(false),

		dispatch,
		createBand: (day, start, end) => dispatch({ type: "createBand", day, start, end }),
		moveBand: (sel, toDay, minutes) => dispatch({ type: "moveBand", ...sel, toDay, minutes }),
		resizeBand: (sel, edge, minutes) => dispatch({ type: "resizeBand", ...sel, edge, minutes }),
		duplicateBand: (sel, toDay) => dispatch({ type: "duplicateBand", ...sel, toDay }),
		deleteBand: (sel) => dispatch({ type: "deleteBand", ...sel }),
		upsertRule: (rule) => dispatch({ type: "upsertRule", rule }),
		deleteRule: (ruleId, name) => dispatch({ type: "deleteRule", ruleId, name }),
		setLayer: (layer) => dispatch({ type: "setLayer", layer }),
		undo: () => dispatch({ type: "undo" }),
		redo: () => dispatch({ type: "redo" }),
		loadTemplate: (template) => dispatch({ type: "loadTemplate", template }),
		commit,
		setOnChange: (fn) => {
			onChange = fn;
		},
	};
}
// #endregion
