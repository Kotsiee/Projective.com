import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import { batch, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/invite-modal.css";
import { Avatar } from "@projective/ui/display";
import { Dialog } from "@projective/ui/feedback";
import { Button, Select, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import {
	endsWithSeparator,
	type InviteRecipient,
	type ParsedRecipient,
	parseInviteInput,
	recipientKey,
} from "@projective/types/invites";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { normaliseHandle } from "@features/share/core/people-picker.ts";
import {
	applyOutcome,
	invalidInputMessage,
	type InviteRoleOption,
	type InviteSeats,
	type InviteSendOutcome,
	type QueuedRecipient,
	removeRow,
	rowMeta,
	rowTitle,
	seatCaption,
	seatOverflow,
	sendLabel,
	setRowRole,
	type StageMeta,
	stageRecipients,
	toRecipients,
} from "../core/invite-queue.ts";

/**
 * UniversalInviteModal — the one invite surface for a project, a team and a business (Decision #318,
 * superseding the one-click layout of #145 and the handle-or-email tabs of the workspace modal).
 *
 * Top to bottom, in one compact column:
 *
 *   1. **Composer** — ONE field for emails and handles alike (the text decides which:
 *      `@projective/types/invites` `parseInviteInput`), with the default role embedded beside it and
 *      Add. A comma, semicolon, space, Enter or a paste stages what was typed; a paste of many
 *      addresses (mail-client mailboxes included) stages them all. People the viewer works with are
 *      suggested as they type (`suggest`), picked with the arrow keys and Enter or a click.
 *   2. **Queue** — each staged person: avatar · identifier · a compact role Select (plain labels,
 *      custom roles included) · Remove. A refused row stays with the server's sentence.
 *   3. **Note** — collapsed behind "Add a note" where the surface carries one.
 *   4. **Link** — the surface's ask-to-join link (`link` slot, an `InviteLinkPanel`).
 *
 * It never navigates: opening, sending and closing all leave the viewer exactly where they were. The
 * surface owns the transport (`onSend`) and its own rules — local refusals (`refuse`), a role-level
 * blocker such as a business's manager cap (`queueProblem`), a whole-modal blocker (`blocked`) and
 * its seat picture (`seats`, captioned "3 of 4 seats free" and enforced on Send).
 */

// #region Props
export type InviteTargetType = "project" | "team" | "business";

export interface UniversalInviteModalProps {
	/** Open state — `Dialog` requires a Signal. */
	open: Signal<boolean>;
	targetType: InviteTargetType;
	targetId: string;
	/** The name in the header: "Invite to {targetName}". */
	targetName: string;
	/** Every role the viewer may offer, custom roles included — rendered as plain labels. */
	availableRoles: readonly InviteRoleOption[];
	/** The role new rows start at; the first offered role when `null` or not on offer. */
	defaultRoleId: string | null;
	/** Called after the modal closes (Cancel, Escape, the mask, or a send that left nothing behind). */
	onClose: () => void;
	/** Send the batch; answer which addresses were refused. */
	onSend: (recipients: InviteRecipient[], note: string) => Promise<InviteSendOutcome>;
	/** Seats against the plan, or `null` when the surface has none. */
	seats?: InviteSeats | null;
	/** A surface refusal for one address before it is staged ("Already a member"). */
	refuse?: (r: ParsedRecipient) => string | null;
	/** A refusal of the queue as staged (e.g. the manager cap for the roles chosen), or `null`. */
	queueProblem?: (queue: readonly QueuedRecipient[]) => string | null;
	/** A reason nothing can be sent at all (no grantable role, a full plan), or `null`. */
	blocked?: string | null;
	/** Controls that scope the invitation, shown under the header (a project's stage picker). */
	scope?: ComponentChildren;
	/** The ask-to-join link section. */
	link?: ComponentChildren;
	/** Offer the note toggle (the surface's invitation carries one). */
	allowNote?: boolean;
	/** The note's placeholder. */
	notePlaceholder?: string;
	/** Suggest people the viewer works with as they type. */
	suggest?: boolean;
	/** Handles never suggested (the roster, the entity's own). */
	excludeHandles?: ReadonlySet<string>;
	/** Extra copy under the queue (an invitation's lifetime). */
	footnote?: string;
}
// #endregion

/** At most this many suggestions under the field. */
const SUGGESTION_LIMIT = 5;
/** Characters typed before people are suggested. */
const SUGGEST_MIN = 2;

const TARGET_NOUN: Readonly<Record<InviteTargetType, string>> = {
	project: "project",
	team: "team",
	business: "business",
};

export function UniversalInviteModal(props: UniversalInviteModalProps): JSX.Element {
	// The body mounts on the first open and then stays, so the close transition keeps its content.
	const opened = useRef(false);
	if (props.open.value) opened.current = true;
	const caption = seatCaption(props.seats);
	return (
		<Dialog
			visible={props.open}
			header={
				<span class="inv-modal__header">
					<span class="inv-modal__title">Invite to {props.targetName}</span>
					{caption && <span class="inv-modal__seats">{caption}</span>}
				</span>
			}
			modal
			width="34rem"
			class="inv-modal"
			onVisibleChange={(visible) => {
				if (!visible) props.onClose();
			}}
		>
			{opened.current && <InviteBody {...props} />}
		</Dialog>
	);
}

// #region Body
function InviteBody(props: UniversalInviteModalProps): JSX.Element {
	const roles = props.availableRoles;
	const fallbackRole = roles.find((r) => r.id === props.defaultRoleId)?.id ?? roles[0]?.id ?? "";

	const queue = useSignal<QueuedRecipient[]>([]);
	const draft = useSignal("");
	const defaultRole = useSignal(fallbackRole);
	const note = useSignal("");
	const noteOpen = useSignal(false);
	const sending = useSignal(false);
	const fieldError = useSignal<string | null>(null);
	const status = useSignal<string | null>(null);
	const focused = useSignal(false);
	const highlight = useSignal(-1);
	const inputRef = useRef<HTMLInputElement>(null);

	// The role the surface last proposed: a reopen seeded to another role (a role's own row) re-seeds.
	const seededFor = useRef(props.defaultRoleId);
	if (seededFor.current !== props.defaultRoleId) {
		seededFor.current = props.defaultRoleId;
		defaultRole.value = fallbackRole;
	}
	if (!roles.some((r) => r.id === defaultRole.value) && fallbackRole) {
		defaultRole.value = fallbackRole;
	}

	const contacts = useContactSearch({ loadOnMount: false, limit: SUGGESTION_LIMIT * 2 });
	const queued = new Set(queue.value.map((r) => r.key));
	const query = draft.value.trim().replace(/^@+/, "");
	// Only the answer to what is in the field now: a slower answer to an earlier query is never shown.
	const suggestions = props.suggest && focused.value && query.length >= SUGGEST_MIN &&
			!query.includes("@") && contacts.query.value === query && !contacts.loading.value
		? contacts.contacts.value.filter((c) => {
			const handle = normaliseHandle(c.handle);
			return handle !== null && !queued.has(`handle:${handle}`) &&
				!(props.excludeHandles?.has(handle) ?? false);
		}).slice(0, SUGGESTION_LIMIT)
		: [];
	const listOpen = suggestions.length > 0;
	const active = listOpen && highlight.value >= 0 && highlight.value < suggestions.length
		? highlight.value
		: -1;

	const staged = queue.value.length;
	const overflow = seatOverflow(props.seats, staged);
	const queueProblem = props.queueProblem?.(queue.value) ?? null;
	const sendBlocked = (staged === 0 && !draft.value.trim()) || sending.value || overflow > 0 ||
		!!queueProblem || !!props.blocked || roles.length === 0;
	const noun = TARGET_NOUN[props.targetType];

	// #region Handlers
	function stage(parsed: readonly ParsedRecipient[], meta: StageMeta = {}): string | null {
		const result = stageRecipients(
			queue.peek(),
			parsed,
			defaultRole.peek(),
			props.refuse,
			meta,
		);
		queue.value = result.queue;
		const first = result.skipped[0];
		return first ? `${first.address}: ${first.reason}` : null;
	}

	/** Stage everything in `text`; what could not be read stays in the field. */
	function commit(text: string): void {
		const parsed = parseInviteInput(text);
		const skipped = stage(parsed.recipients);
		batch(() => {
			draft.value = parsed.invalid.join(", ");
			fieldError.value = invalidInputMessage(parsed.invalid) ?? skipped;
			status.value = null;
			highlight.value = -1;
		});
	}

	function pick(index: number): void {
		const contact = suggestions[index];
		const handle = normaliseHandle(contact?.handle);
		if (!contact || !handle) return;
		const skipped = stage([{ type: "handle", value: handle }], {
			name: contact.name,
			avatar: contact.avatar,
		});
		batch(() => {
			draft.value = "";
			fieldError.value = skipped;
			highlight.value = -1;
		});
		inputRef.current?.focus();
	}

	function onInput(value: string): void {
		// A separator commits what came before it; the fragment after it keeps being typed.
		if (endsWithSeparator(value)) {
			commit(value);
			return;
		}
		batch(() => {
			draft.value = value;
			focused.value = true;
			fieldError.value = null;
			highlight.value = -1;
		});
		if (props.suggest) {
			const q = value.trim().replace(/^@+/, "");
			if (q.length >= SUGGEST_MIN && !q.includes("@")) contacts.setQuery(q);
		}
	}

	function onPaste(event: ClipboardEvent): void {
		const pasted = event.clipboardData?.getData("text") ?? "";
		if (!/[\s,;<]/.test(pasted.trim())) return; // one address: let it land and be edited
		event.preventDefault();
		commit(`${draft.peek()} ${pasted}`);
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown" && listOpen) {
			event.preventDefault();
			highlight.value = (active + 1) % suggestions.length;
		} else if (event.key === "ArrowUp" && listOpen) {
			event.preventDefault();
			highlight.value = active <= 0 ? suggestions.length - 1 : active - 1;
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (active >= 0) pick(active);
			else if (draft.peek().trim()) commit(draft.peek());
		} else if (event.key === "Escape" && listOpen) {
			// Close the suggestions, not the dialog.
			event.stopPropagation();
			focused.value = false;
			highlight.value = -1;
		} else if (event.key === "Backspace" && draft.peek() === "" && queue.peek().length > 0) {
			// An empty field's Backspace takes back the last staged row, as token fields do.
			const last = queue.peek()[queue.peek().length - 1];
			queue.value = removeRow(queue.peek(), last.key);
		}
	}

	function reset(): void {
		batch(() => {
			queue.value = [];
			draft.value = "";
			note.value = "";
			noteOpen.value = false;
			sending.value = false;
			fieldError.value = null;
			status.value = null;
			highlight.value = -1;
			defaultRole.value = fallbackRole;
		});
	}

	function close(): void {
		props.open.value = false;
		reset();
	}

	async function send(): Promise<void> {
		if (draft.peek().trim()) commit(draft.peek());
		if (draft.peek().trim()) return; // unreadable text is still in the field — fix it first
		const list = queue.peek();
		if (list.length === 0 || sending.peek() || props.blocked || roles.length === 0) return;
		if (seatOverflow(props.seats, list.length) > 0 || props.queueProblem?.(list)) return;
		batch(() => {
			sending.value = true;
			status.value = null;
			fieldError.value = null;
		});
		const outcome = await props.onSend(toRecipients(list), note.peek().trim());
		const remaining = applyOutcome(list, outcome);
		batch(() => {
			sending.value = false;
			queue.value = remaining;
			status.value = outcome.error ?? outcome.message;
		});
		if (!outcome.error && remaining.length === 0) close();
	}
	// #endregion

	const listId = `inv-suggest-${props.targetId}`;
	const errorId = `inv-error-${props.targetId}`;

	return (
		<form
			class="inv-modal__body"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			{props.scope && <div class="inv-modal__scope">{props.scope}</div>}

			<div class="inv-composer" data-invalid={fieldError.value ? "true" : undefined}>
				<div class="inv-composer__box">
					<input
						ref={inputRef}
						class="inv-composer__field"
						type="text"
						value={draft.value}
						placeholder="Emails or @handles, separated by commas"
						aria-label={`Invite people to this ${noun} by email or @handle`}
						aria-describedby={fieldError.value ? errorId : undefined}
						aria-invalid={fieldError.value ? "true" : undefined}
						role={props.suggest ? "combobox" : undefined}
						aria-autocomplete={props.suggest ? "list" : undefined}
						aria-expanded={props.suggest ? (listOpen ? "true" : "false") : undefined}
						aria-controls={props.suggest ? listId : undefined}
						aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
						autoComplete="off"
						autoCapitalize="none"
						spellcheck={false}
						disabled={sending.value}
						onInput={(e) => onInput((e.target as HTMLInputElement).value)}
						onPaste={onPaste}
						onKeyDown={onKeyDown}
						onFocus={() => (focused.value = true)}
						onBlur={() => (focused.value = false)}
					/>
					<Select
						size="sm"
						class="inv-composer__role"
						options={roles.map((r) => ({ label: r.name, value: r.id }))}
						value={defaultRole.value}
						onValueChange={(next) => {
							if (next) defaultRole.value = next;
						}}
						panelWidth="auto"
						disabled={roles.length === 0 || sending.value}
						aria-label="Role new people are added at"
					/>
				</div>
				<Button
					variant="outlined"
					severity="secondary"
					size="sm"
					class="inv-composer__add"
					label="Add"
					disabled={!draft.value.trim() || sending.value}
					onClick={() => commit(draft.peek())}
				/>
				{props.suggest && (
					<ul
						id={listId}
						class="inv-suggest"
						role="listbox"
						aria-label="People you work with"
						hidden={!listOpen}
					>
						{suggestions.map((c, i) => (
							<li
								key={c.id}
								id={`${listId}-${i}`}
								role="option"
								aria-selected={i === active ? "true" : "false"}
								class="inv-suggest__item"
								data-active={i === active ? "true" : undefined}
								// Keep focus in the field, so picking never blurs the combobox.
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => pick(i)}
							>
								<UserAvatar image={c.avatar} label={c.name} size="sm" />
								<span class="inv-suggest__name">{c.name}</span>
								<span class="inv-suggest__handle">@{normaliseHandle(c.handle)}</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<p class="inv-composer__error" id={errorId} role="alert">{fieldError.value}</p>

			{staged > 0 && (
				<ul
					class="inv-queue"
					aria-label={`${staged} ${staged === 1 ? "person" : "people"} to invite`}
				>
					{queue.value.map((r) => (
						<li
							key={recipientKey(r)}
							class="inv-queue__row"
							data-refused={r.error ? "true" : undefined}
						>
							{r.type === "email"
								? (
									<Avatar
										size="sm"
										icon={<Icon name="mail" size="sm" />}
										class="inv-queue__avatar"
									/>
								)
								: (
									<UserAvatar
										size="sm"
										image={r.avatar}
										label={r.name ?? r.value}
										class="inv-queue__avatar"
									/>
								)}
							<span class="inv-queue__who">
								<span class="inv-queue__title">{rowTitle(r)}</span>
								<span class="inv-queue__meta">{r.error ?? rowMeta(r)}</span>
							</span>
							<Select
								size="sm"
								class="inv-queue__role"
								options={roles.map((o) => ({ label: o.name, value: o.id }))}
								value={r.roleId}
								onValueChange={(next) => {
									if (next) queue.value = setRowRole(queue.peek(), r.key, next);
								}}
								panelWidth="auto"
								disabled={sending.value}
								aria-label={`Role for ${rowTitle(r)}`}
							/>
							<Button
								variant="text"
								severity="secondary"
								size="sm"
								iconOnly
								icon={<Icon name="close" size="sm" />}
								aria-label={`Remove ${rowTitle(r)}`}
								disabled={sending.value}
								onClick={() => (queue.value = removeRow(queue.peek(), r.key))}
							/>
						</li>
					))}
				</ul>
			)}

			{(overflow > 0 || queueProblem || props.blocked) && (
				<p class="inv-modal__notice" role="status">
					{props.blocked ??
						queueProblem ??
						`Only ${staged - overflow} ${
							staged - overflow === 1 ? "seat is" : "seats are"
						} free — remove ${overflow} ${overflow === 1 ? "person" : "people"} to send.`}
				</p>
			)}

			{props.allowNote && (noteOpen.value
				? (
					<Textarea
						class="inv-modal__note"
						value={note}
						rows={2}
						autoResize
						maxRows={5}
						maxLength={400}
						placeholder={props.notePlaceholder ?? "Add a note (optional)"}
						aria-label="Note to the people you invite"
						fluid
					/>
				)
				: (
					<Button
						variant="link"
						size="sm"
						class="inv-modal__note-toggle"
						label="Add a note"
						icon={<Icon name="plus" size="sm" />}
						onClick={() => (noteOpen.value = true)}
					/>
				))}

			<div class="inv-modal__actions">
				<p class="inv-modal__status" role="status" aria-live="polite">
					{status.value ?? props.footnote}
				</p>
				<Button variant="text" severity="secondary" label="Cancel" onClick={close} />
				<Button
					type="submit"
					variant="filled"
					label={sendLabel(staged)}
					disabled={sendBlocked}
					loading={sending.value}
				/>
			</div>

			{props.link && <div class="inv-modal__link">{props.link}</div>}
		</form>
	);
}
// #endregion
