import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { CurrencySelect, Select, SelectButton } from "@projective/ui/fields";
import { Flag } from "@projective/ui/display";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import {
	DATE_FORMAT_PATTERN,
	type DateFormat,
	type DisplayPreferences,
	formatDateValue,
	type LayoutDirection,
	localeDateOrder,
	localeDirection,
} from "@projective/types/org";
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
import { localeOption, LOCALES } from "../../core/locales.ts";
import { commitDisplayCurrency } from "@features/shell/core/currency-state.ts";

// #region Stylesheet carrier
import "../../styles/settings-language.css";
// #endregion

/**
 * Settings → Language & region (Decisions #151, #156): the formatting language (with its flag), the
 * date format, the display currency and the document direction. Each saves at once.
 *
 * - The **language** is stamped into the session (the access-token hook reads it), so after saving the
 *   session is renewed and the new format applies from the next page. With the direction on
 *   Automatic, a right-to-left language lays this page out right to left at once.
 * - The **date format** follows the language until the person picks one; a picked format survives a
 *   language change. It rides the session too.
 * - The **currency** goes through the shell's own `commitDisplayCurrency`, the same end-to-end setter
 *   the wallet and checkout use, so every price on the page changes as the menu closes.
 * - The **direction** applies on this device at once and travels in the `pj.a11y` cookie.
 */

// #region Options
const FOLLOW = "follow";

const DIRECTIONS = [
	{ value: "auto", label: "Automatic" },
	{ value: "ltr", label: "Left to right" },
	{ value: "rtl", label: "Right to left" },
];

/** A fixed example date, so every option shows the same day. */
const EXAMPLE_DATE = new Date(Date.UTC(2026, 9, 28));

function sample(locale: string, currency: string): string {
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(1234.5);
	} catch {
		return "";
	}
}

function example(locale: string, dateFormat: DateFormat | null): string {
	return formatDateValue(EXAMPLE_DATE, { locale, dateFormat, timeZone: "UTC" });
}

function localeRow(value: string): JSX.Element | string {
	const option = localeOption(value);
	if (!option) return value;
	return (
		<span class="stg-locale">
			<Flag code={option.country} size="md" />
			<span class="stg-locale__text">
				<span class="stg-locale__name" lang={option.value} dir="auto">{option.label}</span>
				<span class="stg-locale__english">{option.english}</span>
			</span>
		</span>
	);
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
		const p = props.data.preferences;
		applyDirection(p.layoutDirection, p.locale);
	}, [props.data]);

	const p = prefs.value;
	const locale = useSynced<string>(p.locale);
	const currency = useSynced<string>(p.displayCurrency);
	const direction = useSynced<string>(p.layoutDirection);
	const dateFormat = useSynced<string>(p.dateFormat ?? FOLLOW);
	const followPattern = DATE_FORMAT_PATTERN[localeDateOrder(p.locale)];

	async function setLocale(next: string): Promise<void> {
		const before = prefs.peek();
		prefs.value = { ...before, locale: next };
		if (before.layoutDirection === "auto") applyDirection("auto", next);
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.savePreferences({ locale: next });
		if (!res.ok) {
			prefs.value = before;
			if (before.layoutDirection === "auto") applyDirection("auto", before.locale);
			status.value = { tone: "error", text: res.message };
			return;
		}
		await SettingsService.renewSession();
		status.value = {
			tone: "saved",
			text: before.dateFormat
				? "Saved. Numbers and prices use the new format from the next page."
				: "Saved. Numbers, prices and dates use the new format from the next page.",
		};
	}

	async function setDateFormat(next: string): Promise<void> {
		const before = prefs.peek();
		const value: DateFormat | null = next === FOLLOW ? null : next as DateFormat;
		prefs.value = { ...before, dateFormat: value };
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.savePreferences({ dateFormat: value });
		if (!res.ok) {
			prefs.value = before;
			status.value = { tone: "error", text: res.message };
			return;
		}
		await SettingsService.renewSession();
		status.value = {
			tone: "saved",
			text: value
				? `Saved. Dates are written ${DATE_FORMAT_PATTERN[value]} from the next page.`
				: "Saved. Dates follow your language from the next page.",
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
		applyDirection(next, before.locale);
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.savePreferences({ layoutDirection: next });
		status.value = res.ok
			? { tone: "saved", text: "Saved." }
			: { tone: "device", text: `Applied on this device only — ${res.message}` };
	}

	const natural = localeDirection(p.locale);
	const option = localeOption(p.locale);
	const dateOptions = [
		{
			value: FOLLOW,
			label: `Follow language`,
			description: `${followPattern} · ${example(p.locale, null)}`,
		},
		...(["dmy", "mdy", "ymd"] as const).map((value) => ({
			value,
			label: DATE_FORMAT_PATTERN[value],
			description: example(p.locale, value),
		})),
	];

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock
				anchor="locale"
				title="Language & region"
				description="Projective is in English for now. This sets how numbers and prices are written, and which way the page reads."
			>
				<SettingsRow
					label="Language"
					descId="stg-locale-desc"
					description={<span class="stg-tabular">{sample(p.locale, p.displayCurrency)}</span>}
					control={
						<Select
							class="stg-locale-select"
							options={LOCALES.map((l) => ({
								value: l.value,
								label: l.label,
								description: l.english,
							}))}
							value={locale}
							filter
							filterPlaceholder="Search languages"
							panelWidth="auto"
							optionTemplate={(opt) => localeRow(opt.value)}
							aria-label="Language and region"
							aria-describedby="stg-locale-desc"
							onValueChange={(next) => next && next !== prefs.peek().locale && setLocale(next)}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="date-format"
				title="Date format"
				description="Follows your language unless you choose one. A format you choose stays when you change language."
			>
				<SettingsRow
					label="Write dates as"
					descId="stg-date-desc"
					description={
						<span class="stg-tabular">
							{p.dateFormat
								? `Chosen: ${DATE_FORMAT_PATTERN[p.dateFormat]}`
								: `From ${option?.english ?? p.locale}: ${followPattern}`}
						</span>
					}
					control={
						<Select
							options={dateOptions}
							value={dateFormat}
							panelWidth="auto"
							aria-label="Date format"
							aria-describedby="stg-date-desc"
							onValueChange={(next) => next && setDateFormat(next)}
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
						<CurrencySelect
							currencies={DISPLAY_CURRENCIES}
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
				description="Automatic follows your language. Choose one to lay every page out that way."
			>
				<SettingsRow
					label="Layout"
					descId="stg-direction-desc"
					description={p.layoutDirection === "auto"
						? `Automatic: ${natural === "rtl" ? "right to left" : "left to right"} for ${
							option?.english ?? p.locale
						}.`
						: undefined}
					control={
						<SelectButton
							options={DIRECTIONS}
							value={direction}
							aria-label="Text direction"
							aria-describedby={p.layoutDirection === "auto" ? "stg-direction-desc" : undefined}
							onValueChange={(next) => setDirection(next as LayoutDirection)}
						/>
					}
				/>
			</SettingsBlock>

			<SaveStatus state={status.value} />
		</div>
	);
}
