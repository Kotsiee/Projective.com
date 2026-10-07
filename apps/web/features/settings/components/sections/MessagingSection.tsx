import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { ToggleSwitch } from "@projective/ui/fields";
import type { MessagingSettings } from "@projective/types/messaging";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { AutoResponseEditor } from "@features/messaging/components/AutoResponseEditor.tsx";
import { MessagingService } from "@features/messaging/core/MessagingService.ts";
import {
	FormFooter,
	IDLE,
	type SaveState,
	SectionHead,
	SettingsBlock,
	SettingsRow,
	useSectionDraft,
	useSynced,
} from "../SettingsParts.tsx";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Messaging (Decision #150) — the former inbox "Message settings" modal, now a section of
 * the one Settings engine: read receipts and typing, the message alerts and chat sound, and away
 * replies. Saved together with an explicit Save (`POST /api/messaging/settings`, live), because the
 * auto-reply editor is a form, and its draft survives "Expand to full page".
 *
 * Quiet hours and "mute all" are NOT here: both are the platform-wide snooze and quiet window
 * (`comms.notification_prefs`), owned by Notifications. Two editors for one column is how they come to
 * disagree, so this section links there instead and sends those fields back exactly as it read them.
 */

/** A labelled switch bound to the draft (synced, so Discard redraws it). */
function DraftSwitch(
	props: {
		label: string;
		description?: string;
		value: boolean;
		disabled?: boolean;
		onChange: (on: boolean) => void;
	},
): JSX.Element {
	const sig = useSynced(props.value);
	const descId = `stg-msg-${props.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
	return (
		<SettingsRow
			label={props.label}
			descId={props.description ? descId : undefined}
			description={props.description}
			control={
				<ToggleSwitch
					value={sig}
					disabled={props.disabled}
					aria-label={props.label}
					aria-describedby={props.description ? descId : undefined}
					onValueChange={props.onChange}
				/>
			}
		/>
	);
}

export interface MessagingSectionProps {
	data: SettingsSectionDataOf<"messaging">;
	/** Move to another section in place (the modal) — the page navigates instead. */
	onOpenSection?: (section: "notifications", anchor: string) => void;
}

export function MessagingSection(props: MessagingSectionProps): JSX.Element {
	const meta = sectionMeta("messaging");
	const saved = useSignal<MessagingSettings>(props.data.settings);
	const { draft, dirty, set, clear } = useSectionDraft<MessagingSettings>("messaging", saved.value);
	const busy = useSignal(false);
	const status = useSignal<SaveState>(IDLE);

	const s = draft.value;
	const n = s.notifications;
	const patch = (part: Partial<MessagingSettings>) => set({ ...draft.peek(), ...part });
	const patchAlerts = (part: Partial<MessagingSettings["notifications"]>) =>
		set({ ...draft.peek(), notifications: { ...draft.peek().notifications, ...part } });

	async function save(): Promise<void> {
		busy.value = true;
		status.value = { tone: "busy", text: "Saving…" };
		const res = await MessagingService.saveSettings(draft.peek());
		busy.value = false;
		if (!res.ok) {
			status.value = {
				tone: "error",
				text: res.message ?? "Your messaging settings couldn't be saved.",
			};
			return;
		}
		const stored = res.data?.settings ?? draft.peek();
		saved.value = stored;
		clear(stored);
		status.value = { tone: "saved", text: "Saved." };
	}

	const notificationsHref = "/settings/notifications#quiet-hours";

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock
				anchor="message-privacy"
				title="Read receipts & typing"
				description="What other people see while you read and write."
			>
				<DraftSwitch
					label="Read receipts"
					description="Let others see when you've read their message. Turning this off also hides theirs from you."
					value={s.readReceipts}
					onChange={(readReceipts) => patch({ readReceipts })}
				/>
				<DraftSwitch
					label="Typing indicator"
					description="Show others when you're writing a reply."
					value={s.showTypingIndicator}
					onChange={(showTypingIndicator) => patch({ showTypingIndicator })}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="message-alerts"
				title="Message alerts & sounds"
				description="Which messages notify you in Projective."
			>
				<DraftSwitch
					label="New messages"
					value={n.newMessage}
					onChange={(newMessage) => patchAlerts({ newMessage })}
				/>
				<DraftSwitch
					label="Mentions"
					description="When someone @mentions you in a group or project."
					value={n.mentions}
					onChange={(mentions) => patchAlerts({ mentions })}
				/>
				<DraftSwitch
					label="Group activity and service inquiries"
					description="Replies in groups you're in, and new questions about your services."
					value={n.groupActivity || n.serviceInquiries}
					onChange={(on) => patchAlerts({ groupActivity: on, serviceInquiries: on })}
				/>
				<DraftSwitch
					label="Chat sound"
					description="Play a sound when a message arrives while you're here."
					value={n.sound}
					onChange={(sound) => patchAlerts({ sound })}
				/>
				<p class="stg-note">
					Quiet hours and pausing apply to every kind of alert, so they live in{" "}
					<a
						href={notificationsHref}
						onClick={(event) => {
							if (!props.onOpenSection) return;
							event.preventDefault();
							props.onOpenSection("notifications", "quiet-hours");
						}}
					>
						Notifications
					</a>.
				</p>
			</SettingsBlock>

			<SettingsBlock
				anchor="auto-responses"
				title="Away replies"
				description="Greet new inquiries automatically — for example while you're out of office. Rules only run while this is on."
			>
				<DraftSwitch
					label="Send away replies"
					value={s.autoResponsesEnabled}
					onChange={(autoResponsesEnabled) => patch({ autoResponsesEnabled })}
				/>
				<div
					class="stg-subform"
					data-off={s.autoResponsesEnabled ? undefined : "true"}
					inert={!s.autoResponsesEnabled}
				>
					<AutoResponseEditor
						rules={s.autoResponses}
						onChange={(autoResponses) => patch({ autoResponses })}
					/>
				</div>
			</SettingsBlock>

			<FormFooter
				dirty={dirty}
				busy={busy.value}
				state={status.value}
				onSave={save}
				onDiscard={() => {
					clear(saved.peek());
					status.value = IDLE;
				}}
			/>
		</div>
	);
}
