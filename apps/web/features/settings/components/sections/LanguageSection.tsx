import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Select, SelectButton } from "@projective/ui/fields";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import type { DisplayPreferences, LayoutDirection } from "@projective/types/org";
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
import { applyDirection } from "../../core/appearance-state.ts";
import { sectionMeta } from "../../core/settings-registry.ts";
import { commitDisplayCurrency } from "@features/shell/core/currency-state.ts";

/**
 * Settings → Language & region (Decision #150): the formatting locale, the display currency (Decision
 * #149(a) asked for it to come back somewhere outside the wallet — this is that place), and the
 * document direction. Each saves at once.
 *
 * - The **currency** goes through the shell's own `commitDisplayCurrency`, the same end-to-end setter
 *   the wallet and checkout use (store → cookie → re-projected figures → account), so every price on
 *   the page changes as the menu closes.
 * - The **locale** is stamped into the session (the access-token hook reads it), so after saving the
 *   session is renewed and the new format applies from the next page.
 * - The **direction** applies on this device at once and travels in the `pj.a11y` cookie, so the next
 *   page is laid out the same way from its first paint.
 */

// #region Options
/** Formatting locales offered. The interface itself is in English for now; this formats numbers and dates. */
const LOCALES = [
	{ value: "en-GB", label: "English (United Kingdom)" },
	{ value: "en-US", label: "English (United States)" },
	{ value: "en-CA", label: "English (Canada)" },
	{ value: "en-AU", label: "English (Australia)" },
	{ value: "en-IN", label: "English (India)" },
	{ value: "fr-FR", label: "Français (France)" },
	{ value: "de-DE", label: "Deutsch (Deutschland)" },
	{ value: "es-ES", label: "Español (España)" },
	{ value: "it-IT", label: "Italiano (Italia)" },
	{ value: "nl-NL", label: "Nederlands (Nederland)" },
	{ value: "pt-PT", label: "Português (Portugal)" },
	{ value: "pt-BR", label: "Português (Brasil)" },
	{ value: "ar-AE", label: "العربية (الإمارات)" },
	{ value: "ja-JP", label: "日本語 (日本)" },
];

const DIRECTIONS = [
	{ value: "auto", label: "Automatic" },
	{ value: "ltr", label: "Left to right" },
	{ value: "rtl", label: "Right to left" },
];

function sample(locale: string, currency: string): string {
	try {
		const money = new Intl.NumberFormat(locale, { style: "currency", currency }).format(1234.5);
		const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
			new Date(Date.UTC(2026, 9, 6)),
		);
		return `${money} · ${date}`;
	} catch {
		return "";
	}
}
// #endregion

export interface LanguageSectionProps {
	data: SettingsSectionDataOf<"language">;
}

export function LanguageSection(props: LanguageSectionProps): JSX.Element {
	const meta = sectionMeta("language");
	const prefs = useSignal<DisplayPreferences>(props.data.preferences);
	const status = useSignal<SaveState>(IDLE);

	// The account's direction wins over a stale device copy, exactly like the overlays do.
	useEffect(() => {
		const current = document.documentElement.getAttribute("dir") ?? "auto";
		if (current !== props.data.preferences.layoutDirection) {
			applyDirection(props.data.preferences.layoutDirection);
		}
	}, [props.data]);

	const p = prefs.value;
	const locale = useSynced<string>(p.locale);
	const currency = useSynced<string>(p.displayCurrency);
	const direction = useSynced<string>(p.layoutDirection);

	async function setLocale(next: string): Promise<void> {
		const before = prefs.peek();
		prefs.value = { ...before, locale: next };
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.savePreferences({ locale: next });
		if (!res.ok) {
			prefs.value = before;
			status.value = { tone: "error", text: res.message };
			return;
		}
		await SettingsService.renewSession();
		status.value = {
			tone: "saved",
			text: "Saved. Numbers and dates use the new format from the next page.",
		};
	}

	async function setCurrency(next: string): Promise<void> {
		prefs.value = { ...prefs.peek(), displayCurrency: next };
		status.value = { tone: "busy", text: "Saving…" };
		const stored = await commitDisplayCurrency(next);
		status.value = stored ? { tone: "saved", text: `Prices now show in ${next}.` } : {
			tone: "device",
			text: `Prices show in ${next} on this device. We couldn't save it to your account just now.`,
		};
	}

	async function setDirection(next: LayoutDirection): Promise<void> {
		const before = prefs.peek();
		prefs.value = { ...before, layoutDirection: next };
		applyDirection(next);
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.savePreferences({ layoutDirection: next });
		status.value = res.ok
			? { tone: "saved", text: "Saved." }
			: { tone: "device", text: `Applied on this device only — ${res.message}` };
	}

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock
				anchor="locale"
				title="Language & region"
				description="Projective is in English for now. This sets how numbers, prices and dates are written."
			>
				<SettingsRow
					label="Format"
					descId="stg-locale-desc"
					description={<span class="stg-tabular">{sample(p.locale, p.displayCurrency)}</span>}
					control={
						<Select
							options={LOCALES}
							value={locale}
							filter
							aria-label="Language and region"
							aria-describedby="stg-locale-desc"
							onValueChange={(next) => next && next !== prefs.peek().locale && setLocale(next)}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="currency"
				title="Display currency"
				description="Prices are converted for display only. You always pay and get paid in the listed currency."
			>
				<SettingsRow
					label="Show prices in"
					control={
						<Select
							options={DISPLAY_CURRENCIES.map((c) => ({
								value: c.code,
								label: `${c.code} — ${c.label}`,
							}))}
							value={currency}
							aria-label="Display currency"
							onValueChange={(next) =>
								next && next !== prefs.peek().displayCurrency && setCurrency(next)}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="direction"
				title="Text direction"
				description="Automatic follows the language. Choose one to lay every page out that way."
			>
				<SettingsRow
					label="Layout"
					control={
						<SelectButton
							options={DIRECTIONS}
							value={direction}
							aria-label="Text direction"
							onValueChange={(next) => setDirection(next as LayoutDirection)}
						/>
					}
				/>
			</SettingsBlock>

			<SaveStatus state={status.value} />
		</div>
	);
}
