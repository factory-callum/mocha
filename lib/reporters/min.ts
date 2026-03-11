"use strict";

/**
 * @module Min
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;

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

class Min extends Base {
  static description: string = "essentially just a summary";

  /**
   * Constructs a new `Min` reporter instance.
   *
   * @description
   * This minimal test reporter is best used with '--watch'.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    runner.on(EVENT_RUN_BEGIN, function () {
      // clear screen
      process.stdout.write("\u001b[2J");
      // set cursor position
      process.stdout.write("\u001b[1;3H");
    });

    runner.once(EVENT_RUN_END, () => this.epilogue());
  }
}

exports = module.exports = Min;
