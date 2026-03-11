"use strict";

/**
 * @module JSON
 */
/**
 * Module dependencies.
 */

const Base = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const createUnsupportedError: (msg: string) => Error =
  require("../errors").createUnsupportedError;
const utils = require("../utils");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_TEST_END: string = constants.EVENT_TEST_END;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  fullTitle(): string;
  file?: string;
  duration?: number;
  currentRetry(): number;
  speed?: string;
  err?: ErrorLike;
}

/** Interface for error-like objects */
interface ErrorLike {
  message?: string;
  stack?: string;
  [key: string]: unknown;
}

/** Interface for runner-like objects */
interface RunnerLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
  testResults?: Record<string, unknown>;
  total: number;
}

/** Interface for reporter options */
interface ReporterOptions {
  reporterOption?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Interface for clean test output */
interface CleanTest {
  title: string;
  fullTitle: string;
  file?: string;
  duration?: number;
  currentRetry: number;
  speed?: string;
  err: Record<string, unknown>;
}

class JSONReporter extends Base {
  static description: string = "single JSON object";

  /**
   * Constructs a new `JSON` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options: ReporterOptions = {}) {
    super(runner, options);

    const self = this;
    const tests: TestLike[] = [];
    const pending: TestLike[] = [];
    const failures: TestLike[] = [];
    const passes: TestLike[] = [];
    let output: string | undefined;

    if (options.reporterOption && options.reporterOption.output) {
      if (utils.isBrowser()) {
        throw createUnsupportedError("file output not supported in browser");
      }
      output = options.reporterOption.output as string;
    }

    runner.on(EVENT_TEST_END, function (test: TestLike) {
      tests.push(test);
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      passes.push(test);
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike) {
      failures.push(test);
    });

    runner.on(EVENT_TEST_PENDING, function (test: TestLike) {
      pending.push(test);
    });

    runner.once(EVENT_RUN_END, function () {
      const obj = {
        stats: self.stats,
        tests: tests.map(clean),
        pending: pending.map(clean),
        failures: failures.map(clean),
        passes: passes.map(clean),
      };

      runner.testResults = obj;

      const json: string = JSON.stringify(obj, null, 2);
      if (output) {
        try {
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.writeFileSync(output, json);
        } catch (err: unknown) {
          console.error(
            `${Base.symbols.err} [mocha] writing output to "${output}" failed: ${(err as Error).message}\n`,
          );
          process.stdout.write(json);
        }
      } else {
        process.stdout.write(json);
      }
    });
  }
}

/**
 * Return a plain-object representation of `test`
 * free of cyclic properties etc.
 */
function clean(test: TestLike): CleanTest {
  let err: ErrorLike = test.err || {};
  if (err instanceof Error) {
    err = errorJSON(err);
  }

  return {
    title: test.title,
    fullTitle: test.fullTitle(),
    file: test.file,
    duration: test.duration,
    currentRetry: test.currentRetry(),
    speed: test.speed,
    err: cleanCycles(err),
  };
}

/**
 * Replaces any circular references inside `obj` with '[object Object]'
 */
function cleanCycles(obj: Record<string, unknown>): Record<string, unknown> {
  const cache: object[] = [];
  return JSON.parse(
    JSON.stringify(obj, function (_key: string, value: unknown): unknown {
      if (typeof value === "object" && value !== null) {
        if (cache.indexOf(value) !== -1) {
          // Instead of going in a circle, we'll print [object Object]
          return "" + value;
        }
        cache.push(value);
      }

      return value;
    }),
  );
}

/**
 * Transform an Error object into a JSON object.
 */
function errorJSON(err: Error): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  Object.getOwnPropertyNames(err).forEach(function (key: string) {
    res[key] = (err as unknown as Record<string, unknown>)[key];
  }, err);
  return res;
}

exports = module.exports = JSONReporter;
