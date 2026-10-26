import {
	announceCreated,
	announceDeleted,
	announceDuplicated,
	announceMoved,
	announceOvernight,
	announceResized,
	monthName,
} from "./announce.ts";
import { addMonths, clamp, DAY_MINUTES, monthOf, snapTo, startOfWeek, weekdayOf } from "./civil.ts";
import type {
	Band,
	Layer,
	Preset,
	RuleDraft,
	SchedulerTemplate,
	SchedulerView,
	Snap,
	Weekday,
} from "./types.ts";

// #region State
/** Undo depth (plan §5.4). */
export const HISTORY_DEPTH = 50;
/** Bands one rule may carry. */
export const MAX_BANDS = 6;
/** Rules one preset may carry. */
export const MAX_RULES = 64;

/** The keyboard cursor on the week canvas. */
export interface Cursor {
	day: Weekday;
	minute: number;
}

/** The selected band, and the day column it was selected on. */
export interface Selection {
	ruleId: string;
	bandIndex: number;
	day: Weekday;
}

/** Everything the scheduler knows. Pure data, so the reducer stays testable. */
export interface SchedulerState {
	draft: Preset;
	past: Preset[];
	future: Preset[];
	cursor: Cursor;
	selection: Selection | null;
	/** The rule open in the RuleEditor. */
	editing: string | null;
	layer: Layer;
	snap: Snap;
	view: SchedulerView;
	/** `YYYY-MM`. */
	focusMonth: string;
	today: string;
	weekStartsOn: number;
	locale: string;
	announcement: string;
	/** Bumped on every announcement (re-keys the live region) and on every minted id. */
	seq: number;
}

/** Inputs to {@link initialState} beyond the preset. */
export interface InitialStateOptions {
	today: string;
	weekStartsOn?: number;
	locale?: string;
}

/** A fresh state around `draft`. */
export function initialState(draft: Preset, options: InitialStateOptions): SchedulerState {
	return {
		draft,
		past: [],
		future: [],
		cursor: { day: weekdayOf(options.today), minute: 9 * 60 },
		selection: null,
		editing: null,
		layer: "working_hours",
		snap: 15,
		view: "week",
		focusMonth: monthOf(options.today),
		today: options.today,
		weekStartsOn: options.weekStartsOn ?? 1,
		locale: options.locale ?? "en-GB",
		announcement: "",
		seq: 0,
	};
}
// #endregion

// #region Actions
/** Every transition the scheduler makes. Deltas are minutes; days are weekdays (0 = Sunday). */
export type SchedulerAction =
	| { type: "createBand"; day: Weekday; start: number; end: number }
	| {
		type: "moveBand";
		ruleId: string;
		bandIndex: number;
		day: Weekday;
		toDay: Weekday;
		minutes: number;
	}
	| {
		type: "resizeBand";
		ruleId: string;
		bandIndex: number;
		day: Weekday;
		edge: "start" | "end";
		minutes: number;
	}
	| { type: "duplicateBand"; ruleId: string; bandIndex: number; day: Weekday; toDay: Weekday }
	| { type: "deleteBand"; ruleId: string; bandIndex: number; day: Weekday }
	| { type: "addRule" }
	| { type: "upsertRule"; rule: RuleDraft }
	| { type: "deleteRule"; ruleId: string; name?: string }
	| { type: "setDetails"; name?: string; isDefault?: boolean }
	| { type: "setLayer"; layer: Layer }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "loadTemplate"; template: SchedulerTemplate }
	| { type: "reset"; preset: Preset }
	| { type: "setCursor"; cursor: Cursor }
	| { type: "moveCursor"; toDay: Weekday; minutes: number }
	| { type: "select"; selection: Selection | null }
	| { type: "edit"; ruleId: string | null }
	| { type: "setSnap"; snap: Snap }
	| { type: "setView"; view: SchedulerView }
	| { type: "shiftMonth"; months: number }
	| { type: "setMonth"; month: string };
// #endregion

// #region Band algebra
/** Sort bands and merge any that overlap or touch. */
export function normaliseBands(bands: readonly Band[]): Band[] {
	const out: Band[] = [];
	for (const b of [...bands].sort((x, y) => x.start - y.start)) {
		const last = out[out.length - 1];
		if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
		else out.push({ start: b.start, end: b.end });
	}
	return out;
}

function indexHolding(bands: readonly Band[], minute: number): number {
	const i = bands.findIndex((b) => b.start <= minute && minute < b.end);
	return i < 0 ? 0 : i;
}

/** True when `rule` is drawn on the week canvas: an active weekly `add` rule. */
export function isCanvasRule(rule: RuleDraft): boolean {
	return rule.active && rule.effect === "add" && rule.pattern.type === "weekly";
}

/** One band as the week canvas draws it. */
export interface CanvasBand {
	rule: RuleDraft;
	bandIndex: number;
	band: Band;
}

/** Every canvas band on `day`, working hours first. */
export function bandsOnDay(draft: Preset, day: number): CanvasBand[] {
	const out: CanvasBand[] = [];
	for (const layer of ["working_hours", "call_window"] as const) {
		for (const rule of draft.rules) {
			if (rule.layer !== layer || !isCanvasRule(rule)) continue;
			if (rule.pattern.type !== "weekly" || !rule.pattern.days.includes(day)) continue;
			rule.bands.forEach((band, bandIndex) => out.push({ rule, bandIndex, band }));
		}
	}
	return out;
}

/** The canvas band under the cursor, preferring the active layer. */
export function bandAt(state: SchedulerState, day: number, minute: number): CanvasBand | null {
	const hits = bandsOnDay(state.draft, day).filter((c) =>
		c.band.start <= minute && minute < c.band.end
	);
	return hits.find((c) => c.rule.layer === state.layer) ?? hits[0] ?? null;
}
// #endregion

// #region Helpers
function mintId(state: SchedulerState, rules: readonly RuleDraft[]): [string, number] {
	let seq = state.seq;
	let id: string;
	do {
		seq += 1;
		id = `rule-${seq}`;
	} while (rules.some((r) => r.id === id));
	return [id, seq];
}

function weeklyRule(
	id: string,
	layer: Layer,
	days: number[],
	bands: Band[],
	startsOn: string,
): RuleDraft {
	return {
		id,
		layer,
		effect: "add",
		pattern: { type: "weekly", days: [...days].sort((a, b) => a - b), interval: 1 },
		condition: { unlessWeekdays: [] },
		bands,
		startsOn,
		endsOn: null,
		priority: 50,
		label: "",
		active: true,
	};
}

function withDraft(state: SchedulerState, draft: Preset): SchedulerState {
	if (draft === state.draft) return state;
	return {
		...state,
		draft,
		past: [...state.past, state.draft].slice(-HISTORY_DEPTH),
		future: [],
	};
}

function say(state: SchedulerState, announcement: string): SchedulerState {
	return { ...state, announcement, seq: state.seq + 1 };
}

function findRule(state: SchedulerState, ruleId: string): RuleDraft | undefined {
	return state.draft.rules.find((r) => r.id === ruleId);
}

function replaceRule(draft: Preset, rule: RuleDraft): Preset {
	return { ...draft, rules: draft.rules.map((r) => r.id === rule.id ? rule : r) };
}

interface Placed {
	draft: Preset;
	ruleId: string;
	bandIndex: number;
	seq: number;
}

function placeBand(
	state: SchedulerState,
	draft: Preset,
	seq: number,
	layer: Layer,
	day: Weekday,
	band: Band,
): Placed | null {
	for (const rule of draft.rules) {
		if (rule.layer !== layer || !isCanvasRule(rule)) continue;
		if (rule.pattern.type !== "weekly" || !rule.pattern.days.includes(day)) continue;
		const bands = normaliseBands([...rule.bands, band]);
		if (bands.length > MAX_BANDS) continue;
		return {
			draft: replaceRule(draft, { ...rule, bands }),
			ruleId: rule.id,
			bandIndex: indexHolding(bands, band.start),
			seq,
		};
	}
	if (draft.rules.length >= MAX_RULES) return null;
	const [id, next] = mintId({ ...state, seq }, draft.rules);
	const rule = weeklyRule(id, layer, [day], [band], startOfWeek(state.today, state.weekStartsOn));
	return {
		draft: { ...draft, rules: [...draft.rules, rule] },
		ruleId: id,
		bandIndex: 0,
		seq: next,
	};
}

function selectionOk(state: SchedulerState): SchedulerState {
	const sel = state.selection;
	const rule = sel ? findRule(state, sel.ruleId) : undefined;
	const keepSel = sel && rule && sel.bandIndex < rule.bands.length;
	const keepEdit = state.editing && findRule(state, state.editing);
	return {
		...state,
		selection: keepSel ? sel : null,
		editing: keepEdit ? state.editing : null,
	};
}

const RULE_CAP = `A preset holds at most ${MAX_RULES} rules.`;
// #endregion

// #region Band actions
function createBand(
	state: SchedulerState,
	day: Weekday,
	rawStart: number,
	rawEnd: number,
): SchedulerState {
	const start = clamp(snapTo(rawStart, state.snap), 0, DAY_MINUTES - state.snap);
	let end = snapTo(rawEnd, state.snap);
	if (end <= start) end += DAY_MINUTES;
	end = clamp(end, start + state.snap, start + DAY_MINUTES);
	const layer = state.layer;

	const first = placeBand(state, state.draft, state.seq, layer, day, {
		start,
		end: Math.min(end, DAY_MINUTES),
	});
	if (!first) return say(state, RULE_CAP);
	let { draft, seq } = first;
	let text = announceCreated(day, { start, end: Math.min(end, DAY_MINUTES) }, layer, state.locale);

	if (end > DAY_MINUTES) {
		const nextDay = ((day + 1) % 7) as Weekday;
		const second = placeBand(state, draft, seq, layer, nextDay, {
			start: 0,
			end: end - DAY_MINUTES,
		});
		if (!second) return say(state, RULE_CAP);
		({ draft, seq } = second);
		text = announceOvernight(day, start, nextDay, end - DAY_MINUTES, layer, state.locale);
	}

	const owner = draft.rules.find((r) => r.id === first.ruleId);
	const bandIndex = owner ? indexHolding(owner.bands, start) : first.bandIndex;
	const next = withDraft(state, draft);
	return say({
		...next,
		seq,
		selection: { ruleId: first.ruleId, bandIndex, day },
		cursor: { day, minute: start },
	}, text);
}

function moveBand(
	state: SchedulerState,
	a: Extract<SchedulerAction, { type: "moveBand" }>,
): SchedulerState {
	const rule = findRule(state, a.ruleId);
	const band = rule?.bands[a.bandIndex];
	if (!rule || !band || rule.pattern.type !== "weekly") return state;
	const length = band.end - band.start;
	const start = clamp(band.start + a.minutes, 0, DAY_MINUTES - length);
	const moved: Band = { start, end: start + length };
	const shift = (a.toDay - a.day + 7) % 7;

	if (shift === 0) {
		const bands = normaliseBands(rule.bands.map((b, i) => i === a.bandIndex ? moved : b));
		const next = withDraft(state, replaceRule(state.draft, { ...rule, bands }));
		const bandIndex = indexHolding(bands, moved.start);
		return say({
			...next,
			selection: { ruleId: rule.id, bandIndex, day: a.day },
			cursor: { day: a.day, minute: moved.start },
		}, announceMoved(a.day, bands[bandIndex], state.locale));
	}

	const days = rule.pattern.days.map((d) => (d + shift) % 7).sort((x, y) => x - y);
	if (rule.bands.length === 1) {
		const shifted: RuleDraft = {
			...rule,
			pattern: { ...rule.pattern, days },
			bands: [moved],
		};
		const next = withDraft(state, replaceRule(state.draft, shifted));
		return say({
			...next,
			selection: { ruleId: rule.id, bandIndex: 0, day: a.toDay },
			cursor: { day: a.toDay, minute: moved.start },
		}, announceMoved(a.toDay, moved, state.locale));
	}

	if (state.draft.rules.length >= MAX_RULES) return say(state, RULE_CAP);
	const [id, seq] = mintId(state, state.draft.rules);
	const fork: RuleDraft = {
		...rule,
		id,
		label: "",
		pattern: { ...rule.pattern, days },
		bands: [moved],
	};
	const rest: RuleDraft = { ...rule, bands: rule.bands.filter((_, i) => i !== a.bandIndex) };
	const draft = { ...state.draft, rules: [...replaceRule(state.draft, rest).rules, fork] };
	const next = withDraft(state, draft);
	return say({
		...next,
		seq,
		selection: { ruleId: id, bandIndex: 0, day: a.toDay },
		cursor: { day: a.toDay, minute: moved.start },
	}, announceMoved(a.toDay, moved, state.locale));
}

function resizeBand(
	state: SchedulerState,
	a: Extract<SchedulerAction, { type: "resizeBand" }>,
): SchedulerState {
	const rule = findRule(state, a.ruleId);
	const band = rule?.bands[a.bandIndex];
	if (!rule || !band) return state;
	const resized: Band = a.edge === "start"
		? { start: clamp(band.start + a.minutes, 0, band.end - state.snap), end: band.end }
		: { start: band.start, end: clamp(band.end + a.minutes, band.start + state.snap, DAY_MINUTES) };
	if (resized.start === band.start && resized.end === band.end) return state;
	const bands = normaliseBands(rule.bands.map((b, i) => i === a.bandIndex ? resized : b));
	const next = withDraft(state, replaceRule(state.draft, { ...rule, bands }));
	const bandIndex = indexHolding(bands, resized.start);
	return say({
		...next,
		selection: { ruleId: rule.id, bandIndex, day: a.day },
		cursor: { day: a.day, minute: a.edge === "start" ? resized.start : resized.end - state.snap },
	}, announceResized(a.day, bands[bandIndex], state.locale));
}

function duplicateBand(
	state: SchedulerState,
	a: Extract<SchedulerAction, { type: "duplicateBand" }>,
): SchedulerState {
	const rule = findRule(state, a.ruleId);
	const band = rule?.bands[a.bandIndex];
	if (!rule || !band) return state;
	const placed = placeBand(state, state.draft, state.seq, rule.layer, a.toDay, band);
	if (!placed) return say(state, RULE_CAP);
	const next = withDraft(state, placed.draft);
	return say({
		...next,
		seq: placed.seq,
		selection: { ruleId: placed.ruleId, bandIndex: placed.bandIndex, day: a.toDay },
		cursor: { day: a.toDay, minute: band.start },
	}, announceDuplicated(a.toDay, band, state.locale));
}

function deleteBand(
	state: SchedulerState,
	a: Extract<SchedulerAction, { type: "deleteBand" }>,
): SchedulerState {
	const rule = findRule(state, a.ruleId);
	const band = rule?.bands[a.bandIndex];
	if (!rule || !band) return state;
	const bands = rule.bands.filter((_, i) => i !== a.bandIndex);
	const removeRule = bands.length === 0 && rule.effect === "add";
	const draft = removeRule
		? { ...state.draft, rules: state.draft.rules.filter((r) => r.id !== rule.id) }
		: replaceRule(state.draft, { ...rule, bands });
	const next = withDraft(state, draft);
	return say(
		{
			...next,
			selection: null,
			editing: removeRule && state.editing === rule.id ? null : state.editing,
		},
		announceDeleted(a.day, band, rule.layer, removeRule, state.locale),
	);
}
// #endregion

// #region Rule + history actions
function loadTemplate(state: SchedulerState, template: SchedulerTemplate): SchedulerState {
	const anchor = startOfWeek(state.today, 1);
	let seq = state.seq;
	const rules: RuleDraft[] = [];
	for (const source of template.rules.slice(0, MAX_RULES)) {
		const [id, next] = mintId({ ...state, seq }, [...state.draft.rules, ...rules]);
		seq = next;
		rules.push({
			...source,
			id,
			pattern: structuredClone(source.pattern),
			condition: { unlessWeekdays: [...source.condition.unlessWeekdays] },
			bands: source.bands.map((b) => ({ ...b })),
			startsOn: source.pattern.type === "once" ? source.pattern.date : anchor,
		});
	}
	const next = withDraft(state, { ...state.draft, rules });
	return say({ ...next, seq, selection: null, editing: null }, `Loaded ${template.name}.`);
}

function travel(state: SchedulerState, dir: "undo" | "redo"): SchedulerState {
	const from = dir === "undo" ? state.past : state.future;
	if (!from.length) return say(state, dir === "undo" ? "Nothing to undo." : "Nothing to redo.");
	const draft = from[from.length - 1];
	const rest = from.slice(0, -1);
	const moved = dir === "undo"
		? { past: rest, future: [...state.future, state.draft] }
		: { past: [...state.past, state.draft].slice(-HISTORY_DEPTH), future: rest };
	return say(selectionOk({ ...state, ...moved, draft }), dir === "undo" ? "Undone." : "Redone.");
}
// #endregion

// #region Reducer
/**
 * The scheduler's pure transition function. Edits that change the preset push the previous one onto
 * the undo stack (depth {@link HISTORY_DEPTH}) and clear redo; view-only actions do not. Returns
 * `state` itself when nothing changes.
 */
export function reduce(state: SchedulerState, action: SchedulerAction): SchedulerState {
	switch (action.type) {
		case "createBand":
			return createBand(state, action.day, action.start, action.end);
		case "moveBand":
			return moveBand(state, action);
		case "resizeBand":
			return resizeBand(state, action);
		case "duplicateBand":
			return duplicateBand(state, action);
		case "deleteBand":
			return deleteBand(state, action);
		case "addRule": {
			if (state.draft.rules.length >= MAX_RULES) return say(state, RULE_CAP);
			const [id, seq] = mintId(state, state.draft.rules);
			const rule = weeklyRule(
				id,
				state.layer,
				[state.cursor.day],
				[{ start: 9 * 60, end: 17 * 60 }],
				startOfWeek(state.today, state.weekStartsOn),
			);
			const next = withDraft(state, { ...state.draft, rules: [...state.draft.rules, rule] });
			return say({ ...next, seq, editing: id }, "Added a rule; it is open in the editor.");
		}
		case "upsertRule": {
			const exists = state.draft.rules.some((r) => r.id === action.rule.id);
			if (!exists && state.draft.rules.length >= MAX_RULES) return say(state, RULE_CAP);
			const rules = exists
				? state.draft.rules.map((r) => r.id === action.rule.id ? action.rule : r)
				: [...state.draft.rules, action.rule];
			return selectionOk(withDraft(state, { ...state.draft, rules }));
		}
		case "deleteRule": {
			if (!findRule(state, action.ruleId)) return state;
			const rules = state.draft.rules.filter((r) => r.id !== action.ruleId);
			const next = selectionOk(withDraft(state, { ...state.draft, rules }));
			return say(next, `Deleted ${action.name ? `rule “${action.name}”` : "the rule"}.`);
		}
		case "setDetails": {
			const name = action.name ?? state.draft.name;
			const isDefault = action.isDefault ?? state.draft.isDefault;
			if (name === state.draft.name && isDefault === state.draft.isDefault) return state;
			return withDraft(state, { ...state.draft, name, isDefault });
		}
		case "setLayer":
			if (state.layer === action.layer) return state;
			return say(
				{ ...state, layer: action.layer },
				action.layer === "working_hours" ? "Editing working hours." : "Editing call windows.",
			);
		case "undo":
		case "redo":
			return travel(state, action.type);
		case "loadTemplate":
			return loadTemplate(state, action.template);
		case "reset":
			return selectionOk({ ...state, draft: action.preset, past: [], future: [] });
		case "setCursor":
			return { ...state, cursor: action.cursor };
		case "moveCursor": {
			const minute = clamp(state.cursor.minute + action.minutes, 0, DAY_MINUTES - state.snap);
			const cursor = { day: action.toDay, minute };
			const hit = bandAt(state, cursor.day, cursor.minute);
			return {
				...state,
				cursor,
				selection: hit ? { ruleId: hit.rule.id, bandIndex: hit.bandIndex, day: cursor.day } : null,
			};
		}
		case "select":
			return { ...state, selection: action.selection };
		case "edit":
			return { ...state, editing: action.ruleId };
		case "setSnap":
			return { ...state, snap: action.snap };
		case "setView":
			return { ...state, view: action.view };
		case "shiftMonth": {
			const focusMonth = addMonths(state.focusMonth, action.months);
			return say({ ...state, focusMonth }, `${monthName(focusMonth, state.locale)}.`);
		}
		case "setMonth":
			return { ...state, focusMonth: action.month };
	}
}
// #endregion
