"use strict";

/**
 * @module XUnit
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const utils = require("../utils");
const fs = require("node:fs");
const path = require("node:path");
const errors = require("../errors");
const createUnsupportedError: (msg: string) => Error =
  errors.createUnsupportedError;
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const STATE_FAILED: string = require("../runnable").constants.STATE_FAILED;
const escape: (html: string) => string = utils.escape;

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */
const DateConstructor: DateConstructor = global.Date;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  parent: { fullTitle(): string };
  file?: string;
  duration: number;
  state?: string;
  err?: ErrorLike;
  isPending(): boolean;
  body: string;
}

/** Interface for error-like objects */
interface ErrorLike {
  message?: string;
  stack?: string;
  actual?: unknown;
  expected?: unknown;
  showDiff?: boolean;
}

/** Interface for stats-like objects */
interface StatsLike {
  tests: number;
  failures: number;
  passes: number;
  duration: number;
}

/** Interface for runner-like objects */
interface RunnerLike {
  stats: StatsLike;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Interface for reporter options */
interface XUnitReporterOptions {
  reporterOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Interface for file write stream */
interface WriteStream {
  write(data: string): boolean;
  end(cb?: () => void): void;
}

class XUnit extends Base {
  static description: string = "XUnit-compatible XML output";

  fileStream?: WriteStream;

  /**
   * Constructs a new `XUnit` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: XUnitReporterOptions) {
    super(runner, options);

    const stats: StatsLike = this.stats;
    const tests: TestLike[] = [];
    const self = this;

    // the name of the test suite, as it will appear in the resulting XML file
    let suiteName: string | undefined;

    // the default name of the test suite if none is provided
    const DEFAULT_SUITE_NAME: string = "Mocha Tests";

    if (options && options.reporterOptions) {
      if (options.reporterOptions.output) {
        if (!fs.createWriteStream) {
          throw createUnsupportedError("file output not supported in browser");
        }

        fs.mkdirSync(
          path.dirname(options.reporterOptions.output as string),
          {
            recursive: true,
          },
        );
        self.fileStream = fs.createWriteStream(
          options.reporterOptions.output as string,
        );
      }

      // get the suite name from the reporter options (if provided)
      suiteName = options.reporterOptions.suiteName as string | undefined;
    }

    // fall back to the default suite name
    suiteName = suiteName || DEFAULT_SUITE_NAME;

    runner.on(EVENT_TEST_PENDING, function (test: TestLike) {
      tests.push(test);
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      tests.push(test);
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike) {
      tests.push(test);
    });

    runner.once(EVENT_RUN_END, function () {
      self.write(
        tag(
          "testsuite",
          {
            name: suiteName!,
            tests: stats.tests,
            failures: 0,
            errors: stats.failures,
            skipped: stats.tests - stats.failures - stats.passes,
            timestamp: new DateConstructor().toUTCString(),
            time: stats.duration / 1000 || 0,
          },
          false,
        ),
      );

      tests.forEach(function (t: TestLike) {
        self.test(t, options);
      });

      self.write("</testsuite>");
    });
  }

  /**
   * Override done to close the stream (if it's a file).
   */
  done(failures: number, fn: (failures: number) => void): void {
    if (this.fileStream) {
      this.fileStream.end(function () {
        fn(failures);
      });
    } else {
      fn(failures);
    }
  }

  /**
   * Write out the given line.
   */
  write(line: string): void {
    if (this.fileStream) {
      this.fileStream.write(line + "\n");
    } else if (typeof process === "object" && process.stdout) {
      process.stdout.write(line + "\n");
    } else {
      Base.consoleLog(line);
    }
  }

  /**
   * Output tag for the given `test.`
   */
  test(test: TestLike, options?: XUnitReporterOptions): void {
    Base.useColors = false;

    const attrs: Record<string, string | number | undefined> = {
      classname: test.parent.fullTitle(),
      name: test.title,
      file: testFilePath(test.file, options),
      time: test.duration / 1000 || 0,
    };

    if (test.state === STATE_FAILED) {
      const err: ErrorLike = test.err!;
      const diffStr: string =
        !Base.hideDiff && Base.showDiff(err)
          ? "\n" + Base.generateDiff(err.actual, err.expected)
          : "";
      this.write(
        tag(
          "testcase",
          attrs,
          false,
          tag(
            "failure",
            {},
            false,
            escape(err.message || "") +
              escape(diffStr) +
              "\n" +
              escape(err.stack || ""),
          ),
        ),
      );
    } else if (test.isPending()) {
      this.write(tag("testcase", attrs, false, tag("skipped", {}, true)));
    } else {
      this.write(tag("testcase", attrs, true));
    }
  }
}

/**
 * HTML tag helper.
 */
function tag(
  name: string,
  attrs: Record<string, string | number | undefined>,
  close: boolean,
  content?: string,
): string {
  const end: string = close ? "/>" : ">";
  const pairs: string[] = [];
  let result: string;

  for (const key in attrs) {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
      pairs.push(key + '="' + escape(String(attrs[key])) + '"');
    }
  }

  result = "<" + name + (pairs.length ? " " + pairs.join(" ") : "") + end;
  if (content) {
    result += content + "</" + name + end;
  }
  return result;
}

function testFilePath(
  filepath: string | undefined,
  options?: XUnitReporterOptions,
): string | undefined {
  if (
    filepath &&
    options &&
    options.reporterOptions &&
    options.reporterOptions.showRelativePaths
  ) {
    return path.relative(process.cwd(), filepath);
  }

  return filepath;
}

exports = module.exports = XUnit;
