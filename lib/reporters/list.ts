"use strict";

/**
 * @module List
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_TEST_BEGIN: string = constants.EVENT_TEST_BEGIN;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const color: (type: string, str: string) => string = Base.color;
const cursor: { CR: () => void; hide: () => void; show: () => void; deleteLine: () => void; beginningOfLine: () => void } = Base.cursor;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  fullTitle(): string;
  speed?: string;
  duration?: number;
}

/** Interface for runner-like objects */
interface RunnerLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options */
interface ReporterOptions {
  [key: string]: unknown;
}

class List extends Base {
  static description: string = 'like "spec" reporter but flat';

  /**
   * Constructs a new `List` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    let n: number = 0;

    runner.on(EVENT_RUN_BEGIN, function () {
      Base.consoleLog();
    });

    runner.on(EVENT_TEST_BEGIN, function (test: TestLike) {
      process.stdout.write(color("pass", "    " + test.fullTitle() + ": "));
    });

    runner.on(EVENT_TEST_PENDING, function (test: TestLike) {
      const fmt: string = color("checkmark", "  -") + color("pending", " %s");
      Base.consoleLog(fmt, test.fullTitle());
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      const fmt: string =
        color("checkmark", "  " + Base.symbols.ok) +
        color("pass", " %s: ") +
        color(test.speed as string, "%dms");
      cursor.CR();
      Base.consoleLog(fmt, test.fullTitle(), test.duration);
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike) {
      cursor.CR();
      Base.consoleLog(color("fail", "  %d) %s"), ++n, test.fullTitle());
    });

    runner.once(EVENT_RUN_END, () => this.epilogue());
  }
}

exports = module.exports = List;
