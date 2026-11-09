import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
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
import type { AccessTarget, GranteeKind } from "@projective/types/files";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { FilesService } from "@features/files/core/FilesService.ts";
import { contactMeta } from "@features/share/core/people-picker.ts";
import type { DraftGrant } from "../../core/access-draft.ts";

/** Props for {@link GranteePicker}. */
export interface GranteePickerProps {
	/** Whether a grantee is already in the draft. */
	isAdded: (grantee: { kind: GranteeKind; id: string }) => boolean;
	onAdd: (grantee: Omit<DraftGrant, "role">) => void;
	onRemove: (grantee: { kind: GranteeKind; id: string }) => void;
	/** People never offered: the file's owner, who always has access. */
	excludeIds: readonly string[];
	disabled: boolean;
	/** Said under the field while it is disabled. */
	disabledReason: string | null;
}

type Group = "people" | "entities" | "projects";

interface PickRow extends Omit<DraftGrant, "role"> {
	group: Group;
}

const GROUP_LABEL: Readonly<Record<Group, string>> = {
	people: "People",
	entities: "Your teams & businesses",
	projects: "Your projects",
};

const SEARCH_DEBOUNCE_MS = 250;
const PEOPLE_LIMIT = 8;

function targetRow(target: AccessTarget): PickRow {
	return {
		kind: target.kind,
		id: target.id,
		name: target.name,
		detail: target.detail,
		avatar: target.avatar,
		group: target.kind === "project" ? "projects" : "entities",
	};
}

/**
 * GranteePicker — one search field for everyone a file can be shared with: people (the ranked search
 * the share modal uses), and the teams, businesses and projects the viewer belongs to. Focused empty,
 * it lists the viewer's own teams and projects; typing narrows both and adds people. Picking toggles a
 * grantee in or out of the draft at Can view, and the list stays open so several can be added in a row
 * (the WAI-ARIA multi-select combobox: focus stays in the field, arrows move, Enter toggles).
 */
export function GranteePicker(props: GranteePickerProps): JSX.Element {
	const people = useContactSearch({
		loadOnMount: false,
		debounceMs: SEARCH_DEBOUNCE_MS,
		limit: PEOPLE_LIMIT,
	});
	const text = useSignal("");
	const focused = useSignal(false);
	const targets = useSignal<AccessTarget[]>([]);
	const targetsAsked = useSignal(false);
	const targetsLoading = useSignal(false);
	const targetsError = useSignal<string | null>(null);
	const controlRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const timer = useRef<number | null>(null);
	const sequence = useRef(0);
	const listId = useId(undefined, "ins-access-pick");

	// #region Targets
	async function readTargets(q: string): Promise<void> {
		const id = ++sequence.current;
		targetsLoading.value = true;
		const res = await FilesService.accessTargets(q);
		if (id !== sequence.current) return;
		targetsLoading.value = false;
		if (res.ok && res.data) {
			targets.value = res.data.targets;
			targetsError.value = null;
		} else targetsError.value = res.message ?? "Your teams and projects couldn't be loaded.";
	}

	function askTargets(q: string, now: boolean): void {
		if (timer.current !== null) clearTimeout(timer.current);
		targetsAsked.value = true;
		if (now) {
			void readTargets(q);
			return;
		}
		timer.current = setTimeout(() => {
			timer.current = null;
			void readTargets(q);
		}, SEARCH_DEBOUNCE_MS) as unknown as number;
	}

	useEffect(() => () => {
		if (timer.current !== null) clearTimeout(timer.current);
	}, []);
	// #endregion

	// #region Rows
	const q = text.value.trim();
	const excluded = new Set(props.excludeIds.map((id) => id.toLowerCase()));
	const rows: PickRow[] = [];
	if (q.length > 0) {
		for (const person of people.contacts.value) {
			if (excluded.has(person.id.toLowerCase())) continue;
			rows.push({
				kind: "user",
				id: person.id,
				name: person.name,
				detail: contactMeta(person) || null,
				avatar: person.avatar,
				group: "people",
			});
		}
	}
	for (const target of targets.value) rows.push(targetRow(target));

	const rowsRef = useRef<PickRow[]>([]);
	rowsRef.current = rows;
	const nav = useListNavigation(() => rowsRef.current.length);
	// #endregion

	// #region Overlay
	const open = focused.value && !props.disabled && (q.length > 0 || targetsAsked.value);
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
	// #endregion

	// #region Input
	function onFocus(): void {
		focused.value = true;
		if (!targetsAsked.peek()) askTargets(text.peek().trim(), true);
	}

	function onInput(e: JSX.TargetedEvent<HTMLInputElement>): void {
		const value = e.currentTarget.value;
		text.value = value;
		focused.value = true;
		nav.reset(-1);
		if (value.trim().length > 0) people.setQuery(value);
		askTargets(value.trim(), false);
	}

	function toggle(row: PickRow): void {
		if (props.isAdded(row)) props.onRemove(row);
		else {props.onAdd({
				kind: row.kind,
				id: row.id,
				name: row.name,
				detail: row.detail,
				avatar: row.avatar,
			});}
		inputRef.current?.focus();
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
		if (!open) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				onFocus();
			}
			return;
		}
		if (nav.onKeyDown(e)) return;
		if (e.key === "Enter") {
			const row = rowsRef.current[nav.active.peek()];
			if (row) {
				e.preventDefault();
				toggle(row);
			}
		} else if (e.key === "Tab") {
			focused.value = false;
		}
	}
	// #endregion

	const active = nav.active.value;
	const activeId = open && active >= 0 ? `${listId}-opt-${active}` : undefined;
	const reasonId = `${listId}-reason`;

	function status(): JSX.Element | null {
		const searching = q.length > 0 && people.loading.value;
		if (searching || (targetsLoading.value && rows.length === 0)) {
			return <p class="ins-access__pick-note" role="status">Searching…</p>;
		}
		const failure = (q.length > 0 ? people.error.value : null) ?? targetsError.value;
		if (failure && rows.length === 0) {
			return <p class="ins-access__pick-note" role="alert">{failure}</p>;
		}
		if (rows.length > 0) return null;
		return (
			<p class="ins-access__pick-note" role="status">
				{q.length > 0
					? `No one matches “${q}”.`
					: "Type a name or @handle to find people. Your teams and projects show here too."}
			</p>
		);
	}

	const groups = (["people", "entities", "projects"] as const)
		.map((group) => ({
			group,
			items: rows.map((row, i) => ({ row, i })).filter((x) => x.row.group === group),
		}))
		.filter((g) => g.items.length > 0);

	return (
		<div class="ins-access__picker">
			<div
				ref={controlRef}
				class="ins-access__search"
				data-open={open ? "true" : undefined}
				data-disabled={props.disabled ? "true" : undefined}
			>
				<span class="ins-access__search-glyph" aria-hidden="true">
					<Icon name="search" size="sm" />
				</span>
				<input
					ref={inputRef}
					class="ins-access__search-input"
					type="text"
					role="combobox"
					autoComplete="off"
					spellcheck={false}
					placeholder="Add people, teams or projects"
					aria-label="Add people, teams or projects"
					aria-autocomplete="list"
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-controls={listId}
					aria-activedescendant={activeId}
					aria-describedby={props.disabled && props.disabledReason ? reasonId : undefined}
					disabled={props.disabled}
					value={text.value}
					onInput={onInput}
					onKeyDown={onKeyDown}
					onFocus={onFocus}
				/>
			</div>
			{props.disabled && props.disabledReason
				? <p class="ins-access__note" id={reasonId}>{props.disabledReason}</p>
				: null}

			{open && (
				<BodyPortal>
					<div
						ref={panelRef}
						class="ui-menu-surface ins-access__pick-panel"
						data-placement={float?.placement}
						style={styleVars({
							"--iap-top": float ? `${float.top}px` : undefined,
							"--iap-left": float ? `${float.left}px` : undefined,
							"--iap-width": float ? `${float.width}px` : undefined,
							"--iap-maxh": float?.availableHeight ? `${float.availableHeight}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						<div
							id={listId}
							role="listbox"
							aria-multiselectable="true"
							aria-label="People, teams and projects"
							class="ins-access__pick-list"
						>
							{groups.map(({ group, items }) => (
								<div
									key={group}
									role="group"
									aria-labelledby={`${listId}-${group}`}
									class="ins-access__pick-group"
								>
									<span
										id={`${listId}-${group}`}
										class="ins-access__pick-heading"
										role="presentation"
									>
										{GROUP_LABEL[group]}
									</span>
									{items.map(({ row, i }) => {
										const added = props.isAdded(row);
										return (
											<div
												key={`${row.kind}:${row.id}`}
												id={`${listId}-opt-${i}`}
												role="option"
												aria-selected={added}
												class="ui-menu-item ins-access__pick-option"
												data-active={i === active ? "true" : undefined}
												data-added={added ? "true" : undefined}
												onPointerDown={(e) => {
													e.preventDefault();
													toggle(row);
												}}
												onPointerEnter={() => nav.reset(i)}
											>
												{row.kind === "user"
													? <UserAvatar image={row.avatar} label={row.name} size={28} />
													: <Avatar image={row.avatar} label={row.name} size={28} shape="square" />}
												<span class="ins-access__pick-text">
													<span class="ins-access__pick-name">{row.name}</span>
													{row.detail
														? <span class="ins-access__pick-detail">{row.detail}</span>
														: null}
												</span>
												<span class="ins-access__pick-act" aria-hidden="true">
													<Icon name={added ? "check" : "plus"} size="sm" />
													{added ? "Added" : "Add"}
												</span>
											</div>
										);
									})}
								</div>
							))}
						</div>
						{status()}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
