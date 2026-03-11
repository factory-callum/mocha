"use strict";

/**
 * @module Dot
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;

/** Interface for test-like objects */
interface TestLike {
  speed?: string;
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

class Dot extends Base {
  static description: string = "dot matrix representation";

  /**
   * Constructs a new `Dot` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    const self = this;
    const width: number = (Base.window.width * 0.75) | 0;
    let n: number = -1;

    runner.on(EVENT_RUN_BEGIN, function () {
      process.stdout.write("\n");
    });

    runner.on(EVENT_TEST_PENDING, function () {
      if (++n % width === 0) {
        process.stdout.write("\n  ");
      }
      process.stdout.write(Base.color("pending", Base.symbols.comma));
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      if (++n % width === 0) {
        process.stdout.write("\n  ");
      }
      if (test.speed === "slow") {
        process.stdout.write(Base.color("bright yellow", Base.symbols.dot));
      } else {
        process.stdout.write(Base.color(test.speed as string, Base.symbols.dot));
      }
    });

    runner.on(EVENT_TEST_FAIL, function () {
      if (++n % width === 0) {
        process.stdout.write("\n  ");
      }
      process.stdout.write(Base.color("fail", Base.symbols.bang));
    });

    runner.once(EVENT_RUN_END, function () {
      process.stdout.write("\n");
      self.epilogue();
    });
  }
}

exports = module.exports = Dot;
