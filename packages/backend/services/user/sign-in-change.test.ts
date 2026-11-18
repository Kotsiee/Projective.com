import { assert, assertEquals } from "@std/assert";
import type { MakeSignIn, UserEmail } from "@projective/types/org";
import { CAPTCHA_REFUSAL } from "@projective/types/auth";
import { ok, type ServiceResult } from "../ServiceResult.ts";
import { emailFailure, emailRefusalMessage } from "./emails-refusals.ts";
import {
	type PasswordCheck,
	passwordCheckOf,
	runSignInChange,
	type SignInChangePorts,
	type SignInMove,
	signInMoveOf,
	type SignInPreparation,
} from "./sign-in-change.ts";

/**
 * The sign-in change (Decision #451): the order of its steps and every refusal, over fake ports.
 */

const OLD: UserEmail = {
	id: "0b9e6a2e-0000-4000-8000-000000000001",
	email: "ada@work.example",
	isPrimary: true,
	verifiedAt: "2026-01-01T00:00:00Z",
	isSignIn: true,
	createdAt: "2026-01-01T00:00:00Z",
};
const NEW: UserEmail = {
	id: "0b9e6a2e-0000-4000-8000-000000000002",
	email: "ada@home.example",
	isPrimary: false,
	verifiedAt: "2026-11-01T00:00:00Z",
	isSignIn: false,
	createdAt: "2026-11-01T00:00:00Z",
};
const INPUT: MakeSignIn = { password: "Correct-horse-1", makePrimary: true };

interface FakeOptions {
	prepare?: ServiceResult<SignInPreparation>;
	/** What a second `prepare` (after a failed move) answers. */
	prepareAgain?: ServiceResult<SignInPreparation>;
	check?: PasswordCheck;
	move?: SignInMove;
	record?: ServiceResult<null>;
	ended?: boolean;
}

function fakePorts(options: FakeOptions = {}) {
	const calls: string[] = [];
	const reports: string[] = [];
	let moved = false;
	const ports: SignInChangePorts = {
		list() {
			calls.push("list");
			const emails = moved ? [{ ...OLD, isSignIn: false }, { ...NEW, isSignIn: true }] : [OLD, NEW];
			return Promise.resolve(ok(emails));
		},
		prepare(emailId) {
			const again = calls.some((call) => call.startsWith("prepare:"));
			calls.push(`prepare:${emailId}`);
			const first = options.prepare ?? ok({ targetEmail: NEW.email, currentEmail: OLD.email });
			return Promise.resolve(again && options.prepareAgain ? options.prepareAgain : first);
		},
		checkPassword(email, password) {
			calls.push(`password:${email}:${password}`);
			return Promise.resolve(options.check ?? "ok");
		},
		moveSignIn(email) {
			calls.push(`move:${email}`);
			const result = options.move ?? "ok";
			moved = result === "ok";
			return Promise.resolve(result);
		},
		record(emailId, previousEmailId, makePrimary) {
			calls.push(`record:${emailId}:${previousEmailId}:${makePrimary}`);
			return Promise.resolve(options.record ?? ok(null));
		},
		endOtherSessions() {
			calls.push("end-others");
			return Promise.resolve(options.ended ?? true);
		},
		noticeOldAddress(oldAddress, newAddress) {
			calls.push(`notice:${oldAddress}->${newAddress}`);
			return Promise.resolve("sent");
		},
		report(line) {
			reports.push(line);
		},
	};
	return { ports, calls, reports };
}

Deno.test("a move re-authenticates against the CURRENT address, then moves, records, ends, tells", async () => {
	const { ports, calls } = fakePorts();
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assert(result.ok);
	assertEquals(calls, [
		"list",
		`prepare:${NEW.id}`,
		`password:${OLD.email}:${INPUT.password}`,
		`move:${NEW.email}`,
		`record:${NEW.id}:${OLD.id}:true`,
		"end-others",
		`notice:${OLD.email}->${NEW.email}`,
		"list",
	]);
	assertEquals(result.data?.notice, "sent");
	assertEquals(result.data?.otherSessionsEnded, true);
	assertEquals(result.data?.emails.find((e) => e.isSignIn)?.id, NEW.id);
	assertEquals(
		result.message,
		`You now sign in with ${NEW.email}. Your other devices were signed out.`,
	);
});

Deno.test("a wrong password is a field-keyed 422 and nothing moves", async () => {
	const { ports, calls } = fakePorts({ check: "incorrect" });
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 422);
	assertEquals(result.errors?.password, emailRefusalMessage("password_incorrect"));
	assertEquals(result.details?.refusal, "password_incorrect");
	assertEquals(calls.some((call) => call.startsWith("move:")), false);
});

Deno.test("an unconfirmed address is refused before the password is asked for", async () => {
	const { ports, calls } = fakePorts({
		prepare: emailFailure({ code: "P0001", message: "sign_in_unverified" }),
	});
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 409);
	assertEquals(result.details?.refusal, "sign_in_unverified");
	assertEquals(calls.some((call) => call.startsWith("password:")), false);
});

Deno.test("the two-in-three-days limit is a 429 with when to try again, before the password", async () => {
	const { ports, calls } = fakePorts({
		prepare: emailFailure({
			code: "P0001",
			message: "sign_in_limit",
			details: "2026-11-21T09:30:00Z",
		}),
	});
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 429);
	assertEquals(result.details?.refusal, "sign_in_limit");
	assertEquals(result.details?.retryAt, "2026-11-21T09:30:00.000Z");
	assertEquals(calls.some((call) => call.startsWith("password:")), false);
});

Deno.test("another account's sign-in address answers the one generic refusal", async () => {
	const { ports, calls } = fakePorts({ move: "conflict" });
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 409);
	assertEquals(result.details?.refusal, "sign_in_unavailable");
	assertEquals(result.message, emailRefusalMessage("sign_in_unavailable"));
	assertEquals(/taken|in use|registered/i.test(result.message ?? ""), false);
	assertEquals(calls.some((call) => call.startsWith("record:")), false);
});

Deno.test("a clash that slips in before GoTrue's opaque 500 still answers the generic refusal", async () => {
	const { ports } = fakePorts({
		move: "unavailable",
		prepareAgain: emailFailure({ code: "P0001", message: "sign_in_unavailable" }),
	});
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 409);
	assertEquals(result.details?.refusal, "sign_in_unavailable");
});

Deno.test("a failed move with no clash behind it is an outage, never a success", async () => {
	const { ports, calls } = fakePorts({ move: "unavailable" });
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 503);
	assertEquals(calls.some((call) => call.startsWith("record:")), false);
});

Deno.test("an address that is not the caller's is a 404 before anything else", async () => {
	const { ports, calls } = fakePorts();
	const result = await runSignInChange(ports, "0b9e6a2e-0000-4000-8000-0000000000ff", INPUT);
	assertEquals(result.status, 404);
	assertEquals(calls, ["list"]);
});

Deno.test("GoTrue's bot-check refusal is the retryable CAPTCHA message", async () => {
	const { ports } = fakePorts({ check: "captcha" });
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assertEquals(result.status, 400);
	assertEquals(result.message, CAPTCHA_REFUSAL);
});

Deno.test("once GoTrue has moved, a failed record is reported, never answered as a refusal", async () => {
	const { ports, calls, reports } = fakePorts({
		record: emailFailure({ code: "PGRST000", message: "down" }),
		ended: false,
	});
	const result = await runSignInChange(ports, NEW.id, INPUT);
	assert(result.ok);
	assertEquals(result.data?.otherSessionsEnded, false);
	assert(result.message?.includes("sign out and back in"));
	assertEquals(reports.length, 1);
	assertEquals(reports[0].includes("@"), false);
	assert(calls.includes("end-others"));
});

Deno.test("passwordCheckOf — GoTrue's password-grant refusals", () => {
	assertEquals(passwordCheckOf({ status: 400, code: "invalid_credentials" }), "incorrect");
	assertEquals(passwordCheckOf({ status: 400, code: "captcha_failed" }), "captcha");
	assertEquals(passwordCheckOf({ status: 400, code: "email_not_confirmed" }), "ok");
	assertEquals(passwordCheckOf({ status: 429, code: "over_request_rate_limit" }), "throttled");
	assertEquals(passwordCheckOf({ status: 500 }), "unavailable");
	assertEquals(passwordCheckOf({}), "unavailable");
});

Deno.test("signInMoveOf — a held address is a conflict; anything else an outage", () => {
	assertEquals(signInMoveOf({ status: 422, code: "email_exists" }), "conflict");
	assertEquals(
		signInMoveOf({
			status: 422,
			message: "A user with this email address has already been registered",
		}),
		"conflict",
	);
	assertEquals(
		signInMoveOf({
			status: 500,
			code: "23505",
			message: 'duplicate key value violates unique constraint "users_email_partial_key"',
		}),
		"conflict",
	);
	assertEquals(
		signInMoveOf({ status: 500, code: "23505", message: 'violates "identities_pkey"' }),
		"unavailable",
	);
	assertEquals(signInMoveOf({ status: 422, code: "validation_failed" }), "unavailable");
	assertEquals(signInMoveOf({ status: 500 }), "unavailable");
});
