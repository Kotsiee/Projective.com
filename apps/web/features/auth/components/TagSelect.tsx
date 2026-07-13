import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import type { Option } from "@projective/ui/fields";

/**
 * TagSelect — the tactile tag / skill picker used by the onboarding "purpose" and "skills" steps.
 *
 * It renders a cluster of pre-seeded, toggleable **pill** options as the primary affordance, with a
 * combobox beneath for adding *custom* tags via an auto-suggest dropdown (type → pick a suggestion or
 * add free text). A hard `max` cap gently disables further additions and surfaces a friendly notice
 * once reached. Selection lives in the shared wizard `Signal<string[]>`, so the summary passport and
 * validation observe it live. Signal-first, token-only, full combobox ARIA + keyboard.
 */
export interface TagSelectProps {
	/** Bound selection (option values and/or custom free-text tags). */
	value: Signal<string[]>;
	/** Pre-seeded suggestions shown as toggle pills. */
	options: readonly Option[];
	/** Maximum number of selected tags. */
	max: number;
	/** Placeholder for the combobox input. */
	placeholder?: string;
	/** Accessible label prefix for the input. */
	inputLabel?: string;
}

/** Label lookup for a value across the seeded options (falls back to the raw value for custom tags). */
function labelFor(options: readonly Option[], value: string): string {
	return options.find((o) => o.value === value)?.label ?? value;
}

export function TagSelect(
	{ value, options, max, placeholder, inputLabel = "Add a tag" }: TagSelectProps,
): JSX.Element {
	const query = useSignal("");
	const open = useSignal(false);
	const active = useSignal(-1);
	const inputRef = useRef<HTMLInputElement>(null);

	const selected = value.value;
	const atLimit = selected.length >= max;

	const isSelected = (v: string) => selected.includes(v);

	function toggle(v: string) {
		const cur = value.value;
		if (cur.includes(v)) {
			value.value = cur.filter((x) => x !== v);
		} else if (cur.length < max) {
			value.value = [...cur, v];
		}
	}

	function remove(v: string) {
		value.value = value.value.filter((x) => x !== v);
	}

	// #region Combobox suggestions
	const q = query.value.trim().toLowerCase();
	const suggestions = useMemo(() => {
		const pool = options.filter((o) =>
			!isSelected(o.value) && (q === "" || o.label.toLowerCase().includes(q))
		);
		const exact = options.some((o) => o.label.toLowerCase() === q) ||
			selected.some((s) => s.toLowerCase() === q);
		// Offer a "create" row when the query is novel free text.
		const rows: { value: string; label: string; create?: boolean }[] = pool.map((o) => ({
			value: o.value,
			label: o.label,
		}));
		if (q !== "" && !exact) {
			rows.unshift({ value: query.value.trim(), label: query.value.trim(), create: true });
		}
		return rows.slice(0, 8);
	}, [q, selected.length, options]);
	// #endregion

	function commit(v: string) {
		if (!v.trim() || atLimit) return;
		toggle(v.trim());
		query.value = "";
		active.value = -1;
		open.value = false;
		inputRef.current?.focus();
	}

	function onInput(e: JSX.TargetedEvent<HTMLInputElement>) {
		query.value = e.currentTarget.value;
		open.value = e.currentTarget.value.trim().length > 0;
		active.value = -1;
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			open.value = true;
			active.value = Math.min(active.value + 1, suggestions.length - 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			active.value = Math.max(active.value - 1, 0);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const pick = active.value >= 0 ? suggestions[active.value] : suggestions[0];
			if (pick) commit(pick.value);
		} else if (e.key === "Escape") {
			open.value = false;
			active.value = -1;
		} else if (e.key === "Backspace" && query.value === "" && selected.length > 0) {
			remove(selected[selected.length - 1]);
		}
	}

	const listId = "tagselect-list";

	return (
		<div class="tagselect">
			{/* Pre-seeded toggle pills — the primary, most tactile affordance. */}
			<div class="tagselect__cluster" role="group" aria-label="Suggested tags">
				{options.map((o) => {
					const on = isSelected(o.value);
					const locked = !on && atLimit;
					return (
						<button
							key={o.value}
							type="button"
							class={`tagselect__pill${on ? " is-on" : ""}`}
							aria-pressed={on}
							disabled={locked}
							onClick={() => toggle(o.value)}
						>
							<span class="tagselect__pill-dot" aria-hidden="true" />
							{o.label}
						</button>
					);
				})}
			</div>

			{/* Custom tags the user added that aren't in the seeded pool. */}
			{selected.some((v) => !options.some((o) => o.value === v))
				? (
					<div class="tagselect__custom" aria-label="Your tags">
						{selected.filter((v) => !options.some((o) => o.value === v)).map((v) => (
							<span key={v} class="tagselect__chip pop">
								{labelFor(options, v)}
								<button
									type="button"
									class="tagselect__chip-x"
									aria-label={`Remove ${v}`}
									onClick={() =>
										remove(v)}
								>
									<span aria-hidden="true">×</span>
								</button>
							</span>
						))}
					</div>
				)
				: null}

			{/* Combobox adder */}
			<div class="tagselect__combo">
				<div class={`tagselect__input-wrap${atLimit ? " is-disabled" : ""}`}>
					<input
						ref={inputRef}
						type="text"
						class="tagselect__input"
						role="combobox"
						aria-expanded={open.value && suggestions.length > 0}
						aria-controls={listId}
						aria-autocomplete="list"
						aria-label={inputLabel}
						placeholder={atLimit ? "Limit reached" : (placeholder ?? "Type to add…")}
						value={query.value}
						disabled={atLimit}
						autoComplete="off"
						onInput={onInput}
						onKeyDown={onKeyDown}
						onFocus={() => (open.value = query.value.trim().length > 0)}
						onBlur={() => setTimeout(() => (open.value = false), 120)}
					/>
					<span class="tagselect__count" aria-live="polite">{selected.length}/{max}</span>
				</div>

				{open.value && suggestions.length > 0 && !atLimit
					? (
						<ul id={listId} class="tagselect__menu" role="listbox">
							{suggestions.map((s, i) => (
								<li
									key={`${s.create ? "new:" : ""}${s.value}`}
									role="option"
									aria-selected={i === active.value}
									class={`tagselect__opt${i === active.value ? " is-active" : ""}`}
									onPointerDown={(e) => {
										e.preventDefault();
										commit(s.value);
									}}
									onPointerEnter={() => (active.value = i)}
								>
									{s.create
										? (
											<>
												<span class="tagselect__opt-add" aria-hidden="true">+</span>
												Add “{s.label}”
											</>
										)
										: s.label}
								</li>
							))}
						</ul>
					)
					: null}
			</div>

			{atLimit
				? (
					<p class="tagselect__note" role="status">
						That's the max of {max} — remove one to swap it out.
					</p>
				)
				: null}
		</div>
	);
}
