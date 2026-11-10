import type { JSX } from "preact";
import { CurrencySelect, FormControl, NumberInput } from "@projective/ui/fields";
import type { FieldStatus } from "@projective/ui/fields";
import { currencyExponent, DISPLAY_CURRENCIES } from "@projective/types/finance";
import { BASELINE_PRICE_HINT, BASELINE_PRICE_LABEL } from "../types/projects-types.ts";
import type { ProjectCreateFormat } from "../types/projects-types.ts";
import { minorUnit, MONEY_FIELD } from "./setup/setup-format.ts";

const CURRENCY_HINT = "Fixed to the project once it is created. Prices and escrow are held in it.";

/** The two money controls of the create modal, keyed as their refusals arrive from the server. */
export type PricingFieldKey = "currency" | "baselineAmountCents";

/** The focus-tracking wrapper props the modal hands each field. */
export interface PricingFieldWrapper {
	class: string;
	onFocusCapture: () => void;
	onBlurCapture: () => void;
}

/** Props for {@link ProjectCreatePricingFields}. */
export interface ProjectCreatePricingFieldsProps {
	/** Decides what the baseline figure means: a per-ticket rate or a whole escrow budget. */
	format: ProjectCreateFormat;
	currency: string;
	/** The baseline in MAJOR units of {@link currency}; `null` = not priced yet. */
	amount: number | null;
	onCurrencyChange: (code: string) => void;
	onAmountChange: (amount: number | null) => void;
	field: (key: PricingFieldKey) => PricingFieldWrapper;
	currencyStatus: FieldStatus;
	amountStatus: FieldStatus;
	currencyError?: string;
	amountError?: string;
}

/**
 * The create modal's currency selector and optional baseline price, side by side.
 *
 * The currency list is `DISPLAY_CURRENCIES`, the same set the workspace's Rules section offers and
 * the fat service accepts.
 */
export function ProjectCreatePricingFields(props: ProjectCreatePricingFieldsProps): JSX.Element {
	const { format, currency, amount } = props;
	const exponent = currencyExponent(currency);
	return (
		<div class="pjc__row">
			<div {...props.field("currency")}>
				<FormControl
					label="Currency"
					hint={CURRENCY_HINT}
					status={props.currencyStatus}
					error={props.currencyError}
				>
					{({ id, describedBy }) => (
						<CurrencySelect
							id={id}
							currencies={DISPLAY_CURRENCIES}
							value={currency}
							onValueChange={props.onCurrencyChange}
							filter
							fluid
							status={props.currencyStatus}
							aria-describedby={describedBy}
						/>
					)}
				</FormControl>
			</div>

			<div {...props.field("baselineAmountCents")}>
				<FormControl
					label={`${BASELINE_PRICE_LABEL[format]} (optional)`}
					hint={BASELINE_PRICE_HINT[format]}
					status={props.amountStatus}
					error={props.amountError}
				>
					{({ id, describedBy }) => (
						<NumberInput
							{...MONEY_FIELD}
							id={id}
							value={amount}
							onValueChange={props.onAmountChange}
							currency={currency}
							maxFractionDigits={exponent}
							minFractionDigits={exponent}
							precisionStep={minorUnit(currency)}
							fluid
							status={props.amountStatus}
							aria-describedby={describedBy}
						/>
					)}
				</FormControl>
			</div>
		</div>
	);
}
