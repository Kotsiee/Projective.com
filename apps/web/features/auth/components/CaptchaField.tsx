import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Captcha } from "@projective/ui/utils";
import type { CaptchaAction } from "@projective/types/auth";
import type { CaptchaController } from "../core/captcha-controller.ts";
import {
	fetchCaptchaSiteKey,
	loadTurnstile,
	type TurnstileApi,
	turnstileTheme,
} from "../core/turnstile-js.ts";

/**
 * CaptchaField — an auth form's Cloudflare Turnstile widget (Decision #447), mounted into the dumb
 * `@projective/ui` {@link Captcha} frame. `interaction-only`: most people never see it, and the frame
 * stays concealed (out of layout) until Turnstile asks for a click, so a form's height does not change.
 * It writes the widget's state into the form's {@link CaptchaController}; the form reads the token at
 * submit and resets after it.
 */
export interface CaptchaFieldProps {
	controller: CaptchaController;
	/** The page's site key. `undefined` asks `GET /api/auth/captcha`; `null` renders nothing. */
	siteKey?: string | null;
	action: CaptchaAction;
}

export function CaptchaField(
	{ controller, siteKey, action }: CaptchaFieldProps,
): JSX.Element | null {
	const mount = useRef<HTMLDivElement>(null);
	const absent = useSignal(siteKey === null);

	useEffect(() => {
		if (siteKey === null) return;
		let cancelled = false;
		let api: TurnstileApi | null = null;
		let widgetId: string | undefined;
		controller.phase.value = "loading";

		const start = async () => {
			const key = siteKey ?? await fetchCaptchaSiteKey();
			if (cancelled) return;
			if (!key) {
				absent.value = true;
				controller.phase.value = "off";
				return;
			}
			try {
				api = await loadTurnstile();
			} catch {
				if (!cancelled) controller.phase.value = "failed";
				return;
			}
			if (cancelled || !mount.current) return;
			widgetId = api.render(mount.current, {
				sitekey: key,
				action,
				theme: turnstileTheme(),
				size: "flexible",
				appearance: "interaction-only",
				language: document.documentElement.lang || "auto",
				"response-field": false,
				callback: (token) => {
					controller.token.value = token;
					controller.phase.value = "ready";
				},
				"error-callback": () => {
					controller.token.value = null;
					controller.phase.value = "failed";
					return true;
				},
				"expired-callback": () => {
					controller.token.value = null;
					controller.phase.value = "loading";
				},
				"timeout-callback": () => {
					controller.token.value = null;
				},
				"before-interactive-callback": () => {
					controller.revealed.value = true;
					controller.phase.value = "interactive";
				},
			});
			controller.bindReset(() => {
				if (api && widgetId) api.reset(widgetId);
			});
		};
		void start();

		return () => {
			cancelled = true;
			controller.bindReset(null);
			if (api && widgetId) api.remove(widgetId);
		};
	}, [siteKey, action, controller]);

	if (absent.value) return null;
	return (
		<Captcha
			class="auth-captcha"
			revealed={controller.revealed.value}
			render={() => <div ref={mount} class="auth-captcha__mount" />}
		/>
	);
}
