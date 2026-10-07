import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Select, SelectButton, ToggleSwitch } from "@projective/ui/fields";
import type { AppearancePreferences, CvdPreference, ThemeChoice } from "@projective/types/org";
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
import {
	commitAppearance,
	currentAppearance,
	paintAppearance,
	persistOverlaysOnDevice,
} from "../../core/appearance-state.ts";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Appearance (Decision #150): the theme choice and the four accessibility overlays
 * (DESIGN_SYSTEM §A.5). Every control applies on THIS device in the same frame — the page repaints as
 * the switch moves — then writes the `pj.a11y` cookie and the localStorage copy, then the account.
 * The status line says where it landed.
 */

const THEME_OPTIONS = [
	{ label: "System", value: "system" },
	{ label: "Light", value: "light" },
	{ label: "Dark", value: "dark" },
];

const CVD_OPTIONS = [
	{ label: "No adjustment", value: "none" },
	{ label: "Red-weak (protanopia)", value: "protan" },
	{ label: "Green-weak (deuteranopia)", value: "deutan" },
	{ label: "Blue-weak (tritanopia)", value: "tritan" },
];

export interface AppearanceSectionProps {
	data: SettingsSectionDataOf<"appearance">;
}

export function AppearanceSection(props: AppearanceSectionProps): JSX.Element {
	const meta = sectionMeta("appearance");
	const look = useSignal<AppearancePreferences>(props.data.appearance);
	const status = useSignal<SaveState>(IDLE);

	// The account copy of the OVERLAYS is authoritative across devices: when it differs from what this
	// device is painted with (another device changed it), adopt it rather than overwrite it. The THEME
	// stays this device's own — it is also switched from the header, which only ever wrote the device
	// (Decision #149(F)), and silently reverting someone's dark mode on opening Settings would be worse.
	useEffect(() => {
		const device = currentAppearance();
		const next = props.data.live ? { ...props.data.appearance, theme: device.theme } : device;
		if (JSON.stringify(device) !== JSON.stringify(next)) {
			paintAppearance(next);
			persistOverlaysOnDevice(next);
		}
		look.value = next;
	}, [props.data]);

	async function change(patch: Partial<AppearancePreferences>): Promise<void> {
		look.value = { ...look.value, ...patch };
		status.value = { tone: "busy", text: "Saving…" };
		const res = await commitAppearance(patch);
		look.value = res.appearance;
		status.value = res.saved === "account"
			? { tone: "saved", text: "Saved to your account." }
			: res.saved === "device"
			? { tone: "device", text: "Saved on this device. We couldn't reach your account just now." }
			: {
				tone: "error",
				text: `Applied on this device only — ${res.message ?? "your account couldn't be updated."}`,
			};
	}

	const v = look.value;
	const theme = useSynced<string>(v.theme);
	const contrast = useSynced(v.contrast === "high");
	const font = useSynced(v.font === "dyslexic");
	const cvd = useSynced<string>(v.cvd);
	const motion = useSynced(v.motion === "reduced");
	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock
				anchor="theme"
				title="Theme"
				description="Choose a colour scheme, or follow your device's setting."
			>
				<SettingsRow
					label="Colour scheme"
					labelId="stg-theme-label"
					description="System switches with your device, including a scheduled dark mode."
					control={
						<SelectButton
							options={THEME_OPTIONS}
							value={theme}
							aria-label="Colour scheme"
							onValueChange={(next) => change({ theme: next as ThemeChoice })}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="contrast"
				title="Contrast"
				description="Off follows your device's contrast setting."
			>
				<SettingsRow
					label="High contrast"
					labelId="stg-contrast-label"
					descId="stg-contrast-desc"
					description="Darker text, stronger outlines and AAA (7:1) contrast everywhere."
					control={
						<ToggleSwitch
							value={contrast}
							aria-label="High contrast"
							aria-describedby="stg-contrast-desc"
							onValueChange={(on) => change({ contrast: on ? "high" : "standard" })}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock anchor="font" title="Reading font">
				<SettingsRow
					label="Dyslexia-friendly font"
					descId="stg-font-desc"
					description="Shows all text in OpenDyslexic, with wider spacing and shorter lines."
					control={
						<ToggleSwitch
							value={font}
							aria-label="Dyslexia-friendly font"
							aria-describedby="stg-font-desc"
							onValueChange={(on) => change({ font: on ? "dyslexic" : "sans" })}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock anchor="colour-vision" title="Colour vision">
				<SettingsRow
					label="Colour adjustment"
					descId="stg-cvd-desc"
					description="Adjusts the colours in calendars, timelines and workspace charts. Statuses always have an icon or label too."
					control={
						<Select
							options={CVD_OPTIONS}
							value={cvd}
							aria-label="Colour adjustment"
							aria-describedby="stg-cvd-desc"
							onValueChange={(next) => change({ cvd: next as CvdPreference })}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="motion"
				title="Motion"
				description="Off follows your device's reduce-motion setting."
			>
				<SettingsRow
					label="Reduce motion"
					descId="stg-motion-desc"
					description="Turns off animations and transitions. Things appear in their final place."
					control={
						<ToggleSwitch
							value={motion}
							aria-label="Reduce motion"
							aria-describedby="stg-motion-desc"
							onValueChange={(on) => change({ motion: on ? "reduced" : "standard" })}
						/>
					}
				/>
			</SettingsBlock>

			<SaveStatus state={status.value} />
		</div>
	);
}
