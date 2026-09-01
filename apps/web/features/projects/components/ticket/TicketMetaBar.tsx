import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { DatePicker, Select } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import type { BoardCard, ProjectParty } from "../../types/projects-types.ts";
import { TICKET_INTENSITY_LABEL } from "../../types/projects-types.ts";
import { PRIORITY_OPTIONS, priorityLabel, priorityTone } from "../../core/board-model.ts";
import {
	fromDateInput,
	INTENSITY_OPTIONS,
	isOverdue,
	toDateInput,
} from "../../core/ticket-model.ts";

/**
 * TicketMetaBar — the four facts that govern a ticket, and the person it went to.
 *
 * At rest the row is a SUMMARY: icon, label, value, in the same compact type the modal has always
 * used. Nothing here is a form until it is asked to be — a row of dropdown chevrons above a document
 * turns reading into scanning a control panel, and three of these four values are read far more
 * often than they are changed.
 *
 * So each governing value follows the {@link InlineEdit} contract the rest of this surface uses:
 * static text with a quiet affordance, which becomes its own control in place, at the same metrics,
 * and opens immediately so the change still costs one click. A viewer without the right to change it
 * sees plain text and no affordance at all — never a disabled control, which advertises a capability
 * and then refuses it.
 *
 * "Claimed by" sits alone at the far end because it is the one value on this row that is not the
 * client's to set: it records what the market did with the ticket, not what the client asked for.
 */
export interface TicketMetaBarProps {
	card: BoardCard;
	/** Whether the viewer may change what the ticket asks for (client-side, with the edit right). */
	canEdit: boolean;
	/** Whether the viewer acts on the client side — gates the owner selector specifically. */
	isClient: boolean;
	/** Whether "which of us owns this" is a real question here (a multi-seat client workspace). */
	sharedWorkspace: boolean;
	workspaceLabel: string;
	clientMembers: ProjectParty[];
	onPatch: (patch: Partial<BoardCard>) => void;
}

/** The key by which a party is addressed in a Select's flat string options. */
const partyKey = (p: ProjectParty): string => p.handle ?? p.name;

// #region The static ⇄ control swap
interface MetaEditorProps {
	/** The affordance's accessible name ("Change the workload intensity"). */
	label: string;
	/** What the row reads at rest. */
	display: VNode;
	/** The control it becomes, rendered only while editing. */
	control: (done: () => void) => VNode;
	/**
	 * A CSS selector for the element inside `control` that opens its panel. The swap costs a click, so
	 * the control opens on that same click rather than asking for a second one.
	 */
	openSelector: string;
	editable: boolean;
}

function MetaEditor(props: MetaEditorProps): JSX.Element {
	const editing = useSignal(false);
	const hostRef = useRef<HTMLSpanElement>(null);

	/*
	 * Open the control the swap just mounted.
	 *
	 * Both Select and DatePicker open from a real click on their own trigger, so a synthetic one is
	 * the honest way to say "the click that revealed you was meant for you". It also avoids the
	 * dismiss race a programmatic open would have: `useDismiss` listens for pointer events outside the
	 * panel, and `.click()` dispatches none, so the panel that opens stays open.
	 */
	useEffect(() => {
		if (!editing.value) return;
		const el = hostRef.current?.querySelector<HTMLElement>(props.openSelector);
		el?.focus();
		el?.click();
	}, [editing.value]);

	/*
	 * Escape must close the EDIT, not the modal the edit sits in. The overlay binds Escape on
	 * `document` in the capture phase so an inner handler cannot swallow it; `window` precedes
	 * `document` in the capture path, so a listener here runs strictly first. Registered only while
	 * editing, so the modal's own Escape works normally the rest of the time.
	 *
	 * The control's own panel gets first refusal: while a Select or a calendar is open, Escape belongs
	 * to it, and only a second press closes the editor.
	 */
	useEffect(() => {
		if (!editing.value || typeof globalThis.addEventListener !== "function") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const host = hostRef.current;
			/*
			 * A control's panel is portalled to `document.body`, so a control opened from INSIDE another
			 * control's panel — the calendar's own month/year `Select` — is invisible to a host-scoped
			 * query. Consuming the key here would then read "the calendar is open" and close the whole
			 * calendar when the reader only meant to close the year list. When a nested panel is open the
			 * package's own dismissal already owns the key (its `document` capture handler is gated on
			 * `useOverlayStack().isTop`), so the honest move is to let the event travel rather than to
			 * decide on its behalf.
			 */
			const nested = document.querySelector(
				'.ui-datepicker__panel [aria-expanded="true"], .ui-select__panel [aria-expanded="true"]',
			);
			if (nested) return;
			const panelOpen = !!host?.querySelector('[aria-expanded="true"]');
			e.stopImmediatePropagation();
			e.preventDefault();
			if (panelOpen) {
				host?.querySelector<HTMLElement>(props.openSelector)?.click();
				return;
			}
			editing.value = false;
		};
		globalThis.addEventListener("keydown", onKey, true);
		return () => globalThis.removeEventListener("keydown", onKey, true);
	}, [editing.value]);

	if (!props.editable) return props.display;

	if (editing.value) {
		return (
			<span
				ref={hostRef}
				class="tkv-meta__editor"
				onFocusOut={(e) => {
					// A blur INSIDE the control (trigger → panel → option) is not the end of the edit; only
					// focus genuinely leaving the host is.
					const next = e.relatedTarget as Node | null;
					if (next && hostRef.current?.contains(next)) return;
					// The portalled panel is not a DOM descendant, so a focus move into it would read as
					// leaving. Defer one tick and re-check where focus actually landed.
					setTimeout(() => {
						const active = document.activeElement;
						const inPanel = active?.closest(".ui-select__panel, .ui-datepicker__panel");
						if (inPanel || (active && hostRef.current?.contains(active))) return;
						editing.value = false;
					}, 0);
				}}
			>
				{props.control(() => (editing.value = false))}
			</span>
		);
	}

	return (
		<button
			type="button"
			class="tkv-meta__trigger"
			aria-label={props.label}
			onClick={() => (editing.value = true)}
		>
			{props.display}
			<Icon name="chevron-down" size="2xs" class="tkv-meta__caret" />
		</button>
	);
}
// #endregion

/** One row item: the glyph, what it is, and the value or the control that sets it. */
function MetaItem(
	props: { icon: IconName; label: string; children: JSX.Element | VNode; end?: boolean },
): JSX.Element {
	return (
		<li class="tkv-meta__item" data-end={props.end ? "true" : undefined}>
			<Icon name={props.icon} size="2xs" class="tkv-meta__mark" />
			<span class="tkv-meta__k">{props.label}</span>
			{props.children}
		</li>
	);
}

export function TicketMetaBar(props: TicketMetaBarProps): JSX.Element {
	const { card, canEdit, isClient, sharedWorkspace } = props;
	const overdue = isOverdue(card.dueDate);

	const byKey = new Map(props.clientMembers.map((m) => [partyKey(m), m]));
	const ownerOptions = [
		{ value: "", label: "Unassigned" },
		...props.clientMembers.map((m) => ({ value: partyKey(m), label: m.name })),
	];

	/** A person as a Select row: the face first, because that is what a reader scans for. */
	const personRow = (opt: { value: string; label: string }): VNode => {
		const party = byKey.get(opt.value);
		return (
			<span class="tkv-person">
				{party
					? <Avatar image={party.avatar ?? undefined} label={party.name} size={20} alt="" />
					: (
						<span class="tkv-person__none" aria-hidden="true">
							<Icon name="user" size="2xs" />
						</span>
					)}
				<span class="tkv-person__name">{opt.label}</span>
			</span>
		);
	};

	return (
		<ul class="tkv-meta" aria-label="Ticket properties">
			<MetaItem icon="analytics" label="Intensity">
				<MetaEditor
					editable={canEdit}
					label={`Change the workload intensity. Currently ${
						TICKET_INTENSITY_LABEL[card.intensity]
					}.`}
					openSelector=".ui-select__trigger"
					display={
						<span class="tkv-meta__v" data-level={card.intensity}>
							{TICKET_INTENSITY_LABEL[card.intensity]}
						</span>
					}
					control={(done) => (
						<Select
							class="ui-field--bare tkv-meta__select"
							size="sm"
							value={card.intensity}
							aria-label="Workload intensity"
							options={INTENSITY_OPTIONS}
							onValueChange={(v) => {
								if (v) props.onPatch({ intensity: v as BoardCard["intensity"] });
								done();
							}}
						/>
					)}
				/>
			</MetaItem>

			<MetaItem icon="flag" label="Priority">
				<MetaEditor
					editable={canEdit}
					label={`Change the priority. Currently ${priorityLabel(card.priority)}.`}
					openSelector=".ui-select__trigger"
					display={
						<span class="tkv-meta__v" data-tone={priorityTone(card.priority)}>
							{priorityLabel(card.priority)}
						</span>
					}
					control={(done) => (
						<Select
							class="ui-field--bare tkv-meta__select"
							size="sm"
							value={card.priority}
							aria-label="Priority"
							options={PRIORITY_OPTIONS}
							onValueChange={(v) => {
								if (v) props.onPatch({ priority: v as BoardCard["priority"] });
								done();
							}}
						/>
					)}
				/>
			</MetaItem>

			<MetaItem icon="calendar" label="Due">
				<MetaEditor
					editable={canEdit}
					label={`Change the due date. Currently ${card.dueLabel ?? "not set"}.`}
					openSelector=".ui-datepicker__entry"
					display={
						<span class="tkv-meta__v" data-overdue={overdue ? "true" : undefined}>
							{card.dueLabel ?? "No date"}
						</span>
					}
					control={(done) => (
						<DatePicker
							class="ui-field--bare tkv-meta__date"
							size="sm"
							value={toDateInput(card.dueDate)}
							placeholder="No date"
							aria-label="Due date"
							dateFormat="M d, yy"
							showButtonBar
							onValueChange={(v) => {
								props.onPatch({ dueDate: fromDateInput(Array.isArray(v) ? v[0] ?? null : v) });
								done();
							}}
						/>
					)}
				/>
			</MetaItem>

			{
				/*
				 * The owner selector exists only where "which of us owns this" is a real question. On a
				 * personal engagement there is one buyer, so a dropdown offering a single choice would be a
				 * control that cannot be used — it is absent, not disabled.
				 *
				 * A provider-side viewer gets the ANSWER, not the control. Who on the client side owns a
				 * ticket is exactly the fact a freelancer needs (it is who they ask), but a greyed-out
				 * dropdown offers them a choice and then takes it back.
				 */
			}
			{sharedWorkspace
				? (
					<MetaItem icon="user" label="Owner">
						<MetaEditor
							editable={isClient}
							label={`Assign a ${props.workspaceLabel} member to this ticket. Currently ${
								card.owner?.name ?? "unassigned"
							}.`}
							openSelector=".ui-select__trigger"
							display={
								<span class="tkv-person tkv-meta__v">
									{card.owner
										? (
											<Avatar
												image={card.owner.avatar ?? undefined}
												label={card.owner.name}
												size={20}
												alt=""
											/>
										)
										: null}
									<span class="tkv-person__name">{card.owner?.name ?? "Unassigned"}</span>
								</span>
							}
							control={(done) => (
								<Select
									class="ui-field--bare tkv-meta__select tkv-meta__select--person"
									size="sm"
									value={card.owner ? partyKey(card.owner) : ""}
									aria-label={`Assign a ${props.workspaceLabel} member to this ticket`}
									placeholder="Unassigned"
									options={ownerOptions}
									optionTemplate={personRow}
									onValueChange={(v) => {
										props.onPatch({ owner: byKey.get(String(v ?? "")) ?? null });
										done();
									}}
								/>
							)}
						/>
					</MetaItem>
				)
				: null}

			{card.assignee
				? (
					<MetaItem icon="check" label="Claimed by" end>
						<Tooltip content={`${card.assignee.name} claimed this ticket`}>
							<span class="tkv-person tkv-meta__v" tabIndex={0}>
								<Avatar
									image={card.assignee.avatar ?? undefined}
									label={card.assignee.name}
									size={20}
									alt=""
								/>
								<span class="tkv-person__name">{card.assignee.name}</span>
							</span>
						</Tooltip>
					</MetaItem>
				)
				: null}
		</ul>
	);
}
