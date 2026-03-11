"use strict";

const Runnable = require("./runnable");
const { constants } = require("./utils");
const { MOCHA_ID_PROP_NAME } = constants;

interface SerializedHook {
  $$currentRetry: number;
  $$fullTitle: string;
  $$isPending: boolean;
  $$titlePath: string[];
  ctx: object;
  duration: number;
  file: string;
  parent: {
    $$fullTitle: string;
    [key: string]: unknown;
  };
  state: string;
  title: string;
  type: string;
  [key: string]: unknown;
}

class Hook extends Runnable {
  _error?: Error | null;

  /**
   * Initialize a new `Hook` with the given `title` and callback `fn`
   *
   * @extends Runnable
   */
  constructor(title: string, fn?: (...args: unknown[]) => void) {
    super(title, fn);
    this.type = "hook";
    this._error = null;
  }

  /**
   * Resets the state for a next run.
   */
  reset(): void {
    super.reset(this);
    delete this._error;
  }

  /**
   * Get or set the test `err`.
   *
   * @memberof Hook
   * @public
   */
  error(): Error | null;
  error(err: Error): void;
  error(err?: Error): Error | null | void {
    if (!arguments.length) {
      const e = this._error;
      this._error = null;
      return e;
    }

    this._error = err!;
  }

  /**
   * Returns an object suitable for IPC.
   * Functions are represented by keys beginning with `$$`.
   * @private
   */
  serialize(): SerializedHook {
    return {
      $$currentRetry: this.currentRetry(),
      $$fullTitle: this.fullTitle(),
      $$isPending: Boolean(this.isPending()),
      $$titlePath: this.titlePath(),
      ctx:
        this.ctx && this.ctx.currentTest
          ? {
              currentTest: {
                title: this.ctx.currentTest.title,
                [MOCHA_ID_PROP_NAME]: this.ctx.currentTest.id,
              },
            }
          : {},
      duration: this.duration,
      file: this.file,
      parent: {
        $$fullTitle: this.parent.fullTitle(),
        [MOCHA_ID_PROP_NAME]: this.parent.id,
      },
      state: this.state,
      title: this.title,
      type: this.type,
      [MOCHA_ID_PROP_NAME]: this.id,
    };
  }
}

module.exports = Hook;
