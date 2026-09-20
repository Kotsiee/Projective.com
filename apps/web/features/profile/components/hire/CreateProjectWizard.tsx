import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	Button,
	InputNumber,
	InputText,
	type Option,
	Select,
	Textarea,
} from "@projective/ui/fields";
import { Dialog, Message } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	currencyExponent,
	DISPLAY_CURRENCIES,
	toDisplayCurrency,
	toMinorUnits,
} from "@projective/types/finance";
import type { CreateProject, ProjectCreateFormat } from "@projective/types/projects";
import { ProjectSidebarService } from "@features/projects/core/ProjectSidebarService.ts";

/**
 * CreateProjectWizard — the two-step "Create new project" the Add-to-project popover opens.
 *
 * STEP 1 picks the TYPE from three cards with a prominent glyph and generous padding: **Task** (one
 * deliverable, no stages — a Direct Deliverable), **One-off project** (a fixed scope in stages) and
 * **Pipeline** (ongoing work, ticket by ticket). STEP 2 is the lightweight setup the `/projects`
 * Quick-Init modal collects — a name, an optional one-line brief, the currency and an optional
 * baseline price — and on Create the draft is minted and the client is sent to
 * `/projects/[slug]` to finish it.
 *
 * # Three cards, two formats
 *
 * `ProjectCreateFormat` has two members on purpose (Decision #86 demoted the third): a Task IS a
 * one-off with `hasStages: false`, minted as `structure: "single_task"` through the SAME
 * `createFormatToColumns` the setup form reads back with. The card is a product choice a client
 * recognises; the enum is the storage vocabulary. The wizard maps one onto the other and never
 * widens the enum to carry a word.
 *
 * # Why it redirects rather than assigning
 *
 * The seller cannot be assigned to a project that has no stages priced and no brief — an
 * assignment needs the Stage-2 surface's work first. So the wizard's job is to reach the URL where
 * that work happens, exactly as the Quick-Init modal's is; the seller is a click away from the
 * roster once the project exists.
 */
export interface CreateProjectWizardProps {
	open: Signal<boolean>;
	sellerName: string;
	/** The currency the project is SEEDED in — the viewer's resolved money context. */
	defaultCurrency: string;
	/** The active workspace id → the created engagement's `scopeId`. */
	scopeId: string;
}

// #region Vocabulary
/** One card on the type step. */
interface TypeCard {
	key: "task" | "one_off" | "pipeline";
	format: ProjectCreateFormat;
	hasStages: boolean;
	label: string;
	hint: string;
	icon: IconName;
}

const TYPE_CARDS: readonly TypeCard[] = [
	{
		key: "task",
		format: "one_off",
		hasStages: false,
		label: "Task",
		hint: "One deliverable, one price. No stages to set up.",
		icon: "ticket",
	},
	{
		key: "one_off",
		format: "one_off",
		hasStages: true,
		label: "One-off project",
		hint: "A fixed scope delivered in stages, each funded as it starts.",
		icon: "submission",
	},
	{
		key: "pipeline",
		format: "pipeline",
		hasStages: true,
		label: "Pipeline",
		hint: "Ongoing work, ticket by ticket, across as many stages as you need.",
		icon: "stages",
	},
];

const CURRENCY_OPTIONS: Option[] = DISPLAY_CURRENCIES.map((c) => ({
	value: c.code,
	label: `${c.code} — ${c.label}`,
}));

/** The baseline figure's heading per type — the Quick-Init modal's own words. */
const PRICE_LABEL: Record<TypeCard["key"], string> = {
	task: "Task price",
	one_off: "Escrow budget",
	pipeline: "Default ticket price",
};

const TITLE_MIN = 3;
const TITLE_MAX = 160;
const BRIEF_MAX = 2000;
// #endregion

export default function CreateProjectWizard(
	{ open, sellerName, defaultCurrency, scopeId }: CreateProjectWizardProps,
): JSX.Element {
	const step = useSignal<1 | 2>(1);
	const type = useSignal<TypeCard | null>(null);
	const title = useSignal("");
	const brief = useSignal("");
	const currency = useSignal(toDisplayCurrency(defaultCurrency));
	const price = useSignal<number | null>(null);
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);
	const titleError = useSignal<string | null>(null);
	const attempted = useSignal(false);
	const titleFieldRef = useRef<HTMLDivElement>(null);
	const cardsRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open.value) return;
		step.value = 1;
		type.value = null;
		title.value = "";
		brief.value = "";
		currency.value = toDisplayCurrency(defaultCurrency);
		price.value = null;
		submitting.value = false;
		error.value = null;
		titleError.value = null;
		attempted.value = false;
	}, [open.value]);

	function close(): void {
		open.value = false;
	}

	function pick(card: TypeCard): void {
		type.value = card;
		step.value = 2;
		// The step's first field takes focus once it exists — a wizard that advanced and left focus
		// on a card that is no longer rendered drops a keyboard user at the top of the dialog.
		setTimeout(() => titleFieldRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
	}

	function back(): void {
		step.value = 1;
		setTimeout(() => cardsRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
	}

	function titleProblem(): string | null {
		const len = title.value.trim().length;
		if (len === 0) return "Give your project a name.";
		if (len < TITLE_MIN) return `Use at least ${TITLE_MIN} characters.`;
		return null;
	}

	async function submit(): Promise<void> {
		const card = type.value;
		if (!card || submitting.value) return;
		attempted.value = true;
		const problem = titleProblem();
		titleError.value = problem;
		if (problem) {
			titleFieldRef.current?.querySelector<HTMLInputElement>("input")?.focus();
			return;
		}
		submitting.value = true;
		error.value = null;
		const payload: CreateProject = {
			title: title.value.trim(),
			format: card.format,
			hasStages: card.hasStages,
			description: brief.value.trim(),
			currency: currency.value,
			baselineAmountCents: toMinorUnits(price.value, currency.value),
			scopeType: "personal",
			scopeId,
		};
		const res = await ProjectSidebarService.create(payload);
		submitting.value = false;
		if (!res.ok || !res.data) {
			const fieldTitle = res.errors?.title;
			if (fieldTitle) titleError.value = fieldTitle;
			error.value = res.message ?? "Couldn't create the project. Try again.";
			return;
		}
		// The Stage-2 surface — by SLUG, the only address that routes (Decision #88).
		try {
			globalThis.location.assign(`/projects/${res.data.slug}`);
		} catch { /* no-op */ }
	}

	const card = type.value;
	const code = currency.value;
	const exponent = currencyExponent(code);

	const footer = step.value === 1
		? (
			<div class="pf-wizard__foot">
				<span class="pf-wizard__progress" aria-live="polite">Step 1 of 2 · Choose a type</span>
				<div class="pf-wizard__actions">
					<Button variant="text" severity="secondary" label="Cancel" onClick={close} />
				</div>
			</div>
		)
		: (
			<div class="pf-wizard__foot">
				<span class="pf-wizard__progress" aria-live="polite">Step 2 of 2 · Name it</span>
				<div class="pf-wizard__actions">
					<Button variant="text" severity="secondary" label="Back" onClick={back} />
					<Button
						variant="filled"
						severity="primary"
						label={submitting.value ? "Creating…" : "Create project"}
						loading={submitting.value}
						disabled={submitting.value}
						onClick={() => void submit()}
					/>
				</div>
			</div>
		);

	return (
		<Dialog
			visible={open}
			header={step.value === 1 ? "New project" : `New ${card?.label.toLowerCase() ?? "project"}`}
			width="min(44rem, calc(100vw - var(--space-6)))"
			class="pf-wizard"
			footer={footer}
			onVisibleChange={(v) => {
				if (!v) close();
			}}
		>
			{step.value === 1
				? (
					<div class="pf-wizard__step">
						<p class="pf-wizard__lead">
							What kind of work are you bringing {sellerName} into?
						</p>
						<div class="pf-wizard__cards" ref={cardsRef} role="group" aria-label="Project type">
							{TYPE_CARDS.map((c) => (
								<button
									key={c.key}
									type="button"
									class="pf-wizard__card"
									onClick={() => pick(c)}
								>
									<span class="pf-wizard__cardglyph" aria-hidden="true">
										<Icon name={c.icon} size="xl" />
									</span>
									<span class="pf-wizard__cardlabel">{c.label}</span>
									<span class="pf-wizard__cardhint">{c.hint}</span>
								</button>
							))}
						</div>
					</div>
				)
				: (
					<div class="pf-wizard__step pf-wizard__form">
						<div ref={titleFieldRef} class="pf-wizard__field">
							<label class="pf-split__label" for="pf-wiz-title">Project name</label>
							<InputText
								id="pf-wiz-title"
								value={title}
								onValueChange={(v) => {
									title.value = v;
									if (attempted.value) titleError.value = titleProblem();
								}}
								placeholder="Name your project"
								block
								maxLength={TITLE_MAX}
								required
								status={titleError.value ? "invalid" : "default"}
								aria-describedby="pf-wiz-title-hint"
							/>
							<p
								class={`pf-wizard__hint${titleError.value ? " pf-wizard__hint--error" : ""}`}
								id="pf-wiz-title-hint"
							>
								{titleError.value ?? "You can add the stages and the rules straight after this."}
							</p>
						</div>

						<div class="pf-wizard__field">
							<label class="pf-split__label" for="pf-wiz-brief">
								Brief description
								<span class="pf-split__optional">Optional</span>
							</label>
							<Textarea
								id="pf-wiz-brief"
								value={brief}
								placeholder="One or two lines on what the work is"
								rows={3}
								maxRows={6}
								autoResize
								maxLength={BRIEF_MAX}
								fluid
							/>
						</div>

						<div class="pf-wizard__row">
							<div class="pf-wizard__field">
								<span class="pf-split__label" id="pf-wiz-currency-label">Currency</span>
								<Select
									id="pf-wiz-currency"
									options={CURRENCY_OPTIONS}
									value={code}
									onValueChange={(v) => (currency.value = toDisplayCurrency(v))}
									filter
									filterPlaceholder="Search currencies"
									fluid
									aria-label="Currency"
								/>
							</div>
							<div class="pf-wizard__field">
								<label class="pf-split__label" for="pf-wiz-price">
									{card ? PRICE_LABEL[card.key] : "Price"}
									<span class="pf-split__optional">Optional</span>
								</label>
								<InputNumber
									id="pf-wiz-price"
									value={price}
									onValueChange={(v) => (price.value = v)}
									mode="currency"
									currency={code}
									minFractionDigits={exponent}
									maxFractionDigits={exponent}
									min={0}
									fluid
								/>
							</div>
						</div>

						{error.value && (
							<div class="pf-split__error">
								<Message severity="danger" variant="subtle" size="sm">{error.value}</Message>
							</div>
						)}
						<p class="pf-wizard__note">
							A draft. You finish the setup on the project page, then bring {sellerName}{" "}
							in from its roster.
						</p>
					</div>
				)}
		</Dialog>
	);
}
