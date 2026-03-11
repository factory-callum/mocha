"use strict";

/**
 * @module Context
 */

// Use a minimal interface for Runnable to avoid circular dependency
interface RunnableLike {
  timeout(ms?: number | string): number | RunnableLike;
  slow(ms?: number | string): number | RunnableLike;
  skip(): void;
  retries(n?: number): number | RunnableLike;
}

/**
 * Initialize a new `Context`.
 *
 * @private
 */
class Context {
  _runnable!: RunnableLike;
  test!: RunnableLike;

  /**
   * Set or get the context `Runnable` to `runnable`.
   *
   * @private
   */
  runnable(): RunnableLike;
  runnable(runnable: RunnableLike): this;
  runnable(runnable?: RunnableLike): RunnableLike | this {
    if (!arguments.length) {
      return this._runnable;
    }
    this.test = this._runnable = runnable!;
    return this;
  }

  /**
   * Set or get test timeout `ms`.
   *
   * @private
   */
  timeout(): number;
  timeout(ms: number): this;
  timeout(ms?: number): number | this {
    if (!arguments.length) {
      return this.runnable().timeout() as number;
    }
    this.runnable().timeout(ms!);
    return this;
  }

  /**
   * Set or get test slowness threshold `ms`.
   *
   * @private
   */
  slow(): number;
  slow(ms: number): this;
  slow(ms?: number): number | this {
    if (!arguments.length) {
      return this.runnable().slow() as number;
    }
    this.runnable().slow(ms!);
    return this;
  }

  /**
   * Mark a test as skipped.
   *
   * @private
   * @throws PendingError
   */
  skip(): void {
    this.runnable().skip();
  }

  /**
   * Set or get a number of allowed retries on failed tests
   *
   * @private
   */
  retries(): number;
  retries(n: number): this;
  retries(n?: number): number | this {
    if (!arguments.length) {
      return this.runnable().retries() as number;
    }
    this.runnable().retries(n!);
    return this;
  }
}

module.exports = Context;
