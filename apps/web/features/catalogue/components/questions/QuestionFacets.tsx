import type { JSX } from "preact";
import { InputText, NumberInput, ToggleSwitch } from "@projective/ui/fields";
import type { IntakeField } from "@projective/types/services";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import { hasOptions } from "../../core/intake-model.ts";
import { signedMajorOf, signedMinorOf } from "../../core/pricing-model.ts";
import { IntakeOptionsEditor } from "../edit/intake/IntakeOptionsEditor.tsx";

/** Props for {@link QuestionFacets}. */
export interface QuestionFacetsProps {
	field: IntakeField;
	/** The question's number in the list, for the controls' names. */
	position: number;
	/** Published: only the wording, options, starting value and pricing may change. */
	locked: boolean;
	/** The listing's currency, which a number question's guide pricing is in. */
	currency: string;
	onChange: (field: IntakeField) => void;
}

const PER_UNIT_MAX_MINOR = 1_000_000_000;

/**
 * QuestionFacets — what a question's kind needs beyond its wording: the options of a choice, the
 * example answer of a text question, and a number's bounds, unit, slider, starting value and linear
 * guide pricing (Decision #522). Every figure is a `NumberInput` (Decision #525).
 */
export function QuestionFacets(props: QuestionFacetsProps): JSX.Element | null {
	const { field, position, locked, currency, onChange } = props;
	const patch = (next: Partial<IntakeField>) => onChange({ ...field, ...next });
	const base = `cat-qb-${field.id}`;
	const unitWord = field.unit ? field.unit.replace(/s$/, "") : "unit";
	const perUnitMax = signedMajorOf(PER_UNIT_MAX_MINOR, currency) ?? undefined;

	if (hasOptions(field.kind)) {
		return (
			<>
				<IntakeOptionsEditor field={field} position={position} onChange={onChange} />
				{field.kind === "pills" && (
					<ToggleSwitch
						value={field.multiple}
						onValueChange={(multiple) => patch({ multiple })}
						label="Buyers may pick more than one"
						disabled={locked}
					/>
				)}
			</>
		);
	}

	if (field.kind === "text" || field.kind === "textarea") {
		return (
			<InputText
				value={field.placeholder ?? ""}
				onValueChange={(placeholder) =>
					patch({ placeholder: placeholder.trim() ? placeholder : undefined })}
				maxLength={120}
				placeholder="Example answer shown in the box (optional)"
				aria-label={`Question ${position} example answer`}
				fluid
			/>
		);
	}

	if (field.kind !== "number") return null;

	return (
		<>
			<div class="cat-offer__row">
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={`${base}-min`}>Lowest</label>
					<NumberInput
						id={`${base}-min`}
						class="cat-offer__count"
						value={field.min ?? null}
						onValueChange={(min) => patch({ min: min ?? undefined })}
						placeholder="None"
						disabled={locked}
					/>
				</div>
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={`${base}-max`}>Highest</label>
					<NumberInput
						id={`${base}-max`}
						class="cat-offer__count"
						value={field.max ?? null}
						onValueChange={(max) => patch({ max: max ?? undefined })}
						placeholder="None"
						disabled={locked}
					/>
				</div>
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={`${base}-unit`}>Unit</label>
					<InputText
						id={`${base}-unit`}
						value={field.unit ?? ""}
						onValueChange={(unit) => patch({ unit: unit.trim() ? unit : undefined })}
						maxLength={24}
						placeholder="words"
						disabled={locked}
					/>
				</div>
			</div>
			<div class="cat-offer__row">
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={`${base}-start`}>Starting value</label>
					<NumberInput
						id={`${base}-start`}
						class="cat-offer__count"
						value={field.defaultValue ?? null}
						min={field.min}
						max={field.max}
						onValueChange={(v) => patch({ defaultValue: v ?? undefined })}
						placeholder="Empty"
					/>
				</div>
				<div class="cat-sec__field cat-intake__required">
					<ToggleSwitch
						value={field.slider}
						onValueChange={(slider) => patch({ slider })}
						label="Offer a slider"
						disabled={locked}
					/>
				</div>
				<div class="cat-sec__field cat-intake__required">
					<ToggleSwitch
						value={!!field.pricing}
						onValueChange={(on) =>
							patch({
								pricing: on
									? {
										model: "linear",
										perUnitMinor: field.pricing?.perUnitMinor ?? 0,
										includedUnits: field.pricing?.includedUnits ?? 0,
									}
									: undefined,
							})}
						label="Adjusts your guide price"
					/>
				</div>
			</div>
			{field.pricing && (
				<>
					<div class="cat-offer__row">
						<div class="cat-sec__field">
							<label class="cat-sec__label" for={`${base}-perunit`}>Per {unitWord}</label>
							<NumberInput
								{...MONEY_FIELD}
								{...moneyDigits(currency)}
								id={`${base}-perunit`}
								value={signedMajorOf(field.pricing.perUnitMinor, currency)}
								min={perUnitMax === undefined ? undefined : -perUnitMax}
								max={perUnitMax}
								onValueChange={(whole) =>
									field.pricing &&
									patch({
										pricing: {
											...field.pricing,
											perUnitMinor: signedMinorOf(whole, currency) ?? 0,
										},
									})}
							/>
						</div>
						<div class="cat-sec__field">
							<label class="cat-sec__label" for={`${base}-included`}>Included</label>
							<NumberInput
								id={`${base}-included`}
								class="cat-offer__count"
								value={field.pricing.includedUnits}
								min={0}
								onValueChange={(v) =>
									field.pricing &&
									patch({ pricing: { ...field.pricing, includedUnits: Math.max(0, v ?? 0) } })}
							/>
						</div>
					</div>
					<p class="cat-sec__hint">
						Each {unitWord}{" "}
						past the included amount moves the guide buyers see by this much, up or down. It guides
						a quote; the price you send is the one charged.
					</p>
				</>
			)}
		</>
	);
}
