import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { SelectButton, ToggleSwitch } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type {
	ProfileSavePatch,
	ProfileSettings,
	ProfileVisibility,
} from "@projective/types/profile";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { ProfileService } from "@features/profile/core/ProfileService.ts";
import {
	IDLE,
	OutLink,
	type SaveState,
	SaveStatus,
	SectionHead,
	SettingsBlock,
	SettingsRow,
	useSynced,
} from "../SettingsParts.tsx";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Profile (Decision #150): who can find the profile and what its public page shows — the
 * same four switches the profile editor carries, saved through the editor's OWN route
 * (`POST /api/profile/[handle]/save`, `org.save_profile`), so there is one write path and the two
 * surfaces cannot disagree. Everything else about the profile (story, skills, showcase) stays in the
 * editor, which this section links to.
 */

const VISIBILITY_OPTIONS = [
	{ label: "Public", value: "public" },
	{ label: "Unlisted", value: "unlisted" },
	{ label: "Private", value: "private" },
];

const VISIBILITY_COPY: Readonly<Record<ProfileVisibility, string>> = {
	public: "Listed in Explore and search. Anyone can open it.",
	unlisted: "Hidden from Explore and search; anyone with your link can open it.",
	private: "Only you can see your profile.",
};

function Switch(
	props: {
		label: string;
		value: boolean;
		disabled: boolean;
		onChange: (on: boolean) => void;
		descId: string;
	},
): JSX.Element {
	const sig = useSynced(props.value);
	return (
		<ToggleSwitch
			value={sig}
			disabled={props.disabled}
			aria-label={props.label}
			aria-describedby={props.descId}
			onValueChange={props.onChange}
		/>
	);
}

export interface ProfileSectionProps {
	data: SettingsSectionDataOf<"profile">;
}

export function ProfileSection(props: ProfileSectionProps): JSX.Element {
	const meta = sectionMeta("profile");
	const visibility = useSignal<ProfileVisibility | null>(props.data.visibility);
	const settings = useSignal<ProfileSettings | null>(props.data.settings);
	const status = useSignal<SaveState>(IDLE);
	const handle = props.data.handle;
	const visibilityBound = useSynced<string>(visibility.value ?? "public");

	if (!handle || !visibility.value || !settings.value) {
		return (
			<div class="stg-section">
				<SectionHead title={meta.label} description={meta.description} />
				<InlineNotice align="start" text="Your profile settings couldn't be loaded just now." />
				{handle ? <OutLink href={`/${handle}/edit`}>Open the profile editor</OutLink> : null}
			</div>
		);
	}

	async function save(patch: ProfileSavePatch, revert: () => void): Promise<void> {
		status.value = { tone: "busy", text: "Saving…" };
		const res = await ProfileService.save(handle!, patch);
		if (res.ok && res.data) {
			visibility.value = res.data.model.visibility;
			settings.value = res.data.model.settings;
			status.value = { tone: "saved", text: "Saved." };
		} else {
			revert();
			status.value = { tone: "error", text: res.message ?? "Your profile couldn't be saved." };
		}
	}

	function setVisibility(next: ProfileVisibility): void {
		const before = visibility.peek();
		visibility.value = next;
		save({ visibility: next }, () => (visibility.value = before));
	}

	function setSwitch(key: keyof ProfileSettings, on: boolean): void {
		const before = settings.peek();
		settings.value = { ...before!, [key]: on };
		save({ settings: { [key]: on } }, () => (settings.value = before));
	}

	const s = settings.value;
	const busy = status.value.tone === "busy";

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock anchor="visibility" title="Discovery visibility">
				<SettingsRow
					label="Who can find you"
					descId="stg-visibility-desc"
					description={VISIBILITY_COPY[visibility.value]}
					control={
						<SelectButton
							options={VISIBILITY_OPTIONS}
							value={visibilityBound}
							disabled={busy}
							aria-label="Profile visibility"
							aria-describedby="stg-visibility-desc"
							onValueChange={(next) => setVisibility(next as ProfileVisibility)}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock anchor="local-time" title="Local time & location">
				<SettingsRow
					label="Show my local time"
					descId="stg-localtime-desc"
					description="A live clock beside your availability, so clients know if it's a good time."
					control={
						<Switch
							label="Show my local time"
							descId="stg-localtime-desc"
							value={s.showLocalTime}
							disabled={busy}
							onChange={(on) => setSwitch("showLocalTime", on)}
						/>
					}
				/>
				<SettingsRow
					label="Show my city"
					descId="stg-location-desc"
					description="Your city and country under your name."
					control={
						<Switch
							label="Show my city"
							descId="stg-location-desc"
							value={s.showLocation}
							disabled={busy}
							onChange={(on) => setSwitch("showLocation", on)}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock anchor="photo" title="Photo zoom">
				<SettingsRow
					label="Let visitors open my photo full size"
					descId="stg-photo-desc"
					description="Off keeps your photo at the size it's shown on the page."
					control={
						<Switch
							label="Let visitors open my photo full size"
							descId="stg-photo-desc"
							value={s.allowAvatarExpand}
							disabled={busy}
							onChange={(on) => setSwitch("allowAvatarExpand", on)}
						/>
					}
				/>
			</SettingsBlock>

			<OutLink href={`/${handle}/edit`}>Edit your public profile</OutLink>
			<SaveStatus state={status.value} />
		</div>
	);
}
