import { Component, type ComponentChildren, type ErrorInfo } from "preact";
import { InlineNotice } from "./InlineNotice.tsx";

// #region Props
/** Props for {@link ErrorBoundary}. */
export interface ErrorBoundaryProps {
	children: ComponentChildren;
	/**
	 * What to render in place of the failed subtree. Receives the error and a `reset` that re-mounts
	 * the children. Defaults to an assertive {@link InlineNotice} with a "Try again" action.
	 */
	fallback?: (error: unknown, reset: () => void) => ComponentChildren;
	/** Report the failure. Called once per caught error, after the fallback is scheduled. */
	onError?: (error: unknown, info: ErrorInfo) => void;
	/** Sentence for the default fallback (default "This section couldn’t be shown."). */
	message?: string;
}

interface ErrorBoundaryState {
	error: unknown;
	failed: boolean;
}
// #endregion

/**
 * ErrorBoundary — contains a render or lifecycle failure to the subtree that threw, so one broken
 * island region does not blank the rest of the page. Client-only in effect: server rendering errors
 * go to the app's `_error` route instead. Wrap an island's root (or a risky region inside it), pass
 * `onError` to report, and optionally `fallback` for a bespoke replacement.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	override state: ErrorBoundaryState = { error: null, failed: false };

	static override getDerivedStateFromError(error: unknown): ErrorBoundaryState {
		return { error, failed: true };
	}

	override componentDidCatch(error: unknown, info: ErrorInfo): void {
		this.props.onError?.(error, info);
	}

	reset = (): void => {
		this.setState({ error: null, failed: false });
	};

	override render() {
		if (!this.state.failed) return this.props.children;
		if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
		return (
			<InlineNotice
				text={this.props.message ?? "This section couldn’t be shown."}
				actionLabel="Try again"
				onAction={this.reset}
				assertive
			/>
		);
	}
}
