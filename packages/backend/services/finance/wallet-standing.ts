import type {
	SellerCommissionWindow,
	StandingComponent,
	StandingGate,
	StandingRung,
	WalletStanding,
} from "@projective/types/finance";
import { PLATFORM_FEE_BP, SellerCommissionSchema } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import type { TxnRow } from "./wallet-ledger.ts";
import type { WalletContext } from "./wallet-scope.ts";

/**
 * wallet-standing — the earned Standing rung as the wallet shows it: where the subject sits on the
 * Reliability Index, what the next rung asks for, and what the commission taper is worth in money.
 *
 * Everything is read: the ladder (`org.standing_levels`), the commission per rung
 * (`finance.standing_commission_tiers`), the subject's own cached composite (`org.entity_standing`,
 * written by `org.fn_recompute_standing`), and `finance.get_seller_commission` — the rate the subject's
 * next product sale is charged and the fees their sales recorded (Decision #337, ruling M1). A seller
 * with no row yet is a new seller — rung 1, score 0 — which is the truth, not a placeholder. Standing is
 * earned and can never be bought, so nothing here reads a plan.
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
// #endregion

/**
 * The Standing projection for a seller subject (`freelancer` for a person, `team` for a team vault),
 * its commission priced against the fees the subject's product sales of the last 12 months recorded.
 * `null` for a subject that carries no Standing — a buyer. `_rows` (the wallet's ledger) is not read: a
 * sale's credit is net of its fee and an escrow release pays no commission, so the figures come from
 * the order lines.
 */
export async function standingFor(
	ctx: WalletContext,
	subject: { type: "freelancer" | "team"; id: string },
	_rows: readonly TxnRow[],
): Promise<WalletStanding | null> {
	const db = getUserClient(ctx.actor.accessToken);
	// The flat platform fee as the database applies it to this subject: `get_purchase_owner` resolves
	// `finance.fn_effective_platform_fee_bp` (a negotiated rate, else the platform param) for a caller
	// who can see the subject's finances. A person is a `user` owner; a team vault is a `team`.
	const ownerType = subject.type === "team" ? "team" : "user";
	const [levelsRes, tiersRes, standingRes, feeRes, salesRes] = await Promise.all([
		db.schema("org").from("standing_levels").select("level, label, min_score, min_completed_stages").order("level"),
		db.schema("finance").from("standing_commission_tiers").select("level, marketplace_commission_bp"),
		db.schema("org").from("entity_standing")
			.select("level, score, stages_completed, components")
			.eq("subject_type", subject.type)
			.eq("subject_id", subject.id)
			.maybeSingle(),
		db.schema("finance").rpc("get_purchase_owner", {
			p_owner_type: ownerType,
			p_owner_id: subject.id,
		}),
		// The commission as `place_wallet_order` charges it: the same resolver, for this subject.
		db.schema("finance").rpc("get_seller_commission", {
			p_subject_type: subject.type,
			p_subject_id: subject.id,
		}),
	]);
	if (levelsRes.error) throw new Error(`org.standing_levels read failed: ${levelsRes.error.message}`);
	if (tiersRes.error) throw new Error(`finance.standing_commission_tiers read failed: ${tiersRes.error.message}`);
	if (standingRes.error) throw new Error(`org.entity_standing read failed: ${standingRes.error.message}`);
	if (feeRes.error) throw new Error(`finance.get_purchase_owner failed: ${feeRes.error.message}`);
	if (salesRes.error) throw new Error(`finance.get_seller_commission failed: ${salesRes.error.message}`);
	const effectiveFeeBp = (feeRes.data as { platform_fee_bp?: number | null } | null)?.platform_fee_bp;
	const sales = SellerCommissionSchema.parse(salesRes.data);

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

	// The taper made concrete from what the sales recorded: the commission the trailing year's product
	// sales were charged, and what the same lines would cost at the next rung, both summed by the
	// database per currency. Shown in the display currency only when every currency converts: a total
	// that left one out would understate the commission.
	const commissionBp = sales.commission_bp;
	const nextBp = sales.next_commission_bp !== null && sales.next_commission_bp < commissionBp
		? sales.next_commission_bp
		: null;
	const windows = sales.currencies;
	const priced = windows.length > 0 && windows.every((w) => ctx.money.canConvert(w.currency));
	const sum = (pick: (w: SellerCommissionWindow) => number | null) =>
		ctx.money.derived(
			windows.reduce((total, w) => total + ctx.money.convertMinor(pick(w) ?? 0, w.currency), 0),
		);

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
		commissionBp,
		nextCommissionBp: nextBp,
		platformFeeBp: typeof effectiveFeeBp === "number" ? effectiveFeeBp : PLATFORM_FEE_BP,
		components,
		commissionPaid: priced ? sum((w) => w.fee_minor) : null,
		commissionAtNext: priced && nextBp !== null ? sum((w) => w.at_next_minor) : null,
		volumeWindow: priced ? sum((w) => w.paid_minor) : null,
		windowLabel: "Last 12 months",
	};
}
