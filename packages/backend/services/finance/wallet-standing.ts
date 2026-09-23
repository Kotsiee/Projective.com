import type {
	StandingComponent,
	StandingGate,
	StandingRung,
	WalletStanding,
} from "@projective/types/finance";
import { PLATFORM_FEE_BP } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import type { TxnRow } from "./wallet-ledger.ts";
import { reasonMeta } from "./wallet-ledger.ts";
import type { WalletContext } from "./wallet-scope.ts";

/**
 * wallet-standing — the earned Standing rung as the wallet shows it: where the subject sits on the
 * Reliability Index, what the next rung asks for, and what the commission taper is worth in money.
 *
 * Everything is read: the ladder (`org.standing_levels`), the commission per rung
 * (`finance.standing_commission_tiers`), and the subject's own cached composite
 * (`org.entity_standing`, written by `org.fn_recompute_standing`). A seller with no row yet is a new
 * seller — rung 1, score 0 — which is the truth, not a placeholder. Standing is earned and can never be
 * bought, so nothing here reads a plan.
 */

// #region Components
/** The weighted inputs, in the order and weights `fn_recompute_standing` scores them. */
const COMPONENTS: readonly { key: StandingComponent["key"]; label: string; weight: number }[] = [
	{ key: "completion", label: "Stage completion", weight: 25 },
	{ key: "on_time", label: "On-time delivery", weight: 25 },
	{ key: "reviews", label: "Review scores", weight: 20 },
	{ key: "dispute_free", label: "Dispute-free rate", weight: 15 },
	{ key: "workload", label: "Workload reliability", weight: 10 },
	{ key: "tenure", label: "Tenure", weight: 5 },
];

const YEAR = 365 * 86_400_000;
// #endregion

/**
 * The Standing projection for a seller subject (`freelancer` for a person, `team` for a team vault),
 * priced against the subject's trailing-12-month earnings in `rows`. `null` for a subject that carries
 * no Standing — a buyer.
 */
export async function standingFor(
	ctx: WalletContext,
	subject: { type: "freelancer" | "team"; id: string },
	rows: readonly TxnRow[],
): Promise<WalletStanding | null> {
	const db = getUserClient(ctx.actor.accessToken);
	const [levelsRes, tiersRes, standingRes] = await Promise.all([
		db.schema("org").from("standing_levels").select("level, label, min_score, min_completed_stages").order("level"),
		db.schema("finance").from("standing_commission_tiers").select("level, marketplace_commission_bp"),
		db.schema("org").from("entity_standing")
			.select("level, score, stages_completed, components")
			.eq("subject_type", subject.type)
			.eq("subject_id", subject.id)
			.maybeSingle(),
	]);
	if (levelsRes.error) throw new Error(`org.standing_levels read failed: ${levelsRes.error.message}`);
	if (tiersRes.error) throw new Error(`finance.standing_commission_tiers read failed: ${tiersRes.error.message}`);
	if (standingRes.error) throw new Error(`org.entity_standing read failed: ${standingRes.error.message}`);

	const commission = new Map<number, number>();
	for (const t of (tiersRes.data ?? []) as { level: number; marketplace_commission_bp: number }[]) {
		commission.set(Number(t.level), Number(t.marketplace_commission_bp));
	}
	const ladder: StandingRung[] = ((levelsRes.data ?? []) as {
		level: number;
		label: string;
		min_score: number | string;
		min_completed_stages: number;
	}[]).map((l) => ({
		level: Number(l.level),
		label: l.label,
		minScore: Math.round(Number(l.min_score)),
		minStages: Number(l.min_completed_stages),
		commissionBp: commission.get(Number(l.level)) ?? 0,
	})).slice(0, 5);
	if (ladder.length === 0) return null;

	const row = standingRes.data as
		| { level: number; score: number | string; stages_completed: number; components: Record<string, number> | null }
		| null;
	const score = row ? Math.round(Number(row.score) * 10) / 10 : 0;
	const stages = row ? Number(row.stages_completed) : 0;
	const current = ladder.find((r) => r.level === Number(row?.level ?? 1)) ?? ladder[0];
	const next = ladder.find((r) => r.level === current.level + 1) ?? null;

	const scoreToNext = next ? Math.max(0, Math.round((next.minScore - score) * 10) / 10) : 0;
	const stagesToNext = next ? Math.max(0, next.minStages - stages) : 0;
	const blockedBy: StandingGate = !next
		? "none"
		: scoreToNext > 0 && stagesToNext > 0
		? "both"
		: scoreToNext > 0
		? "score"
		: stagesToNext > 0
		? "stages"
		: "none";

	// `components` holds each input's POINT contribution (e.g. 23.5 of its 25); the surface shows how
	// the subject scored on that input, 0–100.
	const components: StandingComponent[] = COMPONENTS.map((c) => {
		const points = Number(row?.components?.[c.key] ?? 0);
		return {
			key: c.key,
			label: c.label,
			weight: c.weight,
			scored: Math.min(100, Math.max(0, Math.round((points / c.weight) * 1000) / 10)),
		};
	});

	// The taper made concrete: the commission the trailing year's earnings carried at this rung, and
	// what the same volume would carry at the next. Priced against real earnings, never projected.
	const since = Date.now() - YEAR;
	let volume = 0;
	for (const r of rows) {
		if (r.direction !== "credit" || Date.parse(r.created_at) < since) continue;
		if (reasonMeta(r.reason, r.direction).category !== "earning") continue;
		if (!ctx.money.canConvert(r.currency)) continue;
		volume += ctx.money.convertMinor(r.amount_cents, r.currency);
	}
	const hasVolume = volume > 0;
	const nextBp = next && next.commissionBp !== current.commissionBp ? next.commissionBp : null;

	return {
		subject: subject.type,
		level: current.level,
		label: current.label,
		score,
		stagesCompleted: stages,
		ladder,
		next,
		scoreToNext,
		stagesToNext,
		blockedBy,
		commissionBp: current.commissionBp,
		nextCommissionBp: nextBp,
		platformFeeBp: PLATFORM_FEE_BP,
		components,
		commissionPaid: hasVolume ? ctx.money.derived(Math.round((volume * current.commissionBp) / 10000)) : null,
		commissionAtNext: hasVolume && nextBp !== null
			? ctx.money.derived(Math.round((volume * nextBp) / 10000))
			: null,
		volumeWindow: hasVolume ? ctx.money.derived(volume) : null,
		windowLabel: "Last 12 months",
	};
}
