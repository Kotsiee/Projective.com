import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import {
	Button,
	DatePicker,
	FormControl,
	InputText,
	MultiSelect,
	NumberInput,
	SelectButton,
	ToggleSwitch,
} from "@projective/ui/fields";
import { useIsMobile } from "@projective/ui/hooks";
import type { PromoListingOption } from "@projective/types/finance";
import { createPromotion, promotionsBusy } from "../../core/promotions-store.ts";
import { consoleUrl, setConsoleUrl } from "../../core/console-store.ts";
import {
	draftToPromoInput,
	freshPromoDraft,
	type PromoDraft,
} from "../../core/promotions-model.ts";

const KIND_OPTIONS = [
	{ label: "Percentage", value: "percent" },
	{ label: "Fixed amount", value: "flat" },
];

/**
 * PromoCodeDialog — the seller issues a promo code, at `?promo=new` (MARKETPLACE CK2, Decision #485):
 * the code buyers type, its name, the discount (a percentage, or a fixed amount in one currency), which
 * of their product listings it covers (all, or the ones they pick), an optional last day, an optional
 * cap on redemptions and how many times each account may use it (once, by default). The server
 * re-checks every term; its refusal (a taken code, say) is shown in place. A bottom sheet on a phone.
 */
export function PromoCodeDialog(
	props: { listings: readonly PromoListingOption[]; defaultCurrency: string },
): JSX.Element {
	const mobile = useIsMobile();
	const visible = useSignal(false);
	// shortcut: a fixed-amount code is issued in the seller's display currency only; offer a currency
	// picker once sellers price listings in more than one.
	const draft = useSignal<PromoDraft>(freshPromoDraft(props.defaultCurrency));
	const errors = useSignal<Record<string, string>>({});
	const failure = useSignal<string | null>(null);

	useSignalEffect(() => {
		const want = consoleUrl.value.promo === "new";
		if (want && !visible.peek()) {
			draft.value = freshPromoDraft(props.defaultCurrency);
			errors.value = {};
			failure.value = null;
		}
		visible.value = want;
	});

	const d = draft.value;
	const close = () => setConsoleUrl({ promo: undefined }, "replace");

	function patch(next: Partial<PromoDraft>): void {
		draft.value = { ...draft.peek(), ...next };
		errors.value = {};
		failure.value = null;
	}

	async function submit(): Promise<void> {
		const built = draftToPromoInput(draft.peek(), Date.now());
		if (!built.ok) {
			errors.value = built.errors;
			return;
		}
		const out = await createPromotion(built.input);
		if (!out.ok) {
			failure.value = out.message;
			if (out.errors) errors.value = out.errors;
		}
	}

	const field = (key: string) => ({
		error: errors.value[key],
		status: errors.value[key] ? ("invalid" as const) : ("default" as const),
	});

	return (
		<Dialog
			visible={visible}
			position={mobile ? "bottom" : "center"}
			header="New promo code"
			width="min(34rem, calc(100vw - 2rem))"
			onVisibleChange={(v) => {
				if (!v && consoleUrl.peek().promo === "new") close();
			}}
			footer={
				<div class="cat-promo__actions">
					<Button
						label="Cancel"
						severity="neutral"
						variant="outlined"
						disabled={promotionsBusy.value}
						onClick={close}
					/>
					<Button
						label="Issue code"
						loading={promotionsBusy.value}
						disabled={promotionsBusy.value}
						onClick={() => void submit()}
					/>
				</div>
			}
		>
			<div class="cat-promo__form">
				{failure.value && <InlineNotice assertive align="start" text={failure.value} />}

				<FormControl
					label="Code"
					{...field("code")}
					hint="What buyers type at checkout: 4 to 40 letters, digits or hyphens."
				>
					{({ id, describedBy, status }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							status={status}
							value={d.code}
							placeholder="LAUNCH20"
							onValueChange={(code) => patch({ code: code.toUpperCase() })}
						/>
					)}
				</FormControl>

				<FormControl label="Name" {...field("label")} hint="Shown to buyers beside the saving.">
					{({ id, describedBy, status }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							status={status}
							value={d.label}
							placeholder="Launch week, 20% off"
							onValueChange={(label) => patch({ label })}
						/>
					)}
				</FormControl>

				<FormControl label="Discount" {...field(d.kind === "percent" ? "percent" : "amountMinor")}>
					{({ id, describedBy }) => (
						<div class="cat-promo__discount">
							<SelectButton
								options={KIND_OPTIONS}
								value={d.kind}
								aria-label="Kind of discount"
								onValueChange={(v) => {
									if (v === "percent" || v === "flat") patch({ kind: v });
								}}
							/>
							{d.kind === "percent"
								? (
									<NumberInput
										id={id}
										aria-describedby={describedBy}
										value={d.percent}
										min={1}
										max={100}
										maxFractionDigits={0}
										suffix="% off"
										onValueChange={(percent) => patch({ percent: percent ?? null })}
									/>
								)
								: (
									<NumberInput
										id={id}
										aria-describedby={describedBy}
										value={d.amount}
										min={0}
										maxFractionDigits={2}
										suffix={`${d.currency} off`}
										onValueChange={(amount) => patch({ amount: amount ?? null })}
									/>
								)}
						</div>
					)}
				</FormControl>

				<FormControl
					label="Covers"
					{...field("listings")}
					hint="Only your products. Escrowed work (projects, sessions, seats) never takes a code."
				>
					{({ id, describedBy }) => (
						<div class="cat-promo__scope">
							<ToggleSwitch
								value={d.listings === null}
								label="All your products"
								onValueChange={(all) => patch({ listings: all ? null : [] })}
							/>
							{d.listings !== null && (
								<MultiSelect
									id={id}
									aria-describedby={describedBy}
									options={props.listings.map((l) => ({ label: l.title, value: l.slug }))}
									value={d.listings}
									placeholder="Choose listings"
									onValueChange={(listings) => patch({ listings })}
								/>
							)}
						</div>
					)}
				</FormControl>

				<FormControl
					label="Last day"
					{...field("expiresAt")}
					hint="Optional. It stops working at the end of that day."
				>
					{({ id, describedBy, status }) => (
						<DatePicker
							id={id}
							aria-describedby={describedBy}
							status={status}
							value={d.expiresOn}
							minDate={new Date()}
							showIcon
							placeholder="No expiry"
							onValueChange={(v) => patch({ expiresOn: v instanceof Date ? v : null })}
						/>
					)}
				</FormControl>

				<FormControl label="Redemptions in total">
					{({ id, describedBy }) => (
						<div class="cat-promo__scope">
							<ToggleSwitch
								value={d.maxRedemptions !== null}
								label="Cap the total"
								onValueChange={(on) => patch({ maxRedemptions: on ? 100 : null })}
							/>
							{d.maxRedemptions !== null && (
								<NumberInput
									id={id}
									aria-describedby={describedBy}
									value={d.maxRedemptions}
									min={1}
									max={1_000_000}
									maxFractionDigits={0}
									suffix="uses"
									onValueChange={(n) => patch({ maxRedemptions: Math.max(1, Math.round(n ?? 1)) })}
								/>
							)}
						</div>
					)}
				</FormControl>

				<FormControl label="Uses per account">
					{({ id, describedBy }) => (
						<div class="cat-promo__scope">
							<ToggleSwitch
								value={d.perAccount !== null}
								label="Limit each account"
								onValueChange={(on) => patch({ perAccount: on ? 1 : null })}
							/>
							{d.perAccount !== null && (
								<NumberInput
									id={id}
									aria-describedby={describedBy}
									value={d.perAccount}
									min={1}
									max={1000}
									maxFractionDigits={0}
									suffix={d.perAccount === 1 ? "use" : "uses"}
									onValueChange={(n) => patch({ perAccount: Math.max(1, Math.round(n ?? 1)) })}
								/>
							)}
						</div>
					)}
				</FormControl>

				<p class="cat-promo__note">
					You fund the discount: your commission is taken on what the buyer pays after it. A code
					can't be edited once issued; archive it and issue another.
				</p>
			</div>
		</Dialog>
	);
}
