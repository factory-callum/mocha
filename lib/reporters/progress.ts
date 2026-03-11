"use strict";

/**
 * @module Progress
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_TEST_END: string = constants.EVENT_TEST_END;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const color: (type: string, str: string) => string = Base.color;
const cursor: {
  hide(): void;
  show(): void;
  CR(): void;
  deleteLine(): void;
  beginningOfLine(): void;
} = Base.cursor;

/**
 * General progress bar color.
 */

Base.colors.progress = 90;

/** Interface for runner-like objects */
interface RunnerLike {
  total: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options with progress-specific options */
interface ProgressReporterOptions {
  reporterOptions?: Record<string, unknown>;
  open?: string;
  complete?: string;
  incomplete?: string;
  close?: string;
  verbose?: boolean;
  [key: string]: unknown;
}

class Progress extends Base {
  static description: string = "a progress bar";

  /**
   * Constructs a new `Progress` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ProgressReporterOptions) {
    super(runner, options);

    const self = this;
    const width: number = (Base.window.width * 0.5) | 0;
    const total: number = runner.total;
    let complete: number = 0;
    let lastN: number = -1;

    // default chars
    options = options || {};
    const reporterOptions: Record<string, unknown> =
      options.reporterOptions || {};

    options.open = (reporterOptions.open as string) || "[";
    options.complete = (reporterOptions.complete as string) || "▬";
    options.incomplete =
      (reporterOptions.incomplete as string) || Base.symbols.dot;
    options.close = (reporterOptions.close as string) || "]";
    options.verbose = (reporterOptions.verbose as boolean) || false;

    // tests started
    runner.on(EVENT_RUN_BEGIN, function () {
      process.stdout.write("\n");
      cursor.hide();
    });

    // tests complete
    runner.on(EVENT_TEST_END, function () {
      complete++;

      const percent: number = complete / total;
      const n: number = (width * percent) | 0;
      const i: number = width - n;

      if (n === lastN && !options!.verbose) {
        // Don't re-render the line if it hasn't changed
        return;
      }
      lastN = n;

      cursor.CR();
      process.stdout.write("\u001b[J");
      process.stdout.write(color("progress", "  " + options!.open));
      process.stdout.write(Array(n).join(options!.complete!));
      process.stdout.write(Array(i).join(options!.incomplete!));
      process.stdout.write(color("progress", options!.close!));
      if (options!.verbose) {
        process.stdout.write(
          color("progress", " " + complete + " of " + total),
        );
      }
    });

    // tests are complete, output some stats
    // and the failures if any
    runner.once(EVENT_RUN_END, function () {
      cursor.show();
      process.stdout.write("\n");
      self.epilogue();
    });
  }
}

exports = module.exports = Progress;
