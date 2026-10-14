/**
 * @projective/ui/fields — TagCombobox's pure state machine (ARIA 1.2 combobox over a tag list).
 *
 * Every key and pointer intent is an action; the reducer answers the next state and whether the
 * island should `preventDefault`. Enter or comma commits the active suggestion, else the typed text;
 * Backspace on an empty query removes the last tag; ↑/↓ move the active suggestion (wrapping); Escape
 * closes the list, then clears the query. Tags are trimmed, single-spaced, de-duplicated without
 * regard to case, capped at `maxLength` characters and at `max` tags.
 */

// #region Shapes
/** The combobox's whole state. */
export interface TagComboState {
	tags: string[];
	query: string;
	/** Suggestions for the current query, already excluding committed tags. */
	options: string[];
	/** The active suggestion, `-1` for none. */
	active: number;
	open: boolean;
	max: number;
	maxLength: number;
	/** The last thing worth announcing ("Added design", "You can add up to 10 tags"). */
	notice: string;
}

/** Everything that can happen to it. */
export type TagComboAction =
	| { type: "input"; value: string }
	| { type: "options"; options: readonly string[] }
	| { type: "key"; key: string }
	| { type: "pick"; index: number }
	| { type: "remove"; index: number }
	| { type: "close" };

/** A reduction: the next state and whether the triggering event is consumed. */
export interface TagComboResult {
	state: TagComboState;
	handled: boolean;
}
// #endregion

// #region Helpers
/** A tag as stored: trimmed, single-spaced, no stray commas, at most `maxLength` characters. */
export function normaliseTag(raw: string, maxLength: number): string {
	return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

/** Whether `tag` is already in `tags`, ignoring case. */
export function hasTag(tags: readonly string[], tag: string): boolean {
	const k = tag.toLocaleLowerCase();
	return tags.some((t) => t.toLocaleLowerCase() === k);
}

/** A fresh state. */
export function initialTagCombo(
	tags: readonly string[],
	max: number,
	maxLength = 40,
): TagComboState {
	return {
		tags: [...tags],
		query: "",
		options: [],
		active: -1,
		open: false,
		max,
		maxLength,
		notice: "",
	};
}

/** The inline count ("7 of 10"). */
export function tagCount(state: Pick<TagComboState, "tags" | "max">): string {
	return `${state.tags.length} of ${state.max}`;
}

function commit(state: TagComboState, raw: string): TagComboState {
	const tag = normaliseTag(raw, state.maxLength);
	if (tag === "") return { ...state, query: "", open: false, active: -1 };
	if (state.tags.length >= state.max) {
		return { ...state, notice: `You can add up to ${state.max} tags.` };
	}
	if (hasTag(state.tags, tag)) {
		return { ...state, query: "", open: false, active: -1, notice: `${tag} is already added.` };
	}
	return {
		...state,
		tags: [...state.tags, tag],
		query: "",
		options: [],
		open: false,
		active: -1,
		notice: `Added ${tag}.`,
	};
}
// #endregion

// #region Reducer
/** Reduce one action. */
export function reduceTagCombo(state: TagComboState, action: TagComboAction): TagComboResult {
	switch (action.type) {
		case "input": {
			const value = action.value;
			if (value.includes(",")) {
				const [head] = value.split(",");
				return { state: commit({ ...state, query: head }, head), handled: true };
			}
			return {
				state: {
					...state,
					query: value,
					active: -1,
					open: value.trim() !== "" && state.options.length > 0,
					notice: "",
				},
				handled: false,
			};
		}
		case "options": {
			const options = action.options.filter((o) => !hasTag(state.tags, o));
			return {
				state: {
					...state,
					options,
					active: -1,
					open: state.query.trim() !== "" && options.length > 0,
				},
				handled: false,
			};
		}
		case "pick": {
			const option = state.options[action.index];
			return option === undefined
				? { state, handled: false }
				: { state: commit(state, option), handled: true };
		}
		case "remove": {
			const removed = state.tags[action.index];
			if (removed === undefined) return { state, handled: false };
			return {
				state: {
					...state,
					tags: state.tags.filter((_, i) => i !== action.index),
					notice: `Removed ${removed}.`,
				},
				handled: true,
			};
		}
		case "close":
			return { state: { ...state, open: false, active: -1 }, handled: false };
		case "key":
			return reduceKey(state, action.key);
	}
}

function reduceKey(state: TagComboState, key: string): TagComboResult {
	const n = state.options.length;
	switch (key) {
		case "ArrowDown":
		case "ArrowUp": {
			if (n === 0) return { state, handled: false };
			const step = key === "ArrowDown" ? 1 : -1;
			const from = state.open ? state.active : -1;
			const active = from < 0 ? (step === 1 ? 0 : n - 1) : (from + step + n) % n;
			return { state: { ...state, open: true, active }, handled: true };
		}
		case "Enter":
		case ",": {
			const option = state.open && state.active >= 0 ? state.options[state.active] : undefined;
			if (option !== undefined) return { state: commit(state, option), handled: true };
			if (state.query.trim() === "") return { state, handled: key === "," };
			return { state: commit(state, state.query), handled: true };
		}
		case "Backspace": {
			if (state.query !== "" || state.tags.length === 0) return { state, handled: false };
			const removed = state.tags[state.tags.length - 1];
			return {
				state: { ...state, tags: state.tags.slice(0, -1), notice: `Removed ${removed}.` },
				handled: true,
			};
		}
		case "Escape": {
			if (state.open) return { state: { ...state, open: false, active: -1 }, handled: true };
			if (state.query !== "") return { state: { ...state, query: "", options: [] }, handled: true };
			return { state, handled: false };
		}
		case "Tab":
			return { state: { ...state, open: false, active: -1 }, handled: false };
		default:
			return { state, handled: false };
	}
}
// #endregion
