import { type BoardStageRef, TicketIntensity } from "@projective/types/projects";
import { CreateCategory } from "@projective/types/org";

/**
 * stage-terms — a `projects.project_stages` row's intensity terms and CREATE category, read onto the
 * {@link BoardStageRef} fields that carry them (Decision #417). One reading for every stage mapper —
 * the live board, the stub store, the fixtures — so none of them can disagree about what a column says.
 */

/** The {@link BoardStageRef} fields a stage's terms fill, every one stated. */
export type StageTerms = Required<
	Pick<
		BoardStageRef,
		"defaultIntensity" | "intensityLocked" | "lowPriceCents" | "highPriceCents" | "createCategory"
	>
>;

/** The `project_stages` columns {@link stageTermsOf} reads. */
export const STAGE_TERM_COLUMNS = [
	"default_intensity",
	"intensity_locked",
	"low_price_cents",
	"high_price_cents",
	"create_category",
] as const;

/** The term columns as a row carries them; each optional, so a row without them reads as their defaults. */
export interface StageTermRow {
	default_intensity?: string | null;
	intensity_locked?: boolean | null;
	low_price_cents?: number | string | null;
	high_price_cents?: number | string | null;
	create_category?: string | null;
}

/** The terms of a stage the client made: standard, unlocked, no tier price of its own, untyped. */
export const CLIENT_STAGE_TERMS: StageTerms = {
	defaultIntensity: "standard",
	intensityLocked: false,
	lowPriceCents: null,
	highPriceCents: null,
	createCategory: null,
};

function priceOf(raw: number | string | null | undefined): number | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const value = typeof raw === "string" ? Number(raw) : raw;
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * A stage row's terms. A value the column could not have held reads as that column's default, and a
 * locked stage reads with no tier prices: it sells at one price, and a stray figure must not price a
 * tier the seller does not sell.
 */
export function stageTermsOf(row: StageTermRow): StageTerms {
	const intensity = TicketIntensity.safeParse(row.default_intensity);
	const category = CreateCategory.safeParse(row.create_category);
	const locked = row.intensity_locked === true;
	return {
		defaultIntensity: intensity.success ? intensity.data : "standard",
		intensityLocked: locked,
		lowPriceCents: locked ? null : priceOf(row.low_price_cents),
		highPriceCents: locked ? null : priceOf(row.high_price_cents),
		createCategory: category.success ? category.data : null,
	};
}
