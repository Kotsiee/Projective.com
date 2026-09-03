import type { JSX } from "preact";
import "../styles/quick-init-modal.css";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { Button, InputNumber, InputText, Select, SelectButton } from "@projective/ui/fields";
import type { FieldStatus, Option } from "@projective/ui/fields";
import {
	currencyExponent,
	DISPLAY_CURRENCIES,
	toDisplayCurrency,
	toMinorUnits,
} from "@projective/types/finance";
import { ProjectSidebarService } from "../core/ProjectSidebarService.ts";
import { BASELINE_PRICE_HINT, BASELINE_PRICE_LABEL, FORMAT_HINT } from "../types/projects-types.ts";
import type { CreateProject, ProjectCreateFormat } from "../types/projects-types.ts";
import { CloseIcon } from "./glyphs.tsx";

/**
 * QuickInitModal — **Stage 1** of project creation: the smallest surface that can mint a coherent
 * draft, and nothing more.
 *
 * Four controls in one column — title · project type · currency · one baseline price. Everything a
 * project eventually needs (the brief, the rules, the stage architecture, the staffing) is collected
 * on the Stage-2 workspace at `/projects/[projectId]`, because a modal that collects a stage list has
 * to be dismissed before the owner can look anything up and a half-filled one loses everything on
 * dismiss — where a draft row loses nothing. So this surface's only job is to reach a URL.
 *
 * Rendered through {@link BodyPortal} so its `position: fixed` chrome never re-bases onto the blurred
 * shell (the glass-blur trap), and so the currency {@link Select}'s own portalled panel resolves
 * against the viewport rather than the panel.
 */

// #region Vocabulary
/**
 * The two work-flows a client can commission. Exactly two, and derived from the SSOT enum's own
 * members rather than restated — a third option added to {@link ProjectCreateFormat} would appear
 * here automatically instead of silently going unofferable.
 */
const FORMAT_LABEL: Record<ProjectCreateFormat, string> = {
	pipeline: "Pipeline",
	one_off: "One-off",
};

const FORMAT_OPTIONS: Option[] = (
	Object.keys(FORMAT_LABEL) as ProjectCreateFormat[]
).map((value) => ({ value, label: FORMAT_LABEL[value] }));

/**
 * The offerable display currencies, as select options.
 *
 * The label carries the CODE and the currency's name, never the flag: the flag is a decoration that
 * a screen reader announces as a country before either fact that identifies the currency, and two
 * currencies of the same territory would be indistinguishable by it.
 */
const CURRENCY_OPTIONS: Option[] = DISPLAY_CURRENCIES.map((c) => ({
	value: c.code,
	label: `${c.code} — ${c.label}`,
}));

const CURRENCY_BY_CODE = new Map(DISPLAY_CURRENCIES.map((c) => [c.code, c]));

/** The three-column currency row: symbol (decorative) · code · name. */
function currencyRow(opt: Option): JSX.Element {
	const meta = CURRENCY_BY_CODE.get(opt.value);
	return (
		<span class="qim__cur">
			<span class="qim__cur-sym" aria-hidden="true">{meta?.symbol ?? ""}</span>
			<span class="qim__cur-code">{opt.value}</span>
			<span class="qim__cur-name">{meta?.label ?? opt.label}</span>
		</span>
	);
}

/**
 * Stable ids — one instance is ever mounted, and each hint must bind to the control it describes.
 *
 * Only two of the four controls take a `<label for>`: a `radiogroup` and a `combobox` are not
 * labelable elements, so the type selector and the currency select carry an `aria-label` whose text
 * is exactly the visible heading beside them instead (WCAG 2.5.3 holds either way).
 */
const TITLE_ID = "qim-title";
const CURRENCY_ID = "qim-currency";
const PRICE_ID = "qim-price";
const FORMAT_HINT_ID = "qim-format-hint";
const CURRENCY_HINT_ID = "qim-currency-hint";
const PRICE_HINT_ID = "qim-price-hint";

/** The SSOT's own minimum, restated where the control enforces it. */
const TITLE_MIN = 3;
const TITLE_MAX = 160;
// #endregion

// #region Money
/** Round a major-unit figure to the precision its currency can actually store. */
function roundToCurrency(major: number, currency: string): number {
	const factor = 10 ** currencyExponent(currency);
	return Math.round(major * factor) / factor;
}
// #endregion

export interface QuickInitModalProps {
	open: boolean;
	/** Preset work-flow from the lane's create menu; the type selector can still change it. */
	initialFormat: ProjectCreateFormat;
	/**
	 * The currency the project is SEEDED in — the viewer's resolved money context, threaded from SSR.
	 * A seed, not a presentation preference: what is chosen here prices escrow for the life of the
	 * engagement.
	 */
	defaultCurrency: string;
	/** Active workspace id → the created engagement's `scopeId`. */
	scopeId: string;
	onClose: () => void;
	/**
	 * Called with the created project's canonical **uuid** once the write succeeds — never the slug.
	 * A uuid cannot collide, cannot be squatted, and does not change when the owner renames the
	 * project, which a title-derived slug does on the first rename.
	 */
	onCreated: (id: string) => void;
}

/** Which control a server-side field error belongs to. */
type FieldKey = "title" | "format" | "currency" | "baselineAmountCents";

/**
 * The refusal paths this surface can render. A Zod issue whose path names anything else (`scopeId`,
 * `form`) has no control to land on, so it stays in the footer message rather than being pinned to
 * an unrelated field.
 */
const FIELD_KEYS: ReadonlySet<string> = new Set<FieldKey>([
	"title",
	"format",
	"currency",
	"baselineAmountCents",
]);

/**
 * The Quick-Init create modal. Mount once; drive it with `open`.
 */
export function QuickInitModal(props: QuickInitModalProps): JSX.Element | null {
	const { open, initialFormat, defaultCurrency, scopeId, onClose, onCreated } = props;

	const { mounted, state } = usePresence(open);
	const stack = useOverlayStack({ active: mounted, lockScroll: true });
	const panelRef = useRef<HTMLDivElement>(null);
	const titleFieldRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef, initialFocusRef: titleFieldRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	// #region Form state
	const title = useSignal("");
	const format = useSignal<ProjectCreateFormat>(initialFormat);
	const currency = useSignal(toDisplayCurrency(defaultCurrency));
	/** The baseline figure in MAJOR units, as typed. `null` = not priced yet, which is legitimate. */
	const price = useSignal<number | null>(null);

	/**
	 * Per-field interaction state. A field rests on the neutral border and only shows an error once it
	 * has been BLURRED — an input that turns red before the user has had a turn is scolding them for
	 * not having typed yet — and clears back to the plain focus ring the moment it is focused again.
	 */
	const touched = useSignal<Partial<Record<FieldKey, boolean>>>({});
	const focused = useSignal<FieldKey | null>(null);
	/** Field-keyed refusals from the write, cleared per field as soon as that field is edited. */
	const fieldErrors = useSignal<Partial<Record<FieldKey, string>>>({});

	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);
	// #endregion

	// Seed the form whenever the modal (re)opens, so a dismissed half-filled draft never leaks into
	// the next attempt.
	useEffect(() => {
		if (!open) return;
		title.value = "";
		format.value = initialFormat;
		currency.value = toDisplayCurrency(defaultCurrency);
		price.value = null;
		touched.value = {};
		focused.value = null;
		fieldErrors.value = {};
		submitting.value = false;
		formError.value = null;
	}, [open, initialFormat, defaultCurrency]);

	/** The title's own verdict, independent of whether it has been shown yet. */
	const titleVerdict = useComputed<FieldStatus>(() => {
		const len = title.value.trim().length;
		if (len === 0) return "required";
		return len < TITLE_MIN ? "invalid" : "default";
	});

	if (!mounted) return null;

	const fmt = format.value;
	const code = currency.value;

	// #region Field plumbing
	const markTouched = (key: FieldKey) => {
		focused.value = null;
		if (!touched.value[key]) touched.value = { ...touched.value, [key]: true };
	};

	const clearFieldError = (key: FieldKey) => {
		if (fieldErrors.value[key] === undefined) return;
		const next = { ...fieldErrors.value };
		delete next[key];
		fieldErrors.value = next;
	};

	/**
	 * Resolve a control's rendered status. A focused field is always neutral — the focus ring is the
	 * signal the user needs while typing — so an error can only appear on a field they have left.
	 */
	const statusOf = (key: FieldKey, verdict: FieldStatus = "default"): FieldStatus => {
		if (focused.value === key) return "default";
		if (fieldErrors.value[key]) return "invalid";
		return touched.value[key] ? verdict : "default";
	};

	/** Focus/blur tracking lives on a WRAPPER: `blur` does not bubble, but it does capture. */
	const fieldProps = (key: FieldKey) => ({
		class: "qim__field",
		onFocusCapture: () => (focused.value = key),
		onBlurCapture: () => markTouched(key),
	});
	// #endregion

	const titleStatus = statusOf("title", titleVerdict.value);
	const titleError = fieldErrors.value.title ??
		(titleStatus === "required"
			? "Give your project a name."
			: titleStatus === "invalid"
			? `Use at least ${TITLE_MIN} characters.`
			: null);

	// #region Handlers
	const onTitleChange = (value: string) => {
		title.value = value;
		clearFieldError("title");
	};

	const onFormatChange = (value: string | string[]) => {
		const next = Array.isArray(value) ? value[0] : value;
		if (next !== "pipeline" && next !== "one_off") return;
		format.value = next;
		clearFieldError("format");
	};

	/**
	 * Switching currency keeps the figure the client typed — they meant that many units of the
	 * currency they just chose — but re-rounds it to the precision the new currency can store, so the
	 * number on screen is exactly the number that will be sent.
	 */
	const onCurrencyChange = (value: string) => {
		const next = toDisplayCurrency(value);
		currency.value = next;
		clearFieldError("currency");
		if (price.value !== null) price.value = roundToCurrency(price.value, next);
	};

	const onPriceChange = (value: number | null) => {
		price.value = value;
		clearFieldError("baselineAmountCents");
	};

	/**
	 * {@link InputNumber} commits its draft on blur, so Enter must produce one or the figure the
	 * client just typed never reaches the signal the payload is built from — a silent, expensive
	 * class of bug on a field that prices escrow.
	 */
	const onPriceKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		(e.target as HTMLElement | null)?.blur?.();
	};

	const focusTitle = () => {
		titleFieldRef.current?.querySelector<HTMLInputElement>("input")?.focus();
	};

	const buildPayload = (): CreateProject => ({
		title: title.value.trim(),
		format: fmt,
		currency: code,
		baselineAmountCents: toMinorUnits(price.value, code),
		scopeType: "personal",
		scopeId,
	});

	const submit = async () => {
		if (submitting.value) return; // a double-press must not post twice
		if (titleVerdict.value !== "default") {
			touched.value = { ...touched.value, title: true };
			focusTitle();
			return;
		}
		submitting.value = true;
		formError.value = null;
		fieldErrors.value = {};
		const res = await ProjectSidebarService.create(buildPayload());
		submitting.value = false;
		if (res.ok && res.data) {
			onCreated(res.data.id);
			return;
		}
		const next: Partial<Record<FieldKey, string>> = {};
		const seen = new Set<FieldKey>();
		for (const [path, message] of Object.entries(res.errors ?? {})) {
			const key = path.split(".")[0];
			if (!FIELD_KEYS.has(key)) continue;
			next[key as FieldKey] = message;
			seen.add(key as FieldKey);
		}
		fieldErrors.value = next;
		// A refusal a field is already showing must be visible, so mark those fields touched.
		if (seen.size > 0) {
			const marks = { ...touched.value };
			for (const key of seen) marks[key] = true;
			touched.value = marks;
		}
		formError.value = res.message ?? "Couldn't create the project. Try again.";
	};
	// #endregion

	const blocked = titleError !== null || formError.value !== null;
	const note = formError.value ?? titleError ??
		"You can add the brief, the stages and the rules straight after this.";

	return (
		<BodyPortal>
			<div class="qim" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} onClick={onClose} />
				<div
					ref={panelRef}
					class="qim__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label="New project"
					tabIndex={-1}
				>
					<header class="qim__top">
						<h2 class="qim__heading">New project</h2>
						<button type="button" class="qim__close" aria-label="Close" onClick={onClose}>
							{CloseIcon}
						</button>
					</header>

					<div class="qim__body">
						<div ref={titleFieldRef} {...fieldProps("title")}>
							<label class="qim__label" for={TITLE_ID}>Project name</label>
							<InputText
								id={TITLE_ID}
								value={title}
								onValueChange={onTitleChange}
								placeholder="Name your project"
								block
								maxLength={TITLE_MAX}
								required
								status={titleStatus}
							/>
							{titleError && <p class="qim__hint qim__hint--error">{titleError}</p>}
						</div>

						<div {...fieldProps("format")}>
							<span class="qim__label">Project type</span>
							<SelectButton
								options={FORMAT_OPTIONS}
								value={fmt}
								onValueChange={onFormatChange}
								status={statusOf("format")}
								aria-label="Project type"
								aria-describedby={FORMAT_HINT_ID}
							/>
							<p class="qim__hint" id={FORMAT_HINT_ID}>
								{fieldErrors.value.format ?? FORMAT_HINT[fmt]}
							</p>
						</div>

						<div {...fieldProps("currency")}>
							<span class="qim__label">Currency</span>
							<Select
								id={CURRENCY_ID}
								options={CURRENCY_OPTIONS}
								value={code}
								onValueChange={onCurrencyChange}
								optionTemplate={currencyRow}
								status={statusOf("currency")}
								filter
								filterPlaceholder="Search currencies"
								fluid
								aria-label="Currency"
								aria-describedby={CURRENCY_HINT_ID}
							/>
							<p class="qim__hint" id={CURRENCY_HINT_ID}>
								{fieldErrors.value.currency ??
									"What this project is priced in. Fixed once work is funded."}
							</p>
						</div>

						<div {...fieldProps("baselineAmountCents")} onKeyDown={onPriceKeyDown}>
							<label class="qim__label" for={PRICE_ID}>
								{BASELINE_PRICE_LABEL[fmt]}
								<span class="qim__optional">Optional</span>
							</label>
							<InputNumber
								id={PRICE_ID}
								value={price}
								onValueChange={onPriceChange}
								mode="currency"
								currency={code}
								minFractionDigits={currencyExponent(code)}
								maxFractionDigits={currencyExponent(code)}
								min={0}
								status={statusOf("baselineAmountCents")}
								fluid
								aria-describedby={PRICE_HINT_ID}
							/>
							<p class="qim__hint" id={PRICE_HINT_ID}>
								{fieldErrors.value.baselineAmountCents ?? BASELINE_PRICE_HINT[fmt]}
							</p>
						</div>
					</div>

					<footer class="qim__foot">
						<p class="qim__note" role="status" data-tone={blocked ? "error" : "muted"}>
							{note}
						</p>
						<div class="qim__actions">
							<Button variant="text" label="Cancel" onClick={onClose} />
							<Button
								variant="filled"
								severity="primary"
								label={submitting.value ? "Creating…" : "Create project"}
								loading={submitting.value}
								disabled={submitting.value}
								onClick={submit}
							/>
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}
