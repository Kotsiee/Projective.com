import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/event-modal.css";
import { Accordion, AccordionTab } from "@projective/ui/display";
import { Button, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { EntryReminder, ReminderChannel } from "@projective/types/scheduling";
import {
	nextReminder,
	normalizeReminders,
	REMINDER_CHANNEL_LABEL,
	REMINDER_LEADS,
	reminderLabel,
	reminderLeadLabel,
	REMINDERS_MAX,
} from "@projective/types/scheduling";

/**
 * The alerts a person sets, in two presentations: {@link ReminderRows} is the bare list, which is all
 * Settings needs for a default, and {@link EventRemindersField} folds it under one entry's summary, so
 * the inspector and the modal offer the same control and an entry that follows the default stays one
 * line of Meta.
 */

const CHANNELS = Object.entries(REMINDER_CHANNEL_LABEL).map(([value, label]) => ({ value, label }));

/** One alert: how long before, how it arrives, and a way to drop it. */
function ReminderRow(
	props: {
		reminder: EntryReminder;
		index: number;
		onChange: (next: EntryReminder) => void;
		onRemove: () => void;
	},
): JSX.Element {
	const { reminder, index } = props;
	// Bound rather than seeded: `normalizeReminders` can re-sort the list under a stable row.
	const lead = useSignal(String(reminder.minutes));
	const channel = useSignal<string>(reminder.channel);
	useEffect(() => {
		lead.value = String(reminder.minutes);
		channel.value = reminder.channel;
	}, [reminder.minutes, reminder.channel]);
	// A lead saved by another client stays selectable rather than showing an empty control.
	const leads = REMINDER_LEADS.includes(reminder.minutes)
		? REMINDER_LEADS
		: [...REMINDER_LEADS, reminder.minutes].sort((a, b) => a - b);

	return (
		<li class="evm-remind__row">
			<Select
				size="sm"
				fluid
				value={lead}
				options={leads.map((m) => ({ value: String(m), label: reminderLeadLabel(m) }))}
				aria-label={`Reminder ${index + 1}: how long before`}
				onValueChange={(v) => {
					if (v) props.onChange({ ...reminder, minutes: Number(v) });
				}}
			/>
			<Select
				size="sm"
				fluid
				value={channel}
				options={CHANNELS}
				aria-label={`Reminder ${index + 1}: how it arrives`}
				onValueChange={(v) => {
					if (v) props.onChange({ ...reminder, channel: v as ReminderChannel });
				}}
			/>
			<Button
				variant="text"
				severity="secondary"
				size="sm"
				iconOnly
				icon={<Icon name="close" size="sm" />}
				aria-label={`Remove reminder ${index + 1}`}
				onClick={props.onRemove}
			/>
		</li>
	);
}

/** Props for {@link ReminderRows}. */
export interface ReminderRowsProps {
	value: readonly EntryReminder[];
	onChange: (next: EntryReminder[]) => void;
}

/** The list itself. At the cap the Add is absent, never offered and then refused. */
export function ReminderRows({ value, onChange }: ReminderRowsProps): JSX.Element {
	const next = value.length < REMINDERS_MAX ? nextReminder(value) : null;
	return (
		<div class="evm-remind">
			{value.length > 0
				? (
					<ul class="evm-remind__rows">
						{value.map((reminder, i) => (
							<ReminderRow
								key={i}
								reminder={reminder}
								index={i}
								onChange={(row) =>
									onChange(normalizeReminders(value.map((r, n) => (n === i ? row : r))))}
								onRemove={() => onChange(value.filter((_, n) => n !== i))}
							/>
						))}
					</ul>
				)
				: null}
			{next
				? (
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						icon={<Icon name="plus" size="sm" />}
						label="Add a reminder"
						onClick={() => onChange(normalizeReminders([...value, next]))}
					/>
				)
				: null}
		</div>
	);
}

/** Props for {@link EventRemindersField}. */
export interface EventRemindersFieldProps {
	/** This entry's own alerts; `null` follows the default. */
	value: readonly EntryReminder[] | null;
	/** The reader's default, shown while nothing overrides it. */
	fallback: readonly EntryReminder[];
	/** A new list, or `null` to go back to the default. */
	onChange: (next: EntryReminder[] | null) => void;
}

/**
 * EventRemindersField — one entry's alerts. The summary is the answer to "will I hear about this", and
 * the rows are the Custom / Advanced of it: opening them starts from what is in force, and the first
 * change makes it this entry's own.
 */
export function EventRemindersField(props: EventRemindersFieldProps): JSX.Element {
	const { value, fallback, onChange } = props;
	const shown = value ?? fallback;
	const summary = shown.length > 0 ? shown.map(reminderLabel).join(", ") : "No reminders";

	return (
		<section class="evm-doc__sec" aria-label="Reminders">
			<h3 class="evm-h">Reminders</h3>
			<p class="evm-room__note">{value ? summary : `${summary} (your default)`}</p>
			<Accordion variant="flush" activeIndex={value ? 0 : -1}>
				<AccordionTab header="Custom / Advanced">
					<ReminderRows value={shown} onChange={onChange} />
					{value
						? (
							<Button
								variant="text"
								severity="secondary"
								size="sm"
								label="Use my default"
								onClick={() => onChange(null)}
							/>
						)
						: null}
				</AccordionTab>
			</Accordion>
		</section>
	);
}
