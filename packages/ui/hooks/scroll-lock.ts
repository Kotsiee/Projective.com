// #region Driver
/** The side effects a {@link ScrollLock} drives; the lock itself only counts claims. */
export interface ScrollLockDriver {
	/** Lock the page. Called on the first claim, never while already locked. */
	apply(): void;
	/** Unlock the page. Called once the last claim has stayed released through a deferral. */
	release(): void;
	/** Run `task` later. Returns a function that cancels it. */
	defer(task: () => void): () => void;
}
// #endregion

// #region Lock
/** A reference-counted page lock. */
export interface ScrollLock {
	/** Add a claim, locking the page if nothing held it. */
	acquire(): void;
	/** Drop a claim. The page unlocks only if no claim arrives before the deferral runs. */
	release(): void;
	/** Live claims. */
	readonly count: number;
	/** Whether the page is locked right now (a released lock stays locked until its deferral runs). */
	readonly locked: boolean;
}

/**
 * Create a reference-counted lock whose release is deferred: when one overlay unmounts and the
 * next one only claims the lock after paint (a modal-stack frame swap), the claim lands before the
 * deferral runs, so the page never unlocks between them.
 */
export function createScrollLock(driver: ScrollLockDriver): ScrollLock {
	let count = 0;
	let locked = false;
	let cancelRelease: (() => void) | null = null;

	return {
		acquire() {
			if (cancelRelease) {
				cancelRelease();
				cancelRelease = null;
			}
			if (!locked) {
				driver.apply();
				locked = true;
			}
			count++;
		},

		release() {
			if (count === 0) return;
			count--;
			if (count > 0 || cancelRelease) return;
			cancelRelease = driver.defer(() => {
				cancelRelease = null;
				if (count > 0 || !locked) return;
				locked = false;
				driver.release();
			});
		},

		get count() {
			return count;
		},

		get locked() {
			return locked;
		},
	};
}
// #endregion
