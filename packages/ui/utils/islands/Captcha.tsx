import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import "../styles/captcha.css";
import { cx } from "../../core/cx.ts";

// #region Props
/** Render context handed to a {@link CaptchaProps.render} slot. */
export interface CaptchaRenderContext {
	/** The container element the app mounts the real provider widget into. */
	container: RefObject<HTMLDivElement>;
	/** Provider site key (public). Call this from the app with the verification token. */
	verify: (token: string) => void;
}

/** Props for {@link Captcha}. */
export interface CaptchaProps {
	/**
	 * Provider **public** site key. This is a dumb wrapper — pass the real key from the app at the
	 * call site; docs/placeholders use `XXXX-XXXX`. Never embed a secret key here.
	 */
	siteKey?: string;
	/** Human label for the challenge frame (default `"Security challenge"`). */
	label?: string;
	/** Called with the provider's verification token once the app's widget resolves it. */
	onVerify?: (token: string) => void;
	/** Render slot for the app to mount its provider widget (grecaptcha/hcaptcha/turnstile/etc.). */
	render?: (ctx: CaptchaRenderContext) => JSX.Element;
	class?: string;
}
// #endregion

/**
 * Captcha — a **dumb wrapper only**. It renders a token-styled challenge frame plus a labelled mount
 * point (`container` ref) that the application wires to a real bot-detection provider; it deliberately
 * implements no challenge and bypasses nothing. The app passes the provider's public `siteKey`
 * (placeholders use `XXXX-XXXX`) and, from its own provider callback, calls `verify(token)` — which
 * forwards to `onVerify`. Announced as a `group` labelled by the frame heading.
 */
export function Captcha(props: CaptchaProps): JSX.Element {
	const { siteKey = "XXXX-XXXX", label = "Security challenge", onVerify, render, class: className } = props;
	const container = useRef<HTMLDivElement>(null);
	const verify = (token: string) => onVerify?.(token);

	return (
		<div class={cx("ui-captcha", className)} role="group" aria-label={label}>
			<div class="ui-captcha__frame">
				{render
					? render({ container, verify })
					: (
						<div
							ref={container}
							class="ui-captcha__mount"
							data-site-key={siteKey}
							aria-label="Captcha provider mount point"
						/>
					)}
			</div>
			<p class="ui-captcha__note">
				Provider widget is wired by the application; no challenge is implemented here.
			</p>
		</div>
	);
}
