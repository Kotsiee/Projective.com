import type { JSX } from "preact";
import { CurrencySelect, NumberInput, Select, ToggleSwitch } from "@projective/ui/fields";
import { type OwnerCallSettings, PAID_CALLS_LIVE } from "@projective/types/scheduling";
import { DISPLAY_CURRENCIES, toMajorUnits, toMinorUnits } from "@projective/types/finance";
import { SettingsRow, useSynced } from "../../SettingsParts.tsx";

/**
 * PaidConsultationRows — Settings → Scheduling's paid consultation (Decision #439, moved from the
 * retired `/[handle]/edit/availability`): whether a seller offers one, and — once paid calls are live
 * — its length, fee and currency. While they are not ({@link PAID_CALLS_LIVE}, Decision #343 ruling
 * C1) the switch is locked at what is stored and says why, and the fee rows are not drawn: a setting
 * nothing reads is not one to offer (gate 11).
 */
export interface PaidConsultationRowsProps {
	call: OwnerCallSettings;
	patch: (part: Partial<OwnerCallSettings>) => void;
}

const LENGTHS = [15, 20, 30, 45, 60, 90, 120].map((m) => ({
	value: String(m),
	label: `${m} minutes`,
}));
const DEFAULT_CURRENCY = "GBP";

export function PaidConsultationRows({ call, patch }: PaidConsultationRowsProps): JSX.Element {
	const enabled = useSynced(call.paidEnabled);
	return (
		<>
			<SettingsRow
				label="Offer a paid consultation"
				descId="stg-paid-desc"
				description={PAID_CALLS_LIVE
					? "A longer call clients pay for when they book."
					: "Paid consultations open once clients can pay for them, so this can't be changed for now."}
				control={
					<ToggleSwitch
						value={enabled}
						disabled={!PAID_CALLS_LIVE}
						aria-label="Offer a paid consultation"
						aria-describedby="stg-paid-desc"
						onValueChange={(on) =>
							patch({ paidEnabled: on, feeCurrency: call.feeCurrency ?? DEFAULT_CURRENCY })}
					/>
				}
			/>
			{PAID_CALLS_LIVE && call.paidEnabled && <PaidTerms call={call} patch={patch} />}
		</>
	);
}

function PaidTerms({ call, patch }: PaidConsultationRowsProps): JSX.Element {
	const currency = call.feeCurrency ?? DEFAULT_CURRENCY;
	const length = useSynced(String(call.paidDurationMinutes));
	const fee = useSynced<number | null>(toMajorUnits(call.feeAmountMinor, currency));
	const code = useSynced(currency);
	return (
		<>
			<SettingsRow
				label="Length"
				control={
					<Select
						options={LENGTHS}
						value={length}
						aria-label="Paid consultation length"
						onValueChange={(v) => patch({ paidDurationMinutes: Number(v) })}
					/>
				}
			/>
			<SettingsRow
				label="Fee"
				description="A working-hours rule on your calendar can set its own."
				control={
					<NumberInput
						value={fee}
						min={0}
						step={1}
						aria-label="Paid consultation fee"
						onValueChange={(n) => patch({ feeAmountMinor: toMinorUnits(n ?? null, currency) })}
					/>
				}
			/>
			<SettingsRow
				label="Currency"
				control={
					<CurrencySelect
						currencies={DISPLAY_CURRENCIES}
						value={code}
						aria-label="Paid consultation currency"
						onValueChange={(next) => patch({ feeCurrency: next })}
					/>
				}
			/>
		</>
	);
}
