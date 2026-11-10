import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { batch, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, FieldMark, Select } from "@projective/ui/fields";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import {
	type InviteRecipient,
	type ParsedRecipient,
	recipientAddress,
} from "@projective/types/invites";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { normaliseHandle } from "@features/share/core/people-picker.ts";
import {
	applyOutcome,
	batchProblem,
	draftBatch,
	type InviteRoleOption,
	type InviteSeats,
	type InviteSendOutcome,
	leftoverDraft,
	type QueuedRecipient,
	seatProblem,
	toRecipients,
	typedFragment,
	withPicked,
} from "../core/invite-queue.ts";

/**
 * InviteBar — the Invite modal's one action row (Decision #405): an address field, the role the
 * invitation offers and Invite. The field takes `@handles` and emails together, a pasted list
 * included; Invite reads it as one batch at that role and sends it. What was refused goes back into
 * the field with the first reason in the message slot under the row — a slot that holds its height,
 * so an answer never moves the rows below it. A lock reason (no grantable role, no free seat, a
 * business's manager cap) is said in the same slot before anything is pressed.
 *
 * The field is a combobox over the people the viewer works with (`suggest`): ArrowUp/ArrowDown move,
 * Enter picks, and a pick replaces the fragment being typed. It wears `InputText`'s own field classes,
 * so its rest, hover, focus and invalid states are the §A.7 token layer's, and its invalid contour
 * paints only once focus has left it.
 */

// #region Props
export interface InviteBarProps {
	open: Signal<boolean>;
	targetId: string;
	/** The noun for the field's accessible name ("project", "team"). */
	noun: string;
	availableRoles: readonly InviteRoleOption[];
	defaultRoleId: string | null;
	onSend: (recipients: InviteRecipient[]) => Promise<InviteSendOutcome>;
	seats?: InviteSeats | null;
	refuse?: (r: ParsedRecipient) => string | null;
	queueProblem?: (queue: readonly QueuedRecipient[]) => string | null;
	blocked?: string | null;
	suggest?: boolean;
	excludeHandles?: ReadonlySet<string>;
}
// #endregion

/** At most this many suggestions under the field. */
const SUGGESTION_LIMIT = 5;
/** Characters typed before people are suggested. */
const SUGGEST_MIN = 2;

type Tone = "success" | "danger";

export function InviteBar(props: InviteBarProps): JSX.Element {
	const roles = props.availableRoles;
	const fallbackRole = roles.find((r) => r.id === props.defaultRoleId)?.id ?? roles[0]?.id ?? "";

	const draft = useSignal("");
	const role = useSignal(fallbackRole);
	const sending = useSignal(false);
	const message = useSignal<{ tone: Tone; text: string } | null>(null);
	const focused = useSignal(false);
	const highlight = useSignal(-1);
	const inputRef = useRef<HTMLInputElement>(null);

	// The role the surface last proposed: a reopen seeded to another role (a role's own row) re-seeds.
	const seededFor = useRef(props.defaultRoleId);
	if (seededFor.current !== props.defaultRoleId) {
		seededFor.current = props.defaultRoleId;
		role.value = fallbackRole;
	}
	if (!roles.some((r) => r.id === role.value) && fallbackRole) role.value = fallbackRole;

	const isOpen = props.open.value;
	useEffect(() => {
		if (isOpen) return;
		batch(() => {
			draft.value = "";
			sending.value = false;
			message.value = null;
			highlight.value = -1;
			role.value = fallbackRole;
		});
	}, [isOpen]);

	const contacts = useContactSearch({ loadOnMount: false, limit: SUGGESTION_LIMIT * 2 });
	const pending = draftBatch(draft.value, role.value, props.refuse);
	const inField = new Set(pending.queue.map((r) => r.key));
	const fragment = typedFragment(draft.value);
	const suggestions = props.suggest && focused.value && fragment.length >= SUGGEST_MIN &&
			!fragment.includes("@") && contacts.query.value === fragment && !contacts.loading.value
		? contacts.contacts.value.filter((c) => {
			const handle = normaliseHandle(c.handle);
			return handle !== null && !inField.has(`handle:${handle}`) &&
				!(props.excludeHandles?.has(handle) ?? false);
		}).slice(0, SUGGESTION_LIMIT)
		: [];
	const listOpen = suggestions.length > 0;
	const active = listOpen && highlight.value >= 0 && highlight.value < suggestions.length
		? highlight.value
		: -1;

	const lock = props.blocked ?? seatProblem(props.seats, pending.queue.length) ??
		props.queueProblem?.(pending.queue) ?? null;
	const shown = lock ? { tone: "danger" as const, text: lock } : message.value;
	const painted = !focused.value && shown?.tone === "danger" && !lock;
	const inviteBlocked = sending.value || roles.length === 0 || lock !== null || !draft.value.trim();

	// #region Handlers
	function onInput(value: string): void {
		batch(() => {
			draft.value = value;
			focused.value = true;
			message.value = null;
			highlight.value = -1;
		});
		if (!props.suggest) return;
		const q = typedFragment(value);
		if (q.length >= SUGGEST_MIN && !q.includes("@")) contacts.setQuery(q);
	}

	function pick(index: number): void {
		const handle = normaliseHandle(suggestions[index]?.handle);
		if (!handle) return;
		batch(() => {
			draft.value = withPicked(draft.peek(), handle);
			highlight.value = -1;
		});
		inputRef.current?.focus();
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown" && listOpen) {
			event.preventDefault();
			highlight.value = (active + 1) % suggestions.length;
		} else if (event.key === "ArrowUp" && listOpen) {
			event.preventDefault();
			highlight.value = active <= 0 ? suggestions.length - 1 : active - 1;
		} else if (event.key === "Enter" && active >= 0) {
			event.preventDefault();
			pick(active);
		} else if (event.key === "Escape" && listOpen) {
			event.stopPropagation();
			focused.value = false;
			highlight.value = -1;
		}
	}

	async function send(): Promise<void> {
		if (inviteBlocked) return;
		const sendable = draftBatch(draft.peek(), role.peek(), props.refuse);
		if (sendable.queue.length === 0) {
			message.value = {
				tone: "danger",
				text: batchProblem(sendable) ?? "Add an email address or an @handle.",
			};
			return;
		}
		batch(() => {
			sending.value = true;
			message.value = null;
		});
		const outcome = await props.onSend(toRecipients(sendable.queue));
		const refused = applyOutcome(sendable.queue, outcome);
		if (outcome.error) {
			batch(() => {
				sending.value = false;
				message.value = { tone: "danger", text: outcome.error ?? "" };
			});
			return;
		}
		const firstRefusal = refused[0]?.error
			? `${recipientAddress(refused[0])}: ${refused[0].error}`
			: null;
		const problem = firstRefusal ?? batchProblem(sendable);
		batch(() => {
			sending.value = false;
			draft.value = leftoverDraft(refused, sendable);
			message.value = problem
				? { tone: "danger", text: [outcome.message, problem].filter(Boolean).join(" ") }
				: outcome.message
				? { tone: "success", text: outcome.message }
				: null;
		});
	}
	// #endregion

	const listId = `inv-suggest-${props.targetId}`;
	const messageId = `inv-message-${props.targetId}`;

	return (
		<form
			class="inv-bar"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<div class="inv-bar__row">
				<div class="inv-bar__field">
					<span
						class={`ui-field ui-input ui-field--size-md ui-field--outlined ui-field--fluid${
							painted ? " ui-field--invalid" : ""
						}`}
					>
						<input
							ref={inputRef}
							class="ui-field__input ui-input__input"
							type="text"
							value={draft.value}
							placeholder="Email or @handle…"
							aria-label={`Invite people to this ${props.noun} by email or @handle`}
							aria-describedby={shown ? messageId : undefined}
							aria-invalid={painted ? "true" : undefined}
							role={props.suggest ? "combobox" : undefined}
							aria-autocomplete={props.suggest ? "list" : undefined}
							aria-expanded={props.suggest ? (listOpen ? "true" : "false") : undefined}
							aria-controls={props.suggest ? listId : undefined}
							aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
							autoComplete="off"
							autoCapitalize="none"
							spellcheck={false}
							enterKeyHint="send"
							disabled={sending.value}
							onInput={(e) => onInput((e.target as HTMLInputElement).value)}
							onKeyDown={onKeyDown}
							onFocus={() => (focused.value = true)}
							onBlur={() => (focused.value = false)}
						/>
						<span class="ui-field__mark" aria-hidden="true">
							<FieldMark status={painted ? "invalid" : "default"} />
						</span>
					</span>
					{props.suggest && (
						<ul
							id={listId}
							class="ui-menu-surface inv-suggest"
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
									class="ui-menu-item inv-suggest__item"
									data-active={i === active ? "true" : undefined}
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
				<Select
					class="inv-bar__role"
					options={roles.map((r) => ({ label: r.name, value: r.id }))}
					value={role}
					panelWidth="auto"
					disabled={roles.length === 0 || sending.value}
					aria-label="Role they are invited as"
				/>
				<Button
					type="submit"
					variant="filled"
					severity="primary"
					class="inv-bar__invite"
					label="Invite"
					disabled={inviteBlocked}
					loading={sending.value}
				/>
			</div>
			<p
				class="inv-bar__message"
				id={messageId}
				role="status"
				aria-live="polite"
				data-tone={shown?.tone}
			>
				{shown?.text}
			</p>
		</form>
	);
}
