import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import "../styles/currency-select.css";
import { cx } from "../../core/cx.ts";
import { type CurrencyChoice, CurrencyLabel } from "../../display/components/CurrencyLabel.tsx";
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";
import { Select } from "./Select.tsx";

// #region Props
/** Props for {@link CurrencySelect}. */
export interface CurrencySelectProps extends BaseFieldProps {
	/** The currencies offered, in display order. */
	currencies: readonly CurrencyChoice[];
	/** Bound ISO 4217 code — raw (uncontrolled) or a `Signal` (controlled). */
	value?: Bindable<string>;
	onValueChange?: ValueChange<string>;
	placeholder?: string;
	/** In-panel search over code, currency name and country. Defaults to on past eight currencies. */
	filter?: boolean;
	/** Panel width — see `SelectProps.panelWidth`. Defaults to `auto`, so a country name never clips. */
	panelWidth?: "trigger" | "auto" | (string & Record<never, never>);
	panelClass?: string;
	class?: string;
}
// #endregion

/**
 * CurrencySelect — the standard currency picker (DESIGN_SYSTEM §C.1). A {@link Select} whose trigger
 * and every option draw the same {@link CurrencyLabel}: a circular flag, `[symbol] [code]`, and the
 * issuing country beneath in the meta register. The option's accessible name is `CODE Currency name`
 * (what typeahead matches); the filter also searches the country.
 */
export function CurrencySelect(props: CurrencySelectProps): JSX.Element {
	const {
		currencies,
		filter,
		panelWidth = "auto",
		placeholder = "Choose a currency",
		class: className,
		...rest
	} = props;

	const byCode = useMemo(
		() => new Map(currencies.map((currency) => [currency.code, currency])),
		[currencies],
	);
	const options = useMemo<Option[]>(
		() =>
			currencies.map((currency) => ({
				value: currency.code,
				label: `${currency.code} ${currency.label}`,
				description: currency.countryName,
			})),
		[currencies],
	);

	const row = (opt: Option): JSX.Element | string => {
		const currency = byCode.get(opt.value);
		return currency ? <CurrencyLabel currency={currency} /> : opt.label;
	};

	return (
		<Select
			{...rest}
			class={cx("ui-currency-select", className)}
			options={options}
			placeholder={placeholder}
			filter={filter ?? currencies.length > 8}
			filterPlaceholder="Search currencies"
			panelWidth={panelWidth}
			optionTemplate={row}
		/>
	);
}
