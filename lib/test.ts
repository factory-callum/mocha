"use strict";
const Runnable = require("./runnable");
const utils = require("./utils");
const errors = require("./errors");
const createInvalidArgumentTypeError = errors.createInvalidArgumentTypeError;
const isString = utils.isString;

const { MOCHA_ID_PROP_NAME } = utils.constants;

/** Interface for a serialized Test object suitable for IPC */
interface SerializedTest {
  $$currentRetry: number;
  $$fullTitle: string;
  $$isPending: boolean;
  $$retriedTest: Test | null;
  $$slow: number;
  $$titlePath: string[];
  body: string;
  duration: number | undefined;
  err: Error | undefined;
  parent: {
    $$fullTitle: string;
    [key: string]: unknown;
  };
  speed: string | undefined;
  state: string | undefined;
  title: string;
  type: string;
  file: string | undefined;
  [key: string]: unknown;
}

class Test extends Runnable {
  type: string;
  _retriedTest: Test | undefined;

  /**
   * Initialize a new `Test` with the given `title` and callback `fn`.
   *
   * @public
   * @extends Runnable
   */
  constructor(title: string, fn?: (...args: unknown[]) => unknown) {
    if (!isString(title)) {
      throw createInvalidArgumentTypeError(
        'Test argument "title" should be a string. Received type "' +
          typeof title +
          '"',
        "title",
        "string",
      );
    }
    super(title, fn);
    this.type = "test";
    this.reset();
  }

  /**
   * Resets the state initially or for a next run.
   */
  reset(): void {
    super.reset();
    this.pending = !this.fn;
    delete this.state;
  }

  /**
   * Set or get retried test
   *
   * @private
   */
  retriedTest(): Test | undefined;
  retriedTest(n: Test): void;
  retriedTest(n?: Test): Test | undefined | void {
    if (!arguments.length) {
      return this._retriedTest;
    }
    this._retriedTest = n;
  }

  /**
   * Add test to the list of tests marked `only`.
   *
   * @private
   */
  markOnly(): void {
    this.parent.appendOnlyTest(this);
  }

  clone(): Test {
    const test = new Test(this.title, this.fn);
    test.timeout(this.timeout());
    test.slow(this.slow());
    test.retries(this.retries());
    test.currentRetry(this.currentRetry());
    test.retriedTest(this.retriedTest() || this);
    test.globals(this.globals());
    test.parent = this.parent;
    test.file = this.file;
    test.ctx = this.ctx;
    return test;
  }

  /**
   * Returns a minimal object suitable for transmission over IPC.
   * Functions are represented by keys beginning with `$$`.
   * @private
   */
  serialize(): SerializedTest {
    return {
      $$currentRetry: this._currentRetry,
      $$fullTitle: this.fullTitle(),
      $$isPending: Boolean(this.pending),
      $$retriedTest: this._retriedTest || null,
      $$slow: this._slow,
      $$titlePath: this.titlePath(),
      body: this.body,
      duration: this.duration,
      err: this.err,
      parent: {
        $$fullTitle: this.parent.fullTitle(),
        [MOCHA_ID_PROP_NAME]: this.parent.id,
      },
      speed: this.speed,
      state: this.state,
      title: this.title,
      type: this.type,
      file: this.file,
      [MOCHA_ID_PROP_NAME]: this.id,
    };
  }
}

module.exports = Test;
