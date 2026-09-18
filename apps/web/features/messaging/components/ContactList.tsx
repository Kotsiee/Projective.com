import type { JSX } from "preact";
import { useId } from "preact/hooks";
import "../styles/contact-picker.css";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { ContactSearch } from "../hooks/useContactSearch.ts";
import type { RankedContact } from "../types/messaging-types.ts";

/**
 * ContactList — the ranked people list every picker renders: a search field over the suggestions
 * grouped by tier ("Your teams & businesses" · "Follow each other" · "You follow" · "Worked
 * together" · "Recent conversations"), or a flat search result once the viewer types.
 *
 * Presentational and shared: {@link ContactPicker} (New message · New group · Add members) and the
 * share modal's "Send to…" section both render this over the same {@link useContactSearch} state,
 * so the two surfaces cannot drift in what they offer or how they order it. Selection is the
 * caller's (a controlled `selected` list + `onToggle`); this component only draws it.
 *
 * Every row states WHY it is offered (`reason`, the server's words) and WHEN the two last
 * interacted (`lastInteractionLabel`, pre-formatted) — the picker's job is to make the ranking
 * legible, not merely to apply it. A row with neither is a directory hit and says so by absence.
 */

// #region Props
export interface ContactListProps {
	search: ContactSearch;
	selected: readonly string[];
	onToggle: (id: string) => void;
	/** The search field's placeholder + accessible name. */
	placeholder?: string;
	/** The listbox's accessible name. */
	label?: string;
	/** What to say when the viewer has no suggestions at all (a brand-new account). */
	emptyNote?: string;
	/** Focus the search field on mount (a modal that opens on it). */
	autoFocus?: boolean;
}
// #endregion

const DEFAULT_EMPTY = "No suggestions yet. Search by name or @handle to find people on Projective.";

export function ContactList(props: ContactListProps): JSX.Element {
	const { search, selected, onToggle } = props;
	const listId = useId();
	const q = search.query.value;
	const on = new Set(selected);

	const rows = (contacts: readonly RankedContact[]) =>
		contacts.map((c) => {
			const picked = on.has(c.id);
			return (
				<button
					key={c.id}
					type="button"
					role="option"
					aria-selected={picked}
					class="msg-picker__row"
					data-on={picked ? "true" : undefined}
					data-tier={c.tier}
					onClick={() => onToggle(c.id)}
				>
					<Avatar image={c.avatar ?? undefined} label={c.name} size={34} shape="circle" />
					<span class="msg-picker__row-text">
						<span class="msg-picker__row-head">
							<span class="msg-picker__row-name">{c.name}</span>
							{c.handle && <span class="msg-picker__row-handle">@{c.handle}</span>}
						</span>
						{(c.reason ?? c.context) && (
							<span class="msg-picker__row-context">{c.reason ?? c.context}</span>
						)}
					</span>
					{c.lastInteractionLabel && (
						<span
							class="msg-picker__row-when"
							aria-label={`Last interaction ${c.lastInteractionLabel}`}
						>
							{c.lastInteractionLabel}
						</span>
					)}
					<span class="msg-picker__row-check" aria-hidden="true">
						{picked && <MessagingIcon name="check" />}
					</span>
				</button>
			);
		});

	let body: JSX.Element;
	if (search.error.value) {
		body = (
			<div class="msg-picker__failed" role="alert">
				<p class="msg-picker__failed-title">{search.error.value}</p>
				<Button
					label="Try again"
					variant="outlined"
					severity="secondary"
					size="sm"
					onClick={search.retry}
				/>
			</div>
		);
	} else if (search.loading.value && search.contacts.value.length === 0) {
		body = <p class="msg-picker__empty">Finding people…</p>;
	} else if (search.contacts.value.length === 0) {
		body = (
			<p class="msg-picker__empty">
				{search.searched.value
					? `No one matches “${q.trim()}”. Try a name or an @handle.`
					: props.emptyNote ?? DEFAULT_EMPTY}
			</p>
		);
	} else if (search.searched.value) {
		body = <>{rows(search.contacts.value)}</>;
	} else {
		body = (
			<>
				{search.groups.value.map((group) => (
					<div
						key={group.tier}
						class="msg-picker__group"
						role="group"
						aria-labelledby={`${listId}-${group.tier}`}
					>
						<h3 class="msg-picker__group-label" id={`${listId}-${group.tier}`}>
							{group.label}
						</h3>
						{rows(group.contacts)}
					</div>
				))}
			</>
		);
	}

	return (
		<div class="msg-picker__people">
			{/* Search — global by name or @handle; empty returns to the ranked suggestions. */}
			<div class="msg-picker__search">
				<span class="msg-picker__search-icon" aria-hidden="true">
					<MessagingIcon name="search" />
				</span>
				<input
					type="search"
					class="msg-picker__search-input"
					placeholder={props.placeholder ?? "Search by name or @handle"}
					value={q}
					aria-label={props.placeholder ?? "Search by name or @handle"}
					aria-controls={listId}
					autoComplete="off"
					autoFocus={props.autoFocus ? true : undefined}
					onInput={(e) => search.setQuery((e.target as HTMLInputElement).value)}
				/>
				{q && (
					<button
						type="button"
						class="msg-picker__clear"
						aria-label="Clear search"
						onClick={() => search.setQuery("")}
					>
						<MessagingIcon name="close" />
					</button>
				)}
			</div>

			{/* The list — grouped suggestions, or a flat search result. */}
			<div
				id={listId}
				class="msg-picker__list"
				role="listbox"
				aria-multiselectable="true"
				aria-label={props.label ?? "People"}
				aria-busy={search.loading.value ? "true" : undefined}
			>
				{body}
			</div>
		</div>
	);
}
