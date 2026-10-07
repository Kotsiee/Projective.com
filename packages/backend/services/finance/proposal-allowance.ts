import {
	type AllowanceBlockReason,
	type ProposalAllowanceRow,
	ProposalAllowanceRowSchema,
	type ProposalAllowanceStatus,
	resolveProposalAllowance,
} from "@projective/types/finance";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

/**
 * proposal-allowance — the caller's proposal allowance (weekly quota + anti-burst buffer), the read the
 * account popover's meter, the conversion lane's disclosure and the apply modal's pre-flight gate share.
 *
 * ## The door
 *
 * Live, it is ONE call to `finance.get_proposal_allowance(p_team_id)` as the caller. That definer
 * derives the subject from `auth.uid()` — the person, or a team the caller is an active member of — so
 * the subject cannot be forged from here, and `finance.fn_current_allowance` (which takes ANY subject id
 * and is therefore service-role only) is never called from the app. Reading also opens the week and
 * pays out the lazy drip, so the figures are current the moment they are shown.
 *
 * ## Which subject
 *
 * A team's pool when the caller names a team (the apply modal's applicant picker) or acts as one (a team
 * context); otherwise the person's own allowance — the same subject `trg_meter_application_allowance`
 * spends from when the application is filed.
 *
 * ## Without a database
 *
 * With the finance backend off (`dev:mock`, an unconfigured checkout) the read answers from an
 * in-memory twin of one free-tier week per caller, which the stub apply and withdraw paths move, so the
 * fixture world still meters, refuses and refunds. It is never a fallback for a LIVE failure: a live
 * read that fails throws for the fat service to report, rather than showing a full meter that is not
 * the caller's.
 */

// #region Subject
/**
 * The team whose pool an action spends from: the one named, else the acting team context, else none
 * (the person). Only an id is chosen here — membership is decided by the database door.
 */
export function allowanceTeamFor(actor: ReadActor, teamId?: string | null): string | null {
	if (teamId) return teamId;
	return actor.contextType === "team" && actor.contextId ? actor.contextId : null;
}
// #endregion

// #region Live read
/** The caller may not read that team's allowance — not an active member. */
export class AllowanceAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AllowanceAccessError";
	}
}

async function readLive(
	actor: ReadActor & { accessToken: string },
	teamId: string | null,
): Promise<ProposalAllowanceStatus> {
	const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
		"get_proposal_allowance",
		{ p_team_id: teamId },
	);
	if (error) {
		if (error.code === "42501") throw new AllowanceAccessError(error.message);
		throw new Error(
			`finance.get_proposal_allowance failed (${error.code ?? "no code"}): ${error.message}`,
		);
	}
	const parsed = ProposalAllowanceRowSchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(
			`finance.get_proposal_allowance returned an unexpected shape: ${parsed.error.message}`,
		);
	}
	return resolveProposalAllowance(parsed.data);
}

/**
 * Record a refusal the pre-flight gate made (`finance.record_proposal_denial` → `entitlement.denied`).
 * Telemetry only: it never throws and never delays the refusal it reports.
 */
export async function recordProposalDenial(
	actor: ReadActor,
	reason: AllowanceBlockReason,
	teamId: string | null,
	project: string | null,
): Promise<void> {
	if (!isFinanceBackendLive() || !canReadLive(actor)) return;
	try {
		const { error } = await getUserClient(actor.accessToken).schema("finance").rpc(
			"record_proposal_denial",
			{ p_reason: reason, p_team_id: teamId, p_project: project },
		);
		if (error) console.warn("[allowance:denial]", error.code, error.message);
	} catch (error) {
		console.warn("[allowance:denial]", error instanceof Error ? error.message : error);
	}
}
// #endregion

// #region Fixture twin
/*
 * One free-tier week per caller (and per team), in memory. The magnitudes are the seeded Free plan's —
 * 50 a week, 3 back every 10 hours, banked to 12 — so the fixture meter reads like a real one. The
 * drip runs on the same rule as `fn_current_allowance` (whole windows, the clock advanced by what was
 * paid out), against the server clock.
 */
const STUB_WEEKLY = 50;
const STUB_DRIP = 3;
const STUB_WINDOW_HOURS = 10;
const STUB_CAP = STUB_DRIP * 4;

interface StubPeriod {
	weekStart: number;
	consumed: number;
	buffer: number;
	refreshedAt: number;
}

const stubPeriods = new Map<string, StubPeriod>();

function weekStartOf(now: number): number {
	const d = new Date(now);
	const day = (d.getUTCDay() + 6) % 7; // Monday = 0, as `date_trunc('week', …)` counts it
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function stubKey(actor: ReadActor, teamId: string | null): string {
	return teamId ? `team:${teamId}` : `user:${actor.userId || "guest"}`;
}

function stubPeriod(key: string, now: number): StubPeriod {
	const weekStart = weekStartOf(now);
	let period = stubPeriods.get(key);
	if (!period || period.weekStart !== weekStart) {
		period = { weekStart, consumed: 0, buffer: STUB_CAP, refreshedAt: now };
		stubPeriods.set(key, period);
	}
	const windowMs = STUB_WINDOW_HOURS * 3_600_000;
	if (period.buffer < STUB_CAP && now >= period.refreshedAt + windowMs) {
		const windows = Math.max(1, Math.floor((now - period.refreshedAt) / windowMs));
		period.buffer = Math.min(STUB_CAP, period.buffer + STUB_DRIP * windows);
		period.refreshedAt += windows * windowMs;
	}
	return period;
}

function stubRow(actor: ReadActor, teamId: string | null, now: number): ProposalAllowanceRow {
	const period = stubPeriod(stubKey(actor, teamId), now);
	return {
		subject_type: teamId ? "team" : "user",
		subject_id: teamId ?? (actor.userId || "00000000-0000-0000-0000-000000000000"),
		period_end: new Date(period.weekStart + 7 * 86_400_000).toISOString(),
		granted_units: STUB_WEEKLY,
		consumed_units: period.consumed,
		standing_bonus_units: 0,
		buffer_units: period.buffer,
		buffer_cap: STUB_CAP,
		buffer_refreshed_at: new Date(period.refreshedAt).toISOString(),
		buffer_window_hours: STUB_WINDOW_HOURS,
		buffer_drip: STUB_DRIP,
		plan_code: teamId ? "team_free" : "individual_free",
		plan_label: "Free",
		plan_tier: "free",
		plan_audience: teamId ? "team" : "individual",
		upgrade_plan_label: teamId ? "Pro Team" : "Pro",
		upgrade_weekly_units: 150,
		standing_level: 1,
		enforced: false,
		// The fixture world has no rosters; a named team reads as an eligible two-person team.
		team_member_count: teamId ? 2 : null,
		can_bind_seat: teamId ? true : null,
		server_now: new Date(now).toISOString(),
	};
}

/** Spend one unit in the fixture twin — the stub apply path's mirror of the metering trigger. */
export function stubConsumeAllowance(actor: ReadActor, teamId: string | null): boolean {
	// With the finance backend live the database meters (the insert trigger); the twin stays still.
	if (isFinanceBackendLive()) return true;
	const now = Date.now();
	const period = stubPeriod(stubKey(actor, teamId), now);
	if (period.consumed >= STUB_WEEKLY || period.buffer <= 0) return false;
	if (period.buffer >= STUB_CAP) period.refreshedAt = now;
	period.consumed += 1;
	period.buffer -= 1;
	return true;
}

/** Return one weekly unit in the fixture twin — the stub withdraw path's mirror of the refund trigger. */
export function stubRefundAllowance(actor: ReadActor, teamId: string | null): void {
	if (isFinanceBackendLive()) return;
	const period = stubPeriod(stubKey(actor, teamId), Date.now());
	period.consumed = Math.max(0, period.consumed - 1);
}
// #endregion

/**
 * The caller's proposal allowance — live through the definer door, or the fixture twin with the
 * finance backend off. Throws {@link AllowanceAccessError} for a team the caller is not in, and a plain
 * error for any other live failure.
 */
export async function readProposalAllowance(
	actor: ReadActor,
	teamId: string | null,
): Promise<ProposalAllowanceStatus> {
	if (isFinanceBackendLive() && canReadLive(actor)) return await readLive(actor, teamId);
	return resolveProposalAllowance(stubRow(actor, teamId, Date.now()));
}
