"use strict";

import type { FullErrorStack } from "../types.d.ts";

/**
 * @module Base
 */
/**
 * Module dependencies.
 */

const diff = require("diff");
const milliseconds = require("ms");
const utils = require("../utils");
const supportsColor = require("supports-color");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;

const isBrowser: boolean = utils.isBrowser();

/** Interface for error objects with diff information */
interface DiffError {
  name: string;
  message: string;
  stack?: string;
  showDiff?: boolean;
  actual?: unknown;
  expected?: unknown;
  uncaught?: boolean;
  multiple?: DiffError[];
  inspect?: () => string;
  cause?: DiffError;
}

/** Interface for test-like objects used in reporters */
interface TestLike {
  title: string;
  fullTitle(): string;
  titlePath(): string[];
  duration: number;
  slow(): number;
  speed?: string;
  err?: DiffError;
  body: string;
  file?: string;
  type: string;
}

/** Interface for runner-like objects used in reporters */
interface RunnerLike {
  stats: StatsLike;
  suite: SuiteLike;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for suite-like objects used in reporters */
interface SuiteLike {
  title: string;
  root: boolean;
  suites: SuiteLike[];
  fullTitle(): string;
}

/** Interface for stats */
interface StatsLike {
  suites: number;
  tests: number;
  passes: number;
  pending: number;
  failures: number;
  duration: number;
}

/** Interface for reporter options */
interface ReporterOptions {
  reporterOption?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Interface for diff change objects */
interface DiffChange {
  added?: boolean;
  removed?: boolean;
  value: string;
}

/** Type for color name keys */
type ColorName = string;

function getBrowserWindowSize(): [number, number] {
  if ("innerHeight" in global) {
    return [(global as Record<string, unknown>).innerHeight as number, (global as Record<string, unknown>).innerWidth as number];
  }
  // In a Web Worker, the DOM Window is not available.
  return [640, 480];
}

/**
 * Check if both stdio streams are associated with a tty.
 */

const isatty: boolean = isBrowser || !!(process.stdout.isTTY && process.stderr.isTTY);

/**
 * Save log references to avoid tests interfering (see GH-3604).
 */
const consoleLog: (...args: unknown[]) => void = console.log;

/**
 * @abstract
 * @description
 * All other reporters generally inherit from this reporter.
 */
class Base {
  failures: TestLike[];
  options: ReporterOptions;
  runner: RunnerLike;
  stats: StatsLike;

  static consoleLog: (...args: unknown[]) => void;
  static abstract: boolean;
  static list: (failures: TestLike[]) => void;

  /**
   * Constructs a new `Base` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    const failures: TestLike[] = (this.failures = []);

    if (!runner) {
      throw new TypeError("Missing runner argument");
    }
    this.options = options || {};
    this.runner = runner;
    this.stats = runner.stats; // assigned so Reporters keep a closer reference

    const maxDiffSizeOpt: unknown =
      this.options.reporterOption && this.options.reporterOption.maxDiffSize;
    if (maxDiffSizeOpt !== undefined && !isNaN(Number(maxDiffSizeOpt))) {
      exports.maxDiffSize = Number(maxDiffSizeOpt);
    }

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      if (test.duration > test.slow()) {
        test.speed = "slow";
      } else if (test.duration > test.slow() / 2) {
        test.speed = "medium";
      } else {
        test.speed = "fast";
      }
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike, err: DiffError) {
      if (showDiff(err)) {
        stringifyDiffObjs(err);
      }
      // more than one error per test
      if (test.err && (err as unknown) instanceof Error) {
        test.err.multiple = (test.err.multiple || []).concat(err);
      } else {
        test.err = err;
      }
      failures.push(test);
    });
  }

  /**
   * Outputs common epilogue used by many of the bundled reporters.
   *
   * @public
   * @memberof Mocha.reporters
   */
  epilogue(): void {
    const stats = this.stats;
    let fmt: string;

    Base.consoleLog();

    // passes
    fmt =
      color("bright pass", " ") +
      color("green", " %d passing") +
      color("light", " (%s)");

    Base.consoleLog(fmt, stats.passes || 0, milliseconds(stats.duration));

    // pending
    if (stats.pending) {
      fmt = color("pending", " ") + color("pending", " %d pending");

      Base.consoleLog(fmt, stats.pending);
    }

    // failures
    if (stats.failures) {
      fmt = color("fail", "  %d failing");

      Base.consoleLog(fmt, stats.failures);

      Base.list(this.failures);
      Base.consoleLog();
    }

    Base.consoleLog();
  }
}

Base.consoleLog = consoleLog;

Base.abstract = true;

exports = module.exports = Base;

/**
 * Enable coloring by default, except in the browser interface.
 */
exports.useColors =
  !isBrowser &&
  (supportsColor.stdout || process.env.MOCHA_COLORS !== undefined);

/**
 * Inline diffs instead of +/-
 */

exports.inlineDiffs = false;

/**
 * Truncate diffs longer than this value to avoid slow performance
 */
exports.maxDiffSize = 8192;

/**
 * Default color map.
 */

exports.colors = {
  pass: 90,
  fail: 31,
  "bright pass": 92,
  "bright fail": 91,
  "bright yellow": 93,
  pending: 36,
  suite: 0,
  "error title": 0,
  "error message": 31,
  "error stack": 90,
  checkmark: 32,
  fast: 90,
  medium: 33,
  slow: 31,
  green: 32,
  light: 90,
  "diff gutter": 90,
  "diff added": 32,
  "diff removed": 31,
  "diff added inline": "30;42",
  "diff removed inline": "30;41",
} as Record<string, number | string>;

/**
 * Default symbol map.
 */

exports.symbols = {
  ok: utils.logSymbols.success,
  err: utils.logSymbols.error,
  dot: ".",
  comma: ",",
  bang: "!",
} as Record<string, string>;

/**
 * Color `str` with the given `type`,
 * allowing colors to be disabled,
 * as well as user-defined color
 * schemes.
 *
 * @private
 */
const color: (type: ColorName, str: string) => string = (exports.color = function (type: ColorName, str: string): string {
  if (!exports.useColors) {
    return String(str);
  }
  return "\u001b[" + exports.colors[type] + "m" + str + "\u001b[0m";
});

/**
 * Expose term window size, with some defaults for when stderr is not a tty.
 */

exports.window = {
  width: 75,
} as { width: number };

if (isatty) {
  if (isBrowser) {
    exports.window.width = getBrowserWindowSize()[1];
  } else {
    exports.window.width = (process.stdout.getWindowSize as (fd?: number) => [number, number])(1)[0];
  }
}

/**
 * Expose some basic cursor interactions that are common among reporters.
 */

exports.cursor = {
  hide: function (): void {
    if (isatty) {
      process.stdout.write("\u001b[?25l");
    }
  },

  show: function (): void {
    if (isatty) {
      process.stdout.write("\u001b[?25h");
    }
  },

  deleteLine: function (): void {
    if (isatty) {
      process.stdout.write("\u001b[2K");
    }
  },

  beginningOfLine: function (): void {
    if (isatty) {
      process.stdout.write("\u001b[0G");
    }
  },

  CR: function (): void {
    if (isatty) {
      exports.cursor.deleteLine();
      exports.cursor.beginningOfLine();
    } else {
      process.stdout.write("\r");
    }
  },
};

const showDiff: (err: DiffError) => boolean = (exports.showDiff = function (err: DiffError): boolean {
  return !!(
    err &&
    err.showDiff !== false &&
    sameType(err.actual, err.expected) &&
    err.expected !== undefined
  );
});

function stringifyDiffObjs(err: DiffError): void {
  if (!utils.isString(err.actual) || !utils.isString(err.expected)) {
    err.actual = utils.stringify(err.actual);
    err.expected = utils.stringify(err.expected);
  }
}

/**
 * Returns a diff between 2 strings with coloured ANSI output.
 *
 * @description
 * The diff will be either inline or unified dependent on the value
 * of `Base.inlineDiff`.
 */

const generateDiff: (actual: string, expected: string) => string = (exports.generateDiff = function (actual: string, expected: string): string {
  try {
    const maxLen: number = exports.maxDiffSize;
    let skipped: number = 0;
    if (maxLen > 0) {
      skipped = Math.max(actual.length - maxLen, expected.length - maxLen);
      actual = actual.slice(0, maxLen);
      expected = expected.slice(0, maxLen);
    }
    let result: string = exports.inlineDiffs
      ? inlineDiff(actual, expected)
      : unifiedDiff(actual, expected);
    if (skipped > 0) {
      result = `${result}\n      [mocha] output truncated to ${maxLen} characters, see "maxDiffSize" reporter-option\n`;
    }
    return result;
  } catch {
    const msg: string =
      "\n      " +
      color("diff added", "+ expected") +
      " " +
      color("diff removed", "- actual:  failed to generate Mocha diff") +
      "\n";
    return msg;
  }
});

/**
 * Traverses err.cause and returns all stack traces
 *
 * @private
 */
const getFullErrorStack = function (err: DiffError, seen?: Set<DiffError>): FullErrorStack {
  if (seen && seen.has(err)) {
    return { message: "", msg: "<circular>", stack: "" };
  }

  let message: string;

  if (typeof err.inspect === "function") {
    message = err.inspect() + "";
  } else if (err.message && typeof err.message.toString === "function") {
    message = err.message + "";
  } else {
    message = "";
  }

  let msg: string;
  let stack: string = err.stack || message;
  let index: number = message ? stack.indexOf(message) : -1;

  if (index === -1) {
    msg = message;
  } else {
    index += message.length;
    msg = stack.slice(0, index);
    // remove msg from stack
    stack = stack.slice(index + 1);

    if (err.cause) {
      seen = seen || new Set();
      seen.add(err);
      const causeStack = getFullErrorStack(err.cause, seen);
      stack +=
        "\n   Caused by: " +
        causeStack.msg +
        (causeStack.stack ? "\n" + causeStack.stack : "");
    }
  }

  return {
    message,
    msg,
    stack,
  };
};

/**
 * Outputs the given `failures` as a list.
 *
 * @public
 * @memberof Mocha.reporters.Base
 * @variation 1
 */
exports.list = function (failures: TestLike[]): void {
  let multipleErr: DiffError[] | undefined;
  let multipleTest: TestLike | undefined;
  Base.consoleLog();
  failures.forEach(function (test: TestLike, i: number) {
    // format
    let fmt: string =
      color("error title", "  %s) %s:\n") +
      color("error message", "     %s") +
      color("error stack", "\n%s\n");

    // msg
    let err: DiffError;
    if (test.err && test.err.multiple) {
      if (multipleTest !== test) {
        multipleTest = test;
        multipleErr = [test.err].concat(test.err.multiple);
      }
      err = multipleErr!.shift()!;
    } else {
      err = test.err!;
    }

    const { message, msg: errMsg, stack: errStack } = getFullErrorStack(err);

    let msg: string = errMsg;
    let stack: string = errStack;

    // uncaught
    if (err.uncaught) {
      msg = "Uncaught " + msg;
    }
    // explicitly show diff
    if (!exports.hideDiff && showDiff(err)) {
      stringifyDiffObjs(err);
      fmt =
        color("error title", "  %s) %s:\n%s") + color("error stack", "\n%s\n");
      const match = message.match(/^([^:]+): expected/);
      msg = "\n      " + color("error message", match ? match[1] : msg);

      msg += generateDiff(err.actual as string, err.expected as string);
    }

    // indent stack trace
    stack = stack.replace(/^/gm, "  ");

    // indented test title
    let testTitle: string = "";
    test.titlePath().forEach(function (str: string, index: number) {
      if (index !== 0) {
        testTitle += "\n     ";
      }
      for (let j = 0; j < index; j++) {
        testTitle += "  ";
      }
      testTitle += str;
    });

    Base.consoleLog(fmt, i + 1, testTitle, msg, stack);
  });
};

/**
 * Pads the given `str` to `len`.
 *
 * @private
 */
function pad(str: string | number, len: number): string {
  const s = String(str);
  return Array(len - s.length + 1).join(" ") + s;
}

/**
 * Returns inline diff between 2 strings with coloured ANSI output.
 *
 * @private
 */
function inlineDiff(actual: string, expected: string): string {
  let msg: string = errorDiff(actual, expected);

  // linenos
  const lines: string[] = msg.split("\n");
  if (lines.length > 4) {
    const width: number = String(lines.length).length;
    msg = lines
      .map(function (str: string, i: number) {
        return pad(i + 1, width) + " |" + " " + str;
      })
      .join("\n");
  }

  // legend
  msg =
    "\n" +
    color("diff removed inline", "actual") +
    " " +
    color("diff added inline", "expected") +
    "\n\n" +
    msg +
    "\n";

  // indent
  msg = msg.replace(/^/gm, "      ");
  return msg;
}

/**
 * Returns unified diff between two strings with coloured ANSI output.
 *
 * @private
 */
function unifiedDiff(actual: string, expected: string): string {
  const indent: string = "      ";
  function cleanUp(line: string): string | null {
    if (line[0] === "+") {
      return indent + colorLines("diff added", line);
    }
    if (line[0] === "-") {
      return indent + colorLines("diff removed", line);
    }
    if (line.match(/@@/)) {
      return "--";
    }
    if (line.match(/\\ No newline/)) {
      return null;
    }
    return indent + line;
  }
  function notBlank(line: string | null | undefined): line is string {
    return typeof line !== "undefined" && line !== null;
  }
  const msg: string = diff.createPatch("string", actual, expected);
  const lines: string[] = msg.split("\n").splice(5);
  return (
    "\n      " +
    colorLines("diff added", "+ expected") +
    " " +
    colorLines("diff removed", "- actual") +
    "\n\n" +
    lines.map(cleanUp).filter(notBlank).join("\n")
  );
}

/**
 * Returns character diff for `err`.
 *
 * @private
 */
function errorDiff(actual: string, expected: string): string {
  return diff
    .diffWordsWithSpace(actual, expected)
    .map(function (str: DiffChange) {
      if (str.added) {
        return colorLines("diff added inline", str.value);
      }
      if (str.removed) {
        return colorLines("diff removed inline", str.value);
      }
      return str.value;
    })
    .join("");
}

/**
 * Colors lines for `str`, using the color `name`.
 *
 * @private
 */
function colorLines(name: ColorName, str: string): string {
  return str
    .split("\n")
    .map(function (s: string) {
      return color(name, s);
    })
    .join("\n");
}

/**
 * Object#toString reference.
 */
const objToString: () => string = Object.prototype.toString;

/**
 * Checks that a / b have the same type.
 *
 * @private
 */
function sameType(a: unknown, b: unknown): boolean {
  return objToString.call(a) === objToString.call(b);
}
