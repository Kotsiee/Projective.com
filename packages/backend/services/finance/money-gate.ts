import { isFinanceBackendLive } from "../../core/supabase.ts";
import { fail, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

/**
 * money-gate — the ONE switch every user-initiated money write in `services/finance` passes before
 * it calls a database door (PRD-B3, LD2).
 *
 * `FINANCE_BACKEND_LIVE` is the money kill switch: off, no finance service moves a balance, places
 * or lifts a hold, changes a pot, a recurring rule, a billing control or a payout schedule, files or
 * decides a spend, or calls Stripe. Every such write answers 503 with {@link MONEY_WRITES_OFF} and
 * `details.code = "money_writes_off"` — the same sentence on every surface, the Stripe rails
 * included. Reads are not gated here: with the flag off a person still sees their real wallet.
 *
 * The order is SYSTEM_ARCHITECTURE.md §Integration Blueprints 1.2's for every user-initiated money
 * call: signed in (401), then this switch (503), then the action's own checks and its door.
 * {@link refuseUnlessMoneyLive} runs both; a helper that only receives an access token (its caller
 * already checked the session) asks {@link moneyWritesLive} before its door instead.
 *
 * `money-gate.test.ts` pins every write; `money-gate.gate.test.ts` fails when a finance door that
 * can write is called from a function that does not pass through this switch.
 */

// #region Contract
/** The sentence every money write answers while the switch is off. */
export const MONEY_WRITES_OFF =
	"Payments are switched off on this server. Nothing was charged or moved.";

/** The `details.code` of that refusal, for a surface that words it itself. */
export const MONEY_WRITES_OFF_CODE = "money_writes_off";

/** The 401 a money write answers a caller with no session. */
const SIGNED_OUT = "Sign in to continue.";

/** Whether user-initiated money writes may run on this host (`FINANCE_BACKEND_LIVE`, not mocked). */
export function moneyWritesLive(): boolean {
	return isFinanceBackendLive();
}

/** The 503 a money write answers while the switch is off. */
export function moneyWritesOff<T = never>(): ServiceResult<T> {
	return fail<T>(503, { message: MONEY_WRITES_OFF, details: { code: MONEY_WRITES_OFF_CODE } });
}

/**
 * Thrown by a door helper whose caller has no result shape to carry the refusal in. The entry point
 * above it has already answered {@link moneyWritesOff}, so this only fires for a caller that skipped
 * the switch: the write fails closed instead of reaching its door.
 */
export class MoneyWritesOffError extends Error {
	constructor() {
		super(MONEY_WRITES_OFF);
		this.name = "MoneyWritesOffError";
	}
}

/** The same refusal in the `{ status, message, details }` shape a door helper's `DbResult` carries. */
export function moneyWritesOffRefusal(): {
	status: number;
	message: string;
	details: { code: string };
} {
	return { status: 503, message: MONEY_WRITES_OFF, details: { code: MONEY_WRITES_OFF_CODE } };
}

/**
 * The chokepoint: a caller with no session is refused 401, then a money write on a host whose switch
 * is off 503; `null` means the write may go on to its own checks and its door.
 */
export function refuseUnlessMoneyLive<T = never>(
	actor: ReadActor | null | undefined,
	signedOut: string = SIGNED_OUT,
): ServiceResult<T> | null {
	if (!actor || !canReadLive(actor)) return fail<T>(401, { message: signedOut });
	return moneyWritesLive() ? null : moneyWritesOff<T>();
}
// #endregion
