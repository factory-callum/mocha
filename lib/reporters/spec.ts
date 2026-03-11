"use strict";

/**
 * @module Spec
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_SUITE_BEGIN: string = constants.EVENT_SUITE_BEGIN;
const EVENT_SUITE_END: string = constants.EVENT_SUITE_END;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const color: (type: string, str: string) => string = Base.color;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  speed?: string;
  duration?: number;
}

/** Interface for suite-like objects */
interface SuiteLike {
  title: string;
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

class Spec extends Base {
  static description: string = "hierarchical & verbose [default]";

  /**
   * Constructs a new `Spec` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    let indents: number = 0;
    let n: number = 0;

    function indent(): string {
      return Array(indents).join("  ");
    }

    runner.on(EVENT_RUN_BEGIN, function () {
      Base.consoleLog();
    });

    runner.on(EVENT_SUITE_BEGIN, function (suite: SuiteLike) {
      ++indents;
      Base.consoleLog(color("suite", "%s%s"), indent(), suite.title);
    });

    runner.on(EVENT_SUITE_END, function () {
      --indents;
      if (indents === 1) {
        Base.consoleLog();
      }
    });

    runner.on(EVENT_TEST_PENDING, function (test: TestLike) {
      const fmt: string = indent() + color("pending", "  - %s");
      Base.consoleLog(fmt, test.title);
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      let fmt: string;
      if (test.speed === "fast") {
        fmt =
          indent() +
          color("checkmark", "  " + Base.symbols.ok) +
          color("pass", " %s");
        Base.consoleLog(fmt, test.title);
      } else {
        fmt =
          indent() +
          color("checkmark", "  " + Base.symbols.ok) +
          color("pass", " %s") +
          color(test.speed as string, " (%dms)");
        Base.consoleLog(fmt, test.title, test.duration);
      }
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike) {
      Base.consoleLog(indent() + color("fail", "  %d) %s"), ++n, test.title);
    });

    runner.once(EVENT_RUN_END, () => this.epilogue());
  }
}

exports = module.exports = Spec;
