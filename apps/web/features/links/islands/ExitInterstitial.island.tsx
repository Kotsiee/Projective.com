import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/exit.css";
import { Icon, type IconName } from "@projective/ui/icons";
import type { ExitCheck } from "@projective/types/links";

/**
 * ExitInterstitial — the `/exit` page body: where a link leads and what the platform knows about it,
 * before the reader leaves. A safe link continues straight on; a link that is unchecked, could not be
 * checked or looks suspicious needs an explicit "I understand" first; a blocked link offers no way on.
 *
 * Works without JavaScript: the confirmation is a GET form whose required checkbox brings the page
 * back with the Continue link; with JavaScript, ticking the box reveals it in place. The page never
 * forwards anyone by itself — every exit is the reader's own click — so it cannot be used as an open
 * redirect.
 */

// #region Props
export interface ExitInterstitialProps {
	/** What the server concluded, or null when the address was not a usable link. */
	check: ExitCheck | null;
	/** The reader confirmed on the no-JavaScript round trip. */
	confirmed: boolean;
	/** Where "Go back" leads. */
	backHref: string;
}
// #endregion

interface Copy {
	icon: IconName;
	tone: "neutral" | "warning" | "danger";
	title: string;
	lede: string;
	badge: string | null;
}

const LEAVE_ANCHOR = {
	rel: "noopener noreferrer nofollow",
	referrerpolicy: "no-referrer",
} as const;

function copyFor(check: ExitCheck): Copy {
	switch (check.verdict) {
		case "safe":
			return {
				icon: "external-link",
				tone: "neutral",
				title: "You're leaving Projective",
				lede:
					"We checked this link and found nothing wrong. Pages outside Projective aren't covered by its protections.",
				badge: null,
			};
		case "suspicious":
			return {
				icon: "warning",
				tone: "warning",
				title: "This link looks suspicious",
				lede:
					"Don't sign in, pay or download anything on a page you reached this way unless you're sure who sent it.",
				badge: "Suspicious link — proceed with caution",
			};
		case "blocked":
			return {
				icon: "warning",
				tone: "danger",
				title: "This link is blocked",
				lede: "It's listed as dangerous, so Projective won't open it.",
				badge: "Blocked link",
			};
		case "unscannable":
			return {
				icon: "warning",
				tone: "warning",
				title: "We couldn't check this link",
				lede: "Only continue if you trust the person who sent it.",
				badge: null,
			};
		default:
			return {
				icon: "external-link",
				tone: "neutral",
				title: "You're leaving Projective",
				lede:
					"This link hasn't been checked yet. Only continue if you trust the person who sent it.",
				badge: null,
			};
	}
}

function BackLink({ href }: { href: string }): JSX.Element {
	return (
		<a
			class="ui-button ui-button--secondary ui-button--outlined ui-button--size-md exit__action"
			href={href}
		>
			<span class="ui-button__label">Go back</span>
		</a>
	);
}

function ContinueLink({ check }: { check: ExitCheck }): JSX.Element {
	return (
		<a
			class="ui-button ui-button--primary ui-button--filled ui-button--size-md exit__action"
			href={check.url}
			{...(check.internal ? {} : LEAVE_ANCHOR)}
		>
			<span class="ui-button__label">
				{check.internal ? "Continue" : `Continue to ${check.host}`}
			</span>
		</a>
	);
}

export default function ExitInterstitial(props: ExitInterstitialProps): JSX.Element {
	const agreed = useSignal(props.confirmed);
	const { check } = props;

	if (!check) {
		return (
			<section class="exit" aria-label="Leaving Projective">
				<span class="exit__glyph" data-tone="neutral" aria-hidden="true">
					<Icon name="link" />
				</span>
				<h1 class="exit__title">This isn't a link we can open</h1>
				<p class="exit__lede">It may be cut short, or it isn't a web address.</p>
				<div class="exit__actions">
					<BackLink href={props.backHref} />
				</div>
			</section>
		);
	}

	if (check.internal) {
		return (
			<section class="exit" aria-label="Leaving Projective">
				<span class="exit__glyph" data-tone="neutral" aria-hidden="true">
					<Icon name="link" />
				</span>
				<h1 class="exit__title">This link stays on Projective</h1>
				<p class="exit__dest">
					<span class="exit__url">{check.url}</span>
				</p>
				<div class="exit__actions">
					<BackLink href={props.backHref} />
					<ContinueLink check={check} />
				</div>
			</section>
		);
	}

	const copy = copyFor(check);
	const needsConsent = check.verdict !== "safe" && check.verdict !== "blocked";

	return (
		<section class="exit" aria-label="Leaving Projective">
			<span class="exit__glyph" data-tone={copy.tone} aria-hidden="true">
				<Icon name={copy.icon} />
			</span>
			{copy.badge && <p class="exit__badge" data-tone={copy.tone}>{copy.badge}</p>}
			<h1 class="exit__title">{copy.title}</h1>
			<p class="exit__dest">
				<span class="exit__host">{check.host}</span>
				<span class="exit__url">{check.url}</span>
			</p>
			<p class="exit__lede">{copy.lede}</p>
			{check.reason && <p class="exit__reason">{check.reason}</p>}

			{check.verdict === "blocked" && (
				<div class="exit__actions">
					<BackLink href={props.backHref} />
				</div>
			)}

			{check.verdict === "safe" && (
				<div class="exit__actions">
					<BackLink href={props.backHref} />
					<ContinueLink check={check} />
				</div>
			)}

			{needsConsent && (
				<form class="exit__consent" method="get" action="/exit">
					<input type="hidden" name="url" value={check.url} />
					<label class="exit__check">
						<input
							type="checkbox"
							name="confirm"
							value="1"
							required
							checked={agreed.value}
							onChange={(e) => (agreed.value = e.currentTarget.checked)}
						/>
						<span>I understand this link may be unsafe, and I want to open it</span>
					</label>
					<div class="exit__actions">
						<BackLink href={props.backHref} />
						{agreed.value ? <ContinueLink check={check} /> : (
							<button
								type="submit"
								class="ui-button ui-button--primary ui-button--filled ui-button--size-md"
							>
								<span class="ui-button__label">{`Continue to ${check.host}`}</span>
							</button>
						)}
					</div>
				</form>
			)}
		</section>
	);
}
