"use strict";

const EventEmitter = require("node:events").EventEmitter;
const PendingError = require("./pending");
const debug = require("debug")("mocha:runnable");
const milliseconds = require("ms");
const utils = require("./utils");
const {
  createInvalidExceptionError,
  createMultipleDoneError,
  createTimeoutError,
} = require("./errors");

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 * @private
 */
const Date = global.Date;
const setTimeout = global.setTimeout;
const clearTimeout = global.clearTimeout;
const toString = Object.prototype.toString;

const MAX_TIMEOUT = Math.pow(2, 31) - 1;

/** Interface for a Suite-like parent */
interface ParentSuite {
  isPending(): boolean;
  titlePath(): string[];
  appendOnlyTest(test: unknown): void;
  fullTitle(): string;
  id: string;
}

/** Interface for a Context-like object */
interface RunnableContext {
  runnable?: (r: Runnable) => void;
  currentTest?: unknown;
  [key: string]: unknown;
}

/** Done callback type */
type DoneCallback = (err?: Error | null) => void;

/** Test function type (sync, async done-callback, or promise-returning) */
type TestFunction = ((...args: unknown[]) => unknown) & {
  length: number;
  call: (thisArg: unknown, ...args: unknown[]) => unknown;
};

class Runnable extends EventEmitter {
  title: string;
  fn: TestFunction | undefined;
  body: string;
  async: number;
  sync: boolean;
  _timeout: number;
  _slow: number;
  _retries: number;
  timedOut!: boolean;
  _currentRetry!: number;
  pending!: boolean;
  state: string | undefined;
  err: Error | undefined;
  parent!: ParentSuite;
  timer: ReturnType<typeof setTimeout> | undefined;
  _allowedGlobals: string[] | undefined;
  callback!: DoneCallback;
  duration: number | undefined;
  ctx: RunnableContext | undefined;
  file: string | undefined;
  allowUncaught: boolean | undefined;
  asyncOnly: boolean | undefined;
  speed: string | undefined;
  type: string | undefined;
  _trace: Error | undefined;
  id!: string;

  /**
   * Initialize a new `Runnable` with the given `title` and callback `fn`.
   * Additional properties, like `getFullTitle()` and `slow()`, can be viewed in the `Runnable` source.
   *
   * @extends external:EventEmitter
   * @public
   */
  constructor(title: string, fn?: TestFunction) {
    super(title, fn);
    this.title = title;
    this.fn = fn;
    this.body = (fn || "").toString();
    this.async = fn ? fn.length : 0;
    this.sync = !this.async;
    this._timeout = 2000;
    this._slow = 75;
    this._retries = -1;
    utils.assignNewMochaID(this);
    Object.defineProperty(this, "id", {
      get() {
        return utils.getMochaID(this);
      },
    });
    this.reset();
  }

  /**
   * Resets the state initially or for a next run.
   */
  reset(): void {
    this.timedOut = false;
    this._currentRetry = 0;
    this.pending = false;
    delete this.state;
    delete this.err;
  }

  /**
   * Get current timeout value in msecs.
   *
   * Set timeout threshold value (msecs).
   *
   * A string argument can use shorthand (e.g., "2s") and will be converted.
   * The value will be clamped to range [0, 2^31-1].
   * If clamped value matches either range endpoint, timeouts will be disabled.
   *
   * @private
   */
  timeout(): number;
  timeout(ms: number | string): this;
  timeout(ms?: number | string): number | this {
    if (!arguments.length) {
      return this._timeout;
    }
    if (typeof ms === "string") {
      ms = milliseconds(ms) as number;
    }

    // Clamp to range
    const range: [number, number] = [0, MAX_TIMEOUT];
    ms = utils.clamp(ms as number, range);

    // see #1652 for reasoning
    if (ms === range[0] || ms === range[1]) {
      this._timeout = 0;
    } else {
      this._timeout = ms as number;
    }
    debug("timeout %d", this._timeout);

    if (this.timer) {
      this.resetTimeout();
    }
    return this;
  }

  /**
   * Set or get slow `ms`.
   *
   * @private
   */
  slow(): number;
  slow(ms: number | string): this;
  slow(ms?: number | string): number | this {
    if (!arguments.length || typeof ms === "undefined") {
      return this._slow;
    }
    if (typeof ms === "string") {
      ms = milliseconds(ms) as number;
    }
    debug("slow %d", ms);
    this._slow = ms as number;
    return this;
  }

  /**
   * Halt and mark as pending.
   *
   * @memberof Mocha.Runnable
   * @public
   */
  skip(): void {
    this.pending = true;
    throw new PendingError("sync skip; aborting execution");
  }

  /**
   * Check if this runnable or its parent suite is marked as pending.
   *
   * @private
   */
  isPending(): boolean {
    return this.pending || (this.parent && this.parent.isPending());
  }

  /**
   * Return `true` if this Runnable has failed.
   * @private
   */
  isFailed(): boolean {
    return !this.isPending() && this.state === Runnable.constants.STATE_FAILED;
  }

  /**
   * Return `true` if this Runnable has passed.
   * @private
   */
  isPassed(): boolean {
    return !this.isPending() && this.state === Runnable.constants.STATE_PASSED;
  }

  /**
   * Set or get number of retries.
   *
   * @private
   */
  retries(): number;
  retries(n: number): void;
  retries(n?: number): number | void {
    if (!arguments.length) {
      return this._retries;
    }
    this._retries = n!;
  }

  /**
   * Set or get current retry
   *
   * @private
   */
  currentRetry(): number;
  currentRetry(n: number): void;
  currentRetry(n?: number): number | void {
    if (!arguments.length) {
      return this._currentRetry;
    }
    this._currentRetry = n!;
  }

  /**
   * Return the full title generated by recursively concatenating the parent's
   * full title.
   *
   * @memberof Mocha.Runnable
   * @public
   */
  fullTitle(): string {
    return this.titlePath().join(" ");
  }

  /**
   * Return the title path generated by concatenating the parent's title path with the title.
   *
   * @memberof Mocha.Runnable
   * @public
   */
  titlePath(): string[] {
    return this.parent.titlePath().concat([this.title]);
  }

  /**
   * Clear the timeout.
   *
   * @private
   */
  clearTimeout(): void {
    clearTimeout(this.timer);
  }

  /**
   * Reset the timeout.
   *
   * @private
   */
  resetTimeout(): void {
    const ms = this.timeout() || MAX_TIMEOUT;

    this.clearTimeout();
    this.timer = setTimeout(() => {
      if (this.timeout() === 0) {
        return;
      }
      this.callback(this._timeoutError(ms));
      this.timedOut = true;
    }, ms);
  }

  /**
   * Set or get a list of whitelisted globals for this test run.
   *
   * @private
   */
  globals(): string[] | undefined;
  globals(globals: string[]): void;
  globals(globals?: string[]): string[] | undefined | void {
    if (!arguments.length) {
      return this._allowedGlobals;
    }
    this._allowedGlobals = globals;
  }

  /**
   * Run the test and invoke `fn(err)`.
   *
   * @private
   */
  run(fn: DoneCallback): void {
    const self = this;
    const start = new Date();
    const ctx = this.ctx;
    let finished: boolean;
    let errorWasHandled = false;

    if (this.isPending()) return fn();

    // Sometimes the ctx exists, but it is not runnable
    if (ctx && ctx.runnable) {
      ctx.runnable(this);
    }

    // called multiple times
    function multiple(err: Error | undefined): void {
      if (errorWasHandled) {
        return;
      }
      errorWasHandled = true;
      self.emit("error", createMultipleDoneError(self, err));
    }

    // finished
    function done(err?: Error | null): void {
      const ms = self.timeout();
      if (self.timedOut) {
        return;
      }

      if (finished) {
        return multiple(err as Error | undefined);
      }

      self.clearTimeout();
      self.duration = (new Date() as unknown as number) - (start as unknown as number);
      finished = true;
      if (!err && self.duration > ms && ms > 0) {
        err = self._timeoutError(ms);
      }
      fn(err);
    }

    // for .resetTimeout() and Runner#uncaught()
    this.callback = done;

    if (this.fn && typeof this.fn.call !== "function") {
      done(
        new TypeError(
          "A runnable must be passed a function as its second argument.",
        ),
      );
      return;
    }

    // explicit async with `done` argument
    if (this.async) {
      this.resetTimeout();

      // allows skip() to be used in an explicit async context
      this.skip = function asyncSkip(): void {
        this.pending = true;
        done();
        // halt execution, the uncaught handler will ignore the failure.
        throw new PendingError("async skip; aborting execution");
      };

      try {
        callFnAsync(this.fn!);
      } catch (err: unknown) {
        // handles async runnables which actually run synchronously
        errorWasHandled = true;
        if (err instanceof PendingError) {
          return; // done() is already called in this.skip()
        } else if (self.allowUncaught) {
          throw err;
        }
        done(Runnable.toValueOrError(err));
      }
      return;
    }

    // sync or promise-returning
    try {
      callFn(this.fn!);
    } catch (err: unknown) {
      errorWasHandled = true;
      if (err instanceof PendingError) {
        return done();
      } else if (self.allowUncaught) {
        throw err;
      }
      done(Runnable.toValueOrError(err));
    }

    function callFn(fnArg: TestFunction): void {
      const result = fnArg.call(ctx) as Record<string, unknown> | undefined;
      if (result && typeof result.then === "function") {
        self.resetTimeout();
        (result as { then: (onFulfilled: () => null, onRejected: (reason: unknown) => void) => void }).then(
          function () {
            done();
            // Return null so libraries like bluebird do not warn about
            // subsequently constructed Promises.
            return null;
          },
          function (reason: unknown) {
            done(
              (reason as Error) || new Error("Promise rejected with no or falsy reason"),
            );
          },
        );
      } else {
        if (self.asyncOnly) {
          return done(
            new Error(
              "--async-only option in use without declaring `done()` or returning a promise",
            ),
          );
        }

        done();
      }
    }

    function callFnAsync(fnArg: TestFunction): void {
      const wrapper: { result: unknown } = { result: undefined };
      wrapper.result = fnArg.call(ctx, function (err: unknown) {
        if (err instanceof Error || toString.call(err) === "[object Error]") {
          return done(err as Error);
        }
        if (err) {
          if (Object.prototype.toString.call(err) === "[object Object]") {
            return done(
              new Error(
                "done() invoked with non-Error: " + JSON.stringify(err),
              ),
            );
          }
          return done(new Error("done() invoked with non-Error: " + err));
        }
        if (wrapper.result && utils.isPromise(wrapper.result)) {
          return done(
            new Error(
              "Resolution method is overspecified. Specify a callback *or* return a Promise; not both.",
            ),
          );
        }

        done();
      });
    }
  }

  /**
   * Instantiates a "timeout" error
   *
   * @param ms - Timeout (in milliseconds)
   * @returns a "timeout" error
   * @private
   */
  _timeoutError(ms: number): Error {
    let msg = `Timeout of ${ms}ms exceeded. For async tests and hooks, ensure "done()" is called; if returning a Promise, ensure it resolves.`;
    if (this.file) {
      msg += " (" + this.file + ")";
    }
    return createTimeoutError(msg, ms, this.file);
  }

  static constants = utils.defineConstants(
    /**
     * {@link Runnable}-related constants.
     * @public
     * @memberof Runnable
     * @readonly
     * @static
     * @alias constants
     * @enum {string}
     */
    {
      /**
       * Value of `state` prop when a `Runnable` has failed
       */
      STATE_FAILED: "failed",
      /**
       * Value of `state` prop when a `Runnable` has passed
       */
      STATE_PASSED: "passed",
      /**
       * Value of `state` prop when a `Runnable` has been skipped by user
       */
      STATE_PENDING: "pending",
    },
  );

  /**
   * Given `value`, return identity if truthy, otherwise create an "invalid exception" error and return that.
   * @private
   */
  static toValueOrError(value: unknown): Error {
    return (
      (value as Error) ||
      createInvalidExceptionError(
        "Runnable failed with falsy or undefined exception. Please throw an Error instead.",
        value,
      )
    );
  }
}

module.exports = Runnable;
