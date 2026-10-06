import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import {
	useDismiss,
	useFloating,
	useId,
	useListNavigation,
	useOverlayStack,
} from "@projective/ui/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import { styleVars } from "@ui/core/style.ts";
import type { RankedContact } from "@projective/types/messaging";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import {
	canAct,
	contactMeta,
	emailFromQuery,
	type PersonActionState,
} from "../core/people-picker.ts";

/**
 * UserSearchPopover — a search field whose matches open in an anchored listbox (Decision #145), the
 * WAI-ARIA combobox pattern: focus stays in the field, ArrowUp/ArrowDown move the active option,
 * Enter acts on it, Escape closes the list (and only the list — it owns Escape while it is the top
 * overlay, so a surrounding Dialog stays open).
 *
 * Typing is debounced (250 ms) into the same ranked read as the Quick Add rail
 * (`useContactSearch`), so known people come first and directory hits after. Choosing a row ACTS on
 * it — invite or send — in place; the list stays open so several people can be added in a row. An
 * email-shaped query adds one extra row for an address with no account, when `emailAction` is given.
 */

// #region Props
/** The optional row for a typed email address. */
export interface EmailAction {
	/** "Invite casey@studio.co by email". */
	label: (email: string) => string;
	stateOf: (email: string) => PersonActionState;
	onAct: (email: string) => void;
}

export interface UserSearchPopoverProps {
	/** The field's accessible name. */
	label: string;
	placeholder: string;
	/** The idle action shown on a row ("Invite", "Send"). */
	actionLabel: string;
	/** The settled action ("Invited", "Sent"). */
	doneLabel: string;
	/** The in-flight action ("Inviting…", "Sending…"). */
	busyLabel: string;
	/** Leave a contact out of the results (already a member). */
	hidden?: (person: RankedContact) => boolean;
	stateOf: (person: RankedContact) => PersonActionState;
	onAct: (person: RankedContact) => void;
	emailAction?: EmailAction;
}
// #endregion

/** One listbox row — a person, or the typed email address. */
type Row =
	| { kind: "person"; person: RankedContact; state: PersonActionState }
	| { kind: "email"; email: string; state: PersonActionState };

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 8;

export function UserSearchPopover(props: UserSearchPopoverProps): JSX.Element {
	const search = useContactSearch({
		loadOnMount: false,
		debounceMs: SEARCH_DEBOUNCE_MS,
		limit: RESULT_LIMIT,
	});
	const text = useSignal("");
	const focused = useSignal(false);
	const controlRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listId = useId(undefined, "people-search");

	const rows: Row[] = [];
	const email = props.emailAction ? emailFromQuery(text.value) : null;
	if (email && props.emailAction) {
		rows.push({ kind: "email", email, state: props.emailAction.stateOf(email) });
	}
	for (const person of search.contacts.value) {
		if (props.hidden?.(person)) continue;
		rows.push({ kind: "person", person, state: props.stateOf(person) });
	}

	const rowsRef = useRef<Row[]>([]);
	rowsRef.current = rows;
	const nav = useListNavigation(
		() => rowsRef.current.length,
		(i) => !canAct(rowsRef.current[i]?.state ?? "blocked"),
	);

	const open = focused.value && text.value.trim().length > 0;
	const stack = useOverlayStack({ active: open, layer: "popover" });
	const float = useFloating({
		open,
		triggerRef: controlRef,
		panelRef,
		placement: "bottom-start",
		matchWidth: true,
	});
	useDismiss({
		open,
		enabled: stack.isTop,
		onDismiss: () => {
			focused.value = false;
			nav.reset(-1);
		},
		panelRef,
		triggerRef: controlRef,
	});

	function onInput(e: JSX.TargetedEvent<HTMLInputElement>): void {
		const value = e.currentTarget.value;
		text.value = value;
		focused.value = true;
		nav.reset(-1);
		if (value.trim().length > 0) search.setQuery(value);
	}

	function act(row: Row): void {
		if (!canAct(row.state)) return;
		if (row.kind === "email") props.emailAction?.onAct(row.email);
		else props.onAct(row.person);
		inputRef.current?.focus();
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
		if (!open) {
			if ((e.key === "ArrowDown" || e.key === "ArrowUp") && text.value.trim()) {
				e.preventDefault();
				focused.value = true;
			}
			return;
		}
		if (nav.onKeyDown(e)) return;
		if (e.key === "Enter") {
			const row = rowsRef.current[nav.active.peek()];
			if (row) {
				e.preventDefault();
				act(row);
			}
		} else if (e.key === "Tab") {
			focused.value = false;
		}
	}

	const active = nav.active.value;
	const activeId = open && active >= 0 ? `${listId}-opt-${active}` : undefined;
	const q = text.value.trim();

	function status(): JSX.Element | null {
		if (rows.length > 0) return null;
		if (search.loading.value) {
			return <div class="people-search__note" role="status">Searching…</div>;
		}
		if (search.error.value) {
			return <div class="people-search__note" role="alert">{search.error.value}</div>;
		}
		return (
			<div class="people-search__note" role="status">
				No one matches “{q}”.{props.emailAction
					? " Enter a full email address to invite by email."
					: ""}
			</div>
		);
	}

	return (
		<div class="people-search">
			<div ref={controlRef} class="people-search__control" data-open={open ? "true" : undefined}>
				<span class="people-search__glyph" aria-hidden="true">
					<Icon name="search" size="sm" />
				</span>
				<input
					ref={inputRef}
					class="people-search__input"
					type="text"
					role="combobox"
					autoComplete="off"
					spellcheck={false}
					placeholder={props.placeholder}
					aria-label={props.label}
					aria-autocomplete="list"
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-controls={listId}
					aria-activedescendant={activeId}
					value={text.value}
					onInput={onInput}
					onKeyDown={onKeyDown}
					onFocus={() => (focused.value = true)}
				/>
			</div>

			{open && (
				<BodyPortal>
					<div
						ref={panelRef}
						class="people-search__panel"
						data-placement={float?.placement}
						style={styleVars({
							"--ps-top": float ? `${float.top}px` : undefined,
							"--ps-left": float ? `${float.left}px` : undefined,
							"--ps-width": float ? `${float.width}px` : undefined,
							"--ps-maxh": float?.availableHeight ? `${float.availableHeight}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						<div id={listId} role="listbox" aria-label={props.label} class="people-search__list">
							{rows.map((row, i) => {
								const settled = row.state === "done" || row.state === "blocked";
								const name = row.kind === "person" ? row.person.name : row.email;
								const meta = row.kind === "person" ? contactMeta(row.person) : "No account needed";
								const actionText = settled
									? props.doneLabel
									: row.state === "busy"
									? props.busyLabel
									: props.actionLabel;
								return (
									<div
										key={row.kind === "person" ? row.person.id : `email:${row.email}`}
										id={`${listId}-opt-${i}`}
										role="option"
										aria-selected={i === active}
										aria-disabled={!canAct(row.state) || undefined}
										aria-label={`${
											row.kind === "email" ? props.emailAction?.label(row.email) ?? name : name
										}${meta ? `, ${meta}` : ""} — ${actionText}`}
										class="people-search__option"
										data-active={i === active ? "true" : undefined}
										data-state={row.state}
										onPointerDown={(e) => {
											e.preventDefault();
											act(row);
										}}
										onPointerEnter={() => nav.reset(i)}
									>
										{row.kind === "person"
											? (
												<UserAvatar
													image={row.person.avatar ?? undefined}
													label={row.person.name}
													size={32}
													shape="circle"
												/>
											)
											: (
												<span class="people-search__mail" aria-hidden="true">
													<Icon name="mail" size="sm" />
												</span>
											)}
										<span class="people-search__text" aria-hidden="true">
											<span class="people-search__name">
												{row.kind === "email" ? props.emailAction?.label(row.email) ?? name : name}
											</span>
											{meta && <span class="people-search__meta">{meta}</span>}
										</span>
										<span class="people-search__act" aria-hidden="true">
											<Icon name={settled ? "check" : "plus"} size="sm" />
											{actionText}
										</span>
									</div>
								);
							})}
						</div>
						{status()}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
