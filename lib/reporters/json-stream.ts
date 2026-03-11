"use strict";

/**
 * @module JSONStream
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  fullTitle(): string;
  file?: string;
  duration?: number;
  currentRetry(): number;
  speed?: string;
  err?: string;
  stack?: string | null;
}

/** Interface for clean test output */
interface CleanTestOutput {
  title: string;
  fullTitle: string;
  file?: string;
  duration?: number;
  currentRetry: number;
  speed?: string;
  err?: string;
  stack?: string | null;
}

/** Interface for error-like objects */
interface ErrorLike {
  message: string;
  stack?: string | null;
}

/** Interface for runner-like objects */
interface RunnerLike {
  total: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options */
interface ReporterOptions {
  [key: string]: unknown;
}

class JSONStream extends Base {
  static description: string = "newline delimited JSON events";

  /**
   * Constructs a new `JSONStream` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    const self = this;
    const total: number = runner.total;

    runner.once(EVENT_RUN_BEGIN, function () {
      writeEvent(["start", { total }]);
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      writeEvent(["pass", clean(test)]);
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike, err: ErrorLike) {
      const cleaned: CleanTestOutput = clean(test);
      cleaned.err = err.message;
      cleaned.stack = err.stack || null;
      writeEvent(["fail", cleaned]);
    });

    runner.once(EVENT_RUN_END, function () {
      writeEvent(["end", self.stats]);
    });
  }
}

/**
 * Writes Mocha event to reporter output stream.
 */
function writeEvent(event: unknown[]): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * Returns an object literal representation of `test`
 * free of cyclic properties, etc.
 */
function clean(test: TestLike): CleanTestOutput {
  return {
    title: test.title,
    fullTitle: test.fullTitle(),
    file: test.file,
    duration: test.duration,
    currentRetry: test.currentRetry(),
    speed: test.speed,
  };
}

exports = module.exports = JSONStream;
