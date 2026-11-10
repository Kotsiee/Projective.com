import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import { gridMove } from "../core/share-select.ts";

/**
 * ShareContactGrid — the "Send to…" picker's people (Decision #406): avatar cards in the server's
 * relationship order, each a `role="checkbox"` that a press toggles and never sends. A chosen card
 * takes a solid `--surface-2` fill and a check badge — the glyph, not the hue, carries the state —
 * and nothing about its size changes, so the grid never moves under the pointer. One Tab stop: the
 * arrows walk the cards (roving tabindex), Space or Enter toggles.
 */

// #region Props
export interface ShareContactGridProps {
	id: string;
	people: readonly RankedContact[];
	selected: readonly string[];
	onToggle: (person: RankedContact) => void;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	/** The search as typed, for the empty state. */
	query: string;
}
// #endregion

/** Cards per row — the grid's own `grid-template-columns`. */
const COLUMNS = 4;

export function ShareContactGrid(props: ShareContactGridProps): JSX.Element {
	const active = useSignal(0);
	const cells = useRef<Array<HTMLButtonElement | null>>([]);
	const count = props.people.length;
	const current = Math.min(active.value, Math.max(0, count - 1));

	function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void {
		const next = gridMove(index, event.key, count, COLUMNS);
		if (next === null) return;
		event.preventDefault();
		active.value = next;
		cells.current[next]?.focus();
	}

	if (count === 0) {
		return (
			<div class="share-grid share-grid--state" id={props.id}>
				{props.error
					? (
						<p class="share-grid__note" role="alert">
							{props.error}{" "}
							<Button variant="text" size="sm" label="Try again" onClick={props.onRetry} />
						</p>
					)
					: (
						<p class="share-grid__note" role="status">
							{props.loading
								? "Finding people…"
								: props.query.trim()
								? `No one matches “${props.query.trim()}”.`
								: "No suggestions yet — search by name or @handle."}
						</p>
					)}
			</div>
		);
	}

	return (
		<div
			class="share-grid"
			id={props.id}
			role="group"
			aria-label="Send to"
			aria-busy={props.loading}
		>
			{props.people.map((person, index) => {
				const on = props.selected.includes(person.id);
				return (
					<button
						key={person.id}
						ref={(el) => {
							cells.current[index] = el;
						}}
						type="button"
						role="checkbox"
						aria-checked={on}
						aria-label={person.handle ? `${person.name}, @${person.handle}` : person.name}
						class="share-grid__card"
						data-selected={on ? "true" : undefined}
						tabIndex={index === current ? 0 : -1}
						onFocus={() => (active.value = index)}
						onKeyDown={(event) => onKeyDown(event, index)}
						onClick={() => props.onToggle(person)}
					>
						<span class="share-grid__face">
							<UserAvatar
								image={person.avatar ?? undefined}
								label={person.name}
								shape="circle"
								class="share-grid__avatar"
							/>
							<span class="share-grid__check" aria-hidden="true">
								<Icon name="check" size="2xs" />
							</span>
						</span>
						<span class="share-grid__name" aria-hidden="true">{person.name}</span>
					</button>
				);
			})}
		</div>
	);
}
