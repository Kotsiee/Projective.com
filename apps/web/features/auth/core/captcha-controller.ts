import { effect, type Signal, signal } from "@preact/signals";

/**
 * captcha-controller — one auth form's bot-check state (Decision #447), written by `CaptchaField`
 * from the Turnstile widget's callbacks and read by the form at submit. Pure signals, no DOM.
 */

/**
 * `off`: no widget (no site key). `loading`: the check is running. `ready`: a token is held.
 * `interactive`: the widget is asking the person to act. `failed`: no token will come.
 */
export type CaptchaPhase = "off" | "loading" | "ready" | "interactive" | "failed";

/** A form's handle on its bot check. */
export interface CaptchaController {
	readonly phase: Signal<CaptchaPhase>;
	readonly token: Signal<string | null>;
	/** Whether the widget's frame shows: from its first request for interaction until the next reset. */
	readonly revealed: Signal<boolean>;
	/**
	 * The token to send. While the check is still running it waits, up to `timeoutMs`, for a token or a
	 * failure; `undefined` when there is none, and the server then decides.
	 */
	take(timeoutMs?: number): Promise<string | undefined>;
	/** Spend the token after a submit: tokens are single-use, so the widget runs a fresh check. */
	reset(): void;
	/** Wire the live widget's own reset (`null` once it unmounts). */
	bindReset(reset: (() => void) | null): void;
}

const DEFAULT_TAKE_TIMEOUT_MS = 30_000;

/** A controller in the `off` phase; `CaptchaField` moves it on when it mounts. */
export function createCaptchaController(): CaptchaController {
	const phase = signal<CaptchaPhase>("off");
	const token = signal<string | null>(null);
	const revealed = signal(false);
	let widgetReset: (() => void) | null = null;

	function take(timeoutMs = DEFAULT_TAKE_TIMEOUT_MS): Promise<string | undefined> {
		if (phase.peek() === "off") return Promise.resolve(undefined);
		return new Promise((resolve) => {
			let settled = false;
			let dispose: () => void = () => {};
			const finish = (value: string | undefined) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				queueMicrotask(() => dispose());
				resolve(value);
			};
			const timer = setTimeout(() => finish(undefined), timeoutMs);
			dispose = effect(() => {
				const current = token.value;
				const now = phase.value;
				if (current) finish(current);
				else if (now === "failed" || now === "off") finish(undefined);
			});
		});
	}

	function reset(): void {
		token.value = null;
		revealed.value = false;
		if (phase.peek() !== "off") phase.value = "loading";
		widgetReset?.();
	}

	return {
		phase,
		token,
		revealed,
		take,
		reset,
		bindReset(next) {
			widgetReset = next;
		},
	};
}
