import { useRef } from "preact/hooks";
import { type CaptchaController, createCaptchaController } from "../core/captcha-controller.ts";

/** One bot-check controller for the life of the calling form (Decision #447). */
export function useCaptcha(): CaptchaController {
	const ref = useRef<CaptchaController | null>(null);
	ref.current ??= createCaptchaController();
	return ref.current;
}
