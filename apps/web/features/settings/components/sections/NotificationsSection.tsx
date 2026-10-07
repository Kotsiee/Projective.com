import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, Select, TimeTumbler, ToggleSwitch } from "@projective/ui/fields";
import { InlineNotice, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	type NotificationCategory,
	type NotificationCenter,
	type NotificationCenterUpdate,
	PERSONAL_CHANNELS,
	type PersonalChannel,
} from "@projective/types/comms";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SectionHead,
	SettingsBlock,
	SettingsRow,
	useSynced,
} from "../SettingsParts.tsx";
import { SettingsService } from "../../core/SettingsService.ts";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Notifications (Decision #150; PRODUCT_SPEC §Notifications): the four channel masters,
 * the 8-category × 4-channel routing matrix, the required alerts no preference can silence, quiet
 * hours and the global snooze. Every change saves at once (`PUT /api/user/notifications`) and is
 * reverted with the server's sentence if it is refused.
 *
 * How the router reads these (`comms.fn_resolve_channels`): a category cell OUTRANKS its channel's
 * master (`COALESCE(category, global)`), so turning a master on or off also resets that column's
 * cells — the master then means what it says. Mandatory catalog events ignore all of it; they are
 * drawn as locked rows, never as switches that would look like they could stop them.
 */

// #region Vocabulary
const CHANNEL_LABEL: Readonly<Record<PersonalChannel, string>> = {
	in_app: "In-app",
	push: "Push",
	email: "Email",
	sms: "Text",
};

const CHANNEL_DESC: Readonly<Record<PersonalChannel, string>> = {
	in_app: "Your inbox on Projective — always real time.",
	push: "Alerts on devices where you've allowed notifications.",
	email: "Sent to your primary email address.",
	sms: "Nothing is sent by text message yet — this choice applies once text alerts launch.",
};

const CATEGORY_LABEL: Readonly<Record<NotificationCategory, string>> = {
	money: "Money",
	work: "Work",
	messages: "Messages",
	schedule: "Schedule",
	discovery: "Discovery",
	account: "Account",
	system: "System",
	marketing: "Marketing",
};

const CATEGORY_DESC: Readonly<Record<NotificationCategory, string>> = {
	money: "Payments, escrow, payouts and invoices",
	work: "Projects, stages, tickets and reviews",
	messages: "Direct messages, mentions and replies",
	schedule: "Calls, sessions and reminders",
	discovery: "Requests, invitations and new matches",
	account: "Sign-ins, verification and security",
	system: "Service notices and policy changes",
	marketing: "News, tips and offers from Projective",
};

/** The prefs key for each channel. */
const PREF_KEY: Readonly<Record<PersonalChannel, "inApp" | "push" | "email" | "sms">> = {
	in_app: "inApp",
	push: "push",
	email: "email",
	sms: "sms",
};

const REQUIRED_NOTE = "Required for financial and account security.";

const SNOOZE_OPTIONS = [
	{ label: "Not paused", value: "off" },
	{ label: "For 1 hour", value: "1h" },
	{ label: "For 8 hours", value: "8h" },
	{ label: "For 24 hours", value: "24h" },
	{ label: "For a week", value: "7d" },
];

const SNOOZE_MS: Readonly<Record<string, number>> = {
	"1h": 3_600_000,
	"8h": 8 * 3_600_000,
	"24h": 24 * 3_600_000,
	"7d": 7 * 24 * 3_600_000,
};
// #endregion

// #region Helpers
function minutesOf(time: string | null, fallback: number): number {
	if (!time) return fallback;
	const [h, m] = time.split(":").map(Number);
	return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : fallback;
}

function clockOf(minutes: number): string {
	const h = Math.floor(minutes / 60) % 24;
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function deviceZone(): string | null {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
	} catch {
		return null;
	}
}

/**
 * "Tue 14:00" for a snooze end. Messaging's "Mute all" stores an indefinite pause as a far-future
 * instant (`live-settings-write.ts`), which reads as "until you resume", never as a year.
 */
function untilLabel(iso: string): string {
	if (new Date(iso).getUTCFullYear() >= 9000) return "you resume";
	try {
		return new Intl.DateTimeFormat(undefined, {
			weekday: "short",
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}
// #endregion

// #region Cells
/** One matrix switch, bound to a synced signal so a revert or a master reset is drawn. */
function Cell(
	props: { value: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void },
): JSX.Element {
	const sig = useSynced(props.value);
	return (
		<ToggleSwitch
			size="sm"
			value={sig}
			disabled={props.disabled}
			aria-label={props.label}
			onValueChange={props.onChange}
		/>
	);
}
// #endregion

export interface NotificationsSectionProps {
	data: SettingsSectionDataOf<"notifications">;
}

export function NotificationsSection(props: NotificationsSectionProps): JSX.Element {
	const meta = sectionMeta("notifications");
	const center = useSignal<NotificationCenter | null>(props.data.center);
	const status = useSignal<SaveState>(IDLE);
	const c = center.value;

	const quietOn = useSynced(c?.prefs.quietHoursEnabled ?? false);
	const quietStart = useSynced(minutesOf(c?.prefs.quietHoursStart ?? null, 22 * 60));
	const quietEnd = useSynced(minutesOf(c?.prefs.quietHoursEnd ?? null, 7 * 60));
	const snoozeActive = c?.prefs.mutedUntil && Date.parse(c.prefs.mutedUntil) > Date.now()
		? c.prefs.mutedUntil
		: null;
	const snooze = useSynced<string>(snoozeActive ? "custom" : "off");

	if (!c) {
		return (
			<div class="stg-section">
				<SectionHead title={meta.label} description={meta.description} />
				<InlineNotice
					align="start"
					assertive
					text="Your notification settings couldn't be loaded just now."
				/>
			</div>
		);
	}

	/** Apply `optimistic` at once, send `update`, and keep the server's answer or roll back. */
	async function save(
		update: NotificationCenterUpdate,
		optimistic: NotificationCenter,
	): Promise<void> {
		const before = center.peek();
		center.value = optimistic;
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.saveNotifications(update);
		if (res.ok) {
			center.value = res.data.center;
			status.value = { tone: "saved", text: "Saved." };
		} else {
			center.value = before;
			status.value = { tone: "error", text: res.message };
		}
	}

	const locked = !c.live;
	const requiredOf = (category: NotificationCategory) =>
		c.required.find((r) => r.category === category);
	const fullyRequired = (category: NotificationCategory) => {
		const r = requiredOf(category);
		return !!r && r.total > 0 && r.mandatory === r.total;
	};
	const effective = (category: NotificationCategory, channel: PersonalChannel): boolean => {
		const row = c.categories.find((x) => x.category === category);
		const own = row ? row[PREF_KEY[channel]] : null;
		return own ?? c.prefs[PREF_KEY[channel]];
	};

	function setMaster(channel: PersonalChannel, on: boolean): void {
		const key = PREF_KEY[channel];
		save(
			{ prefs: { [key]: on }, resetChannels: [channel] },
			{
				...c!,
				prefs: { ...c!.prefs, [key]: on },
				categories: c!.categories.map((row) => ({ ...row, [key]: null })),
			},
		);
	}

	function setCell(category: NotificationCategory, channel: PersonalChannel, on: boolean): void {
		const key = PREF_KEY[channel];
		save(
			{ categories: [{ category, [key]: on }] },
			{
				...c!,
				categories: c!.categories.map((row) =>
					row.category === category ? { ...row, [key]: on } : row
				),
			},
		);
	}

	function setQuiet(enabled: boolean, start: number, end: number): void {
		const prefs = {
			quietHoursEnabled: enabled,
			quietHoursStart: clockOf(start),
			quietHoursEnd: clockOf(end),
		};
		save({ prefs }, { ...c!, prefs: { ...c!.prefs, ...prefs } });
	}

	function setSnooze(choice: string): void {
		const mutedUntil = choice === "off"
			? null
			: new Date(Date.now() + (SNOOZE_MS[choice] ?? 0)).toISOString();
		save({ prefs: { mutedUntil } }, { ...c!, prefs: { ...c!.prefs, mutedUntil } });
	}

	const zone = deviceZone();
	const required = c.required.filter((r) => r.mandatory > 0);

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			{locked
				? (
					<InlineNotice
						align="start"
						text="We couldn't load your saved notification settings, so these are the defaults and can't be changed right now."
					/>
				)
				: null}

			<SettingsBlock
				anchor="channels"
				title="Channels"
				description="Where alerts can reach you. Turning one on or off applies it to every category below."
			>
				{PERSONAL_CHANNELS.map((channel) => (
					<SettingsRow
						key={channel}
						label={CHANNEL_LABEL[channel]}
						descId={`stg-channel-${channel}-desc`}
						description={CHANNEL_DESC[channel]}
						control={
							<Cell
								value={c.prefs[PREF_KEY[channel]]}
								label={`${CHANNEL_LABEL[channel]} notifications`}
								disabled={locked}
								onChange={(on) => setMaster(channel, on)}
							/>
						}
					/>
				))}
			</SettingsBlock>

			<SettingsBlock
				anchor="routing"
				title="What you hear about"
				description="Fine-tune each kind of alert. A change here overrides the channel above for that row."
			>
				<div class="stg-matrix-scroll">
					<table class="stg-matrix">
						<caption class="ui-visually-hidden">Notification channels for each category</caption>
						<thead>
							<tr>
								<th scope="col" class="stg-matrix__corner">Category</th>
								{PERSONAL_CHANNELS.map((channel) => (
									<th key={channel} scope="col">{CHANNEL_LABEL[channel]}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{c.categories.map((row) => {
								const all = fullyRequired(row.category);
								const r = requiredOf(row.category);
								return (
									<tr key={row.category} class={all ? "stg-matrix__row--locked" : undefined}>
										<th scope="row">
											<span class="stg-matrix__cat">
												{all
													? (
														<Tooltip content={REQUIRED_NOTE} placement="top">
															<span
																class="stg-matrix__lock"
																tabIndex={0}
																aria-label={`${CATEGORY_LABEL[row.category]}: ${REQUIRED_NOTE}`}
															>
																<Icon name="lock" size="xs" aria-hidden="true" />
															</span>
														</Tooltip>
													)
													: null}
												{CATEGORY_LABEL[row.category]}
											</span>
											<span class="stg-matrix__desc">
												{all ? REQUIRED_NOTE : CATEGORY_DESC[row.category]}
											</span>
										</th>
										{PERSONAL_CHANNELS.map((channel) => (
											<td key={channel}>
												{all
													? (
														<Cell
															value={r?.channels.includes(channel) ?? false}
															label={`${CATEGORY_LABEL[row.category]} — ${
																CHANNEL_LABEL[channel]
															} (required)`}
															disabled
															onChange={() => {}}
														/>
													)
													: (
														<Cell
															value={effective(row.category, channel)}
															label={`${CATEGORY_LABEL[row.category]} — ${CHANNEL_LABEL[channel]}`}
															disabled={locked}
															onChange={(on) => setCell(row.category, channel, on)}
														/>
													)}
											</td>
										))}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</SettingsBlock>

			{required.length > 0
				? (
					<SettingsBlock
						anchor="required-alerts"
						title="Always on"
						description="These alerts protect your money and your account, so they can't be turned off."
					>
						{required.map((r) => (
							<SettingsRow
								key={r.category}
								locked
								label={`${CATEGORY_LABEL[r.category]} — ${r.mandatory} required ${
									r.mandatory === 1 ? "alert" : "alerts"
								}`}
								descId={`stg-required-${r.category}-desc`}
								description={`${REQUIRED_NOTE} Sent by ${
									r.channels.map((ch) => CHANNEL_LABEL[ch].toLowerCase()).join(", ")
								}.`}
								control={
									<Tooltip content={REQUIRED_NOTE} placement="top">
										<span class="stg-locked-control">
											<Cell
												value
												label={`${CATEGORY_LABEL[r.category]} required alerts (always on)`}
												disabled
												onChange={() => {}}
											/>
										</span>
									</Tooltip>
								}
							/>
						))}
					</SettingsBlock>
				)
				: null}

			<SettingsBlock
				anchor="quiet-hours"
				title="Quiet hours"
				description={`Push and text alerts wait until morning; your inbox and email still arrive. Times are in ${c.prefs.timezone}.`}
			>
				<SettingsRow
					label="Quiet hours"
					descId="stg-quiet-desc"
					description="A few urgent alerts, like a session about to start, still come through."
					control={
						<ToggleSwitch
							value={quietOn}
							disabled={locked}
							aria-label="Quiet hours"
							aria-describedby="stg-quiet-desc"
							onValueChange={(on) => setQuiet(on, quietStart.peek(), quietEnd.peek())}
						/>
					}
				/>
				{c.prefs.quietHoursEnabled
					? (
						<div class="stg-inline-fields">
							<label class="stg-field">
								<span class="stg-field__label">From</span>
								<TimeTumbler
									value={quietStart}
									minuteStep={15}
									disabled={locked}
									aria-label="Quiet hours start"
									onValueChange={(m) => setQuiet(true, m, quietEnd.peek())}
								/>
							</label>
							<label class="stg-field">
								<span class="stg-field__label">Until</span>
								<TimeTumbler
									value={quietEnd}
									minuteStep={15}
									disabled={locked}
									aria-label="Quiet hours end"
									onValueChange={(m) => setQuiet(true, quietStart.peek(), m)}
								/>
							</label>
						</div>
					)
					: null}
				{zone && zone !== c.prefs.timezone && !locked
					? (
						<Button
							variant="text"
							size="sm"
							label={`Use this device's time zone (${zone})`}
							onClick={() =>
								save({ prefs: { timezone: zone } }, {
									...c,
									prefs: { ...c.prefs, timezone: zone },
								})}
						/>
					)
					: null}
			</SettingsBlock>

			<SettingsBlock
				anchor="snooze"
				title="Pause notifications"
				description="Holds everything except critical and required alerts."
			>
				<SettingsRow
					label={snoozeActive ? `Paused until ${untilLabel(snoozeActive)}` : "Pause"}
					descId="stg-snooze-desc"
					description={snoozeActive
						? "Alerts that arrive meanwhile wait in your inbox."
						: "Choose how long to pause for."}
					control={snoozeActive
						? (
							<Button
								variant="outlined"
								size="sm"
								label="Resume now"
								disabled={locked}
								onClick={() => setSnooze("off")}
							/>
						)
						: (
							<Select
								options={SNOOZE_OPTIONS}
								value={snooze}
								disabled={locked}
								aria-label="Pause notifications"
								aria-describedby="stg-snooze-desc"
								onValueChange={(choice) => setSnooze(choice)}
							/>
						)}
				/>
			</SettingsBlock>

			<SaveStatus state={status.value} />
		</div>
	);
}
