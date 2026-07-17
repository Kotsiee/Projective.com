import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { JSX } from "preact";
import { CloseIcon } from "./glyphs.tsx";
import type { ScopeOption } from "../types/projects-types.ts";

/**
 * WorkspaceCombo — the filter popover's workspace/team tag-combo. A clean text input filters the
 * actor's workspaces; confirming one appends a mini removable text tag (no bulky chips) and narrows
 * the feed to the union of the chosen workspaces. Backspace on an empty field peels the last tag;
 * Enter confirms the top match. Selected tags read as subtle text with a hairline, not filled pills.
 */

export interface WorkspaceComboProps {
	scopes: readonly ScopeOption[];
	/** Currently-selected workspace ids. */
	selected: readonly string[];
	onChange: (ids: string[]) => void;
}

export function WorkspaceCombo({ scopes, selected, onChange }: WorkspaceComboProps): JSX.Element {
	const query = useSignal("");
	const open = useSignal(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const chosen = scopes.filter((s) => selected.includes(s.id));
	const q = query.value.trim().toLowerCase();
	const matches = scopes.filter(
		(s) => !selected.includes(s.id) && (!q || s.label.toLowerCase().includes(q)),
	);

	function add(id: string): void {
		if (selected.includes(id)) return;
		onChange([...selected, id]);
		query.value = "";
		inputRef.current?.focus();
	}

	function remove(id: string): void {
		onChange(selected.filter((s) => s !== id));
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Enter" && matches.length > 0) {
			e.preventDefault();
			add(matches[0].id);
		} else if (e.key === "Backspace" && query.value === "" && chosen.length > 0) {
			remove(chosen[chosen.length - 1].id);
		} else if (e.key === "Escape") {
			open.value = false;
		}
	}

	return (
		<div class="proj-combo">
			<div class="proj-combo__field">
				{chosen.map((s) => (
					<span key={s.id} class="proj-combo__tag">
						{s.label}
						<button
							type="button"
							class="proj-combo__tag-x"
							aria-label={`Remove ${s.label}`}
							onClick={() => remove(s.id)}
						>
							{CloseIcon}
						</button>
					</span>
				))}
				<input
					ref={inputRef}
					class="proj-combo__input"
					type="text"
					placeholder={chosen.length ? "Add another…" : "All active workspaces"}
					aria-label="Filter by workspace or team"
					value={query.value}
					onInput={(e) => {
						query.value = (e.target as HTMLInputElement).value;
						open.value = true;
					}}
					onFocus={() => (open.value = true)}
					onKeyDown={onKeyDown}
				/>
			</div>

			{open.value && matches.length > 0 && (
				<ul class="proj-combo__menu" role="listbox" aria-label="Workspaces">
					{matches.map((s) => (
						<li key={s.id} role="option" aria-selected={false}>
							<button
								type="button"
								class="proj-combo__option"
								onClick={() => add(s.id)}
							>
								<span class="proj-combo__option-label">{s.label}</span>
								<span class="proj-combo__option-count">{s.count}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
