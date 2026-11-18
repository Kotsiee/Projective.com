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
	/**
	 * Whether the frame shows (default `true`). `false` keeps the mount in the DOM but takes it out of
	 * layout and the accessibility tree, for a provider that challenges only when it must (Turnstile's
	 * `interaction-only`); the app flips it on from the provider's before-interactive callback.
	 */
	revealed?: boolean;
	/** Optional caption under the frame. */
	note?: string;
	class?: string;
}
// #endregion

/**
 * Captcha — a **dumb wrapper only**. It renders a token-styled challenge frame plus a labelled mount
 * point (`container` ref) that the application wires to a real bot-detection provider; it deliberately
 * implements no challenge and bypasses nothing. The app passes the provider's public `siteKey`
 * (placeholders use `XXXX-XXXX`) and, from its own provider callback, calls `verify(token)` — which
 * forwards to `onVerify`. Announced as a `group` labelled by the frame heading while revealed;
 * concealed, it occupies no space and is hidden from assistive technology.
 */
export function Captcha(props: CaptchaProps): JSX.Element {
	const {
		siteKey = "XXXX-XXXX",
		label = "Security challenge",
		onVerify,
		render,
		revealed = true,
		note,
		class: className,
	} = props;
	const container = useRef<HTMLDivElement>(null);
	const verify = (token: string) => onVerify?.(token);

	return (
		<div
			class={cx("ui-captcha", !revealed && "ui-captcha--concealed", className)}
			role={revealed ? "group" : undefined}
			aria-label={revealed ? label : undefined}
			aria-hidden={revealed ? undefined : "true"}
		>
			<div class="ui-captcha__frame">
				{render ? render({ container, verify }) : (
					<div
						ref={container}
						class="ui-captcha__mount"
						data-site-key={siteKey}
						aria-label="Captcha provider mount point"
					/>
				)}
			</div>
			{note ? <p class="ui-captcha__note">{note}</p> : null}
		</div>
	);
}
