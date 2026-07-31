import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button, ToggleSwitch } from "@projective/ui/fields";
import { AutoResponseEditor } from "./AutoResponseEditor.tsx";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { settingsModalOpen } from "../core/messaging-state.ts";
import { MessagingService } from "../core/MessagingService.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type {
	AutoResponseRule,
	MessagingSettings,
	NotificationPreferences,
} from "../types/messaging-types.ts";

/**
 * MessageSettingsModal — the Message Settings modal (task §2D), opened from the inbox sidebar's Settings
 * gear (a modal, NOT a separate page). It configures auto-responses (custom automated greetings/inquiry
 * replies, ready for a future AI plug-in) and notification preferences (per-event toggles · mute-all ·
 * quiet hours). Edits a single local draft seeded from the SSR settings + the last-saved local blob;
 * Save persists optimistically (a stub until `MESSAGING_BACKEND_LIVE` owns the write).
 */

// #region Props
export interface MessageSettingsModalProps {
	initial: MessagingSettings;
}
// #endregion

/** A labelled notification toggle row. */
function SwitchRow(
	props: {
		label: string;
		hint?: string;
		value: boolean;
		onChange: (v: boolean) => void;
		disabled?: boolean;
	},
): JSX.Element {
	return (
		<div class="msg-set__row" data-disabled={props.disabled ? "true" : undefined}>
			<span class="msg-set__row-copy">
				<span class="msg-set__row-label">{props.label}</span>
				{props.hint && <span class="msg-set__row-hint">{props.hint}</span>}
			</span>
			<ToggleSwitch
				value={props.value}
				onValueChange={props.onChange}
				disabled={props.disabled}
				aria-label={props.label}
			/>
		</div>
	);
}

export function MessageSettingsModal({ initial }: MessageSettingsModalProps): JSX.Element {
	const draft = useSignal<MessagingSettings>(initial);
	const saving = useSignal(false);
	const saveError = useSignal<string | null>(null);

	// Layer the last-saved local edits over the SSR baseline (after hydration only).
	useEffect(() => {
		const raw = readStored("local", LocalKeys.MESSAGING_SETTINGS);
		if (!raw) return;
		try {
			draft.value = { ...initial, ...(JSON.parse(raw) as Partial<MessagingSettings>) };
		} catch { /* corrupt blob — keep the baseline */ }
	}, []);

	const s = draft.value;

	function patch(part: Partial<MessagingSettings>): void {
		draft.value = { ...draft.value, ...part };
	}
	function patchNotif(part: Partial<NotificationPreferences>): void {
		draft.value = { ...draft.value, notifications: { ...draft.value.notifications, ...part } };
	}
	function setRules(autoResponses: AutoResponseRule[]): void {
		patch({ autoResponses });
	}

	/**
	 * Persist locally, then await the service. The result was previously discarded (`void`) and the
	 * modal closed regardless — so a failed save looked exactly like a successful one. Now the modal
	 * stays open on failure and says so; the local write still stands, so nothing the viewer typed is
	 * lost either way.
	 */
	async function save(): Promise<void> {
		saving.value = true;
		saveError.value = null;
		writeStored("local", LocalKeys.MESSAGING_SETTINGS, JSON.stringify(draft.value));
		const res = await MessagingService.saveSettings(draft.value);
		saving.value = false;
		if (!res.ok) {
			saveError.value = res.message ??
				"Couldn't save to your account. These settings are kept on this device for now.";
			return;
		}
		settingsModalOpen.value = false;
	}

	const n = s.notifications;

	return (
		<Dialog
			visible={settingsModalOpen}
			header="Message settings"
			width="34rem"
			class="msg-set"
		>
			<div class="msg-set__body">
				{/* Auto-responses. */}
				<section class="msg-set__section">
					<div class="msg-set__section-head">
						<div class="msg-set__section-title">
							<MessagingIcon name="robot" />
							<span>Auto-responses</span>
						</div>
						<ToggleSwitch
							value={s.autoResponsesEnabled}
							onValueChange={(autoResponsesEnabled) => patch({ autoResponsesEnabled })}
							aria-label="Enable auto-responses"
						/>
					</div>
					<p class="msg-set__section-note">
						Automatically greet incoming inquiries about your services or products. Rules only fire
						while this switch is on.
					</p>
					<div class="msg-set__ar" data-off={!s.autoResponsesEnabled ? "true" : undefined}>
						<AutoResponseEditor rules={s.autoResponses} onChange={setRules} />
					</div>
				</section>

				{/* Notifications. */}
				<section class="msg-set__section">
					<div class="msg-set__section-title">
						<MessagingIcon name="bell" />
						<span>Notifications</span>
					</div>
					<SwitchRow
						label="Mute all"
						hint="Silence every message notification"
						value={n.muteAll}
						onChange={(muteAll) => patchNotif({ muteAll })}
					/>
					<SwitchRow
						label="New messages"
						value={n.newMessage}
						disabled={n.muteAll}
						onChange={(newMessage) => patchNotif({ newMessage })}
					/>
					<SwitchRow
						label="Mentions"
						value={n.mentions}
						disabled={n.muteAll}
						onChange={(mentions) => patchNotif({ mentions })}
					/>
					<SwitchRow
						label="Group activity"
						value={n.groupActivity}
						disabled={n.muteAll}
						onChange={(groupActivity) => patchNotif({ groupActivity })}
					/>
					<SwitchRow
						label="Service inquiries"
						value={n.serviceInquiries}
						disabled={n.muteAll}
						onChange={(serviceInquiries) => patchNotif({ serviceInquiries })}
					/>
					<SwitchRow
						label="Sound"
						value={n.sound}
						disabled={n.muteAll}
						onChange={(sound) => patchNotif({ sound })}
					/>
					<SwitchRow
						label="Quiet hours"
						hint="Pause notifications on a schedule"
						value={n.quietHoursEnabled}
						disabled={n.muteAll}
						onChange={(quietHoursEnabled) => patchNotif({ quietHoursEnabled })}
					/>
					{n.quietHoursEnabled && !n.muteAll && (
						<div class="msg-set__quiet">
							<label class="msg-set__quiet-field">
								<span>From</span>
								<input
									type="time"
									value={n.quietStart}
									aria-label="Quiet hours start"
									onInput={(e) => patchNotif({ quietStart: (e.target as HTMLInputElement).value })}
								/>
							</label>
							<label class="msg-set__quiet-field">
								<span>To</span>
								<input
									type="time"
									value={n.quietEnd}
									aria-label="Quiet hours end"
									onInput={(e) => patchNotif({ quietEnd: (e.target as HTMLInputElement).value })}
								/>
							</label>
						</div>
					)}
				</section>

				{/* Privacy. */}
				<section class="msg-set__section">
					<div class="msg-set__section-title">
						<MessagingIcon name="settings" />
						<span>Privacy</span>
					</div>
					<SwitchRow
						label="Read receipts"
						hint="Let others see when you've read their message"
						value={s.readReceipts}
						onChange={(readReceipts) => patch({ readReceipts })}
					/>
					<SwitchRow
						label="Typing indicator"
						hint="Show others when you're typing"
						value={s.showTypingIndicator}
						onChange={(showTypingIndicator) => patch({ showTypingIndicator })}
					/>
				</section>
			</div>

			{saveError.value && <p class="msg-set__error" role="alert">{saveError.value}</p>}

			<div class="msg-set__actions">
				<Button
					label="Cancel"
					variant="text"
					severity="secondary"
					disabled={saving.value}
					onClick={() => (settingsModalOpen.value = false)}
				/>
				<Button label="Save settings" loading={saving.value} onClick={() => void save()} />
			</div>
		</Dialog>
	);
}
