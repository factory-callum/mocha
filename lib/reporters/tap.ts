"use strict";

/**
 * @module TAP
 */
/**
 * Module dependencies.
 */

const util = require("node:util");
const Base = require("./base");
const constants = require("../runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const EVENT_TEST_END: string = constants.EVENT_TEST_END;
const sprintf: (...args: unknown[]) => string = util.format;

/** Interface for test-like objects */
interface TestLike {
  title: string;
  fullTitle(): string;
  duration?: number;
}

/** Interface for error-like objects */
interface ErrorLike {
  message?: string;
  stack?: string | null;
}

/** Interface for stats-like objects */
interface StatsLike {
  passes: number;
  failures: number;
  pending: number;
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
interface ReporterOptions {
  reporterOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Interface for TAP producer */
interface TAPProducerInterface {
  writeVersion(): void;
  writePlan(ntests: number): void;
  writePass(n: number, test: TestLike): void;
  writePending(n: number, test: TestLike): void;
  writeFail(n: number, test: TestLike, err?: ErrorLike): void;
  writeEpilogue(stats: StatsLike): void;
}

class TAP extends Base {
  static description: string = "TAP-compatible output";

  _producer: TAPProducerInterface;

  /**
   * Constructs a new `TAP` reporter instance.
   *
   * @public
   * @memberof Mocha.reporters
   * @extends Mocha.reporters.Base
   */
  constructor(runner: RunnerLike, options?: ReporterOptions) {
    super(runner, options);

    const self = this;
    let n: number = 1;

    let tapVersion: string = "12";
    if (options && options.reporterOptions) {
      if (options.reporterOptions.tapVersion) {
        tapVersion = options.reporterOptions.tapVersion.toString();
      }
    }

    this._producer = createProducer(tapVersion);

    runner.once(EVENT_RUN_BEGIN, function () {
      self._producer.writeVersion();
    });

    runner.on(EVENT_TEST_END, function () {
      ++n;
    });

    runner.on(EVENT_TEST_PENDING, function (test: TestLike) {
      self._producer.writePending(n, test);
    });

    runner.on(EVENT_TEST_PASS, function (test: TestLike) {
      self._producer.writePass(n, test);
    });

    runner.on(EVENT_TEST_FAIL, function (test: TestLike, err: ErrorLike) {
      self._producer.writeFail(n, test, err);
    });

    runner.once(EVENT_RUN_END, function () {
      self._producer.writeEpilogue(runner.stats);
    });
  }
}

/**
 * Returns a TAP-safe title of `test`.
 */
function title(test: TestLike): string {
  return test.fullTitle().replace(/#/g, "");
}

/**
 * Writes newline-terminated formatted string to reporter output stream.
 */
function println(...vargs: unknown[]): void {
  const args: unknown[] = Array.from(vargs);
  (args as string[])[0] += "\n";
  process.stdout.write(sprintf(...args));
}

/**
 * Returns a `tapVersion`-appropriate TAP producer instance, if possible.
 */
function createProducer(tapVersion: string): TAPProducerInterface {
  const producers: Record<string, TAPProducerInterface> = {
    12: new TAP12Producer(),
    13: new TAP13Producer(),
  };
  const producer: TAPProducerInterface | undefined = producers[tapVersion];

  if (!producer) {
    throw new Error(
      "invalid or unsupported TAP version: " + JSON.stringify(tapVersion),
    );
  }

  return producer;
}

/**
 * Constructs a new TAPProducer.
 *
 * <em>Only</em> to be used as an abstract base class.
 */
class TAPProducer implements TAPProducerInterface {
  /**
   * Writes the TAP version to reporter output stream.
   */
  writeVersion(): void {}

  /**
   * Writes the plan to reporter output stream.
   */
  writePlan(ntests: number): void {
    println("%d..%d", 1, ntests);
  }

  /**
   * Writes that test passed to reporter output stream.
   */
  writePass(n: number, test: TestLike): void {
    println("ok %d %s", n, title(test));
  }

  /**
   * Writes that test was skipped to reporter output stream.
   */
  writePending(n: number, test: TestLike): void {
    println("ok %d %s # SKIP -", n, title(test));
  }

  /**
   * Writes that test failed to reporter output stream.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  writeFail(n: number, test: TestLike, err?: ErrorLike): void {
    println("not ok %d %s", n, title(test));
  }

  /**
   * Writes the summary epilogue to reporter output stream.
   */
  writeEpilogue(stats: StatsLike): void {
    // :TBD: Why is this not counting pending tests?
    println("# tests " + (stats.passes + stats.failures));
    println("# pass " + stats.passes);
    // :TBD: Why are we not showing pending results?
    println("# fail " + stats.failures);
    this.writePlan(stats.passes + stats.failures + stats.pending);
  }
}

/**
 * Produces output conforming to the TAP12 specification.
 *
 * @see {@link https://testanything.org/tap-specification.html|Specification}
 */
class TAP12Producer extends TAPProducer {
  /**
   * Writes that test failed to reporter output stream, with error formatting.
   * @override
   */
  writeFail(n: number, test: TestLike, err?: ErrorLike): void {
    super.writeFail(n, test, err);
    if (err && err.message) {
      println(err.message.replace(/^/gm, "  "));
    }
    if (err && err.stack) {
      println(err.stack.replace(/^/gm, "  "));
    }
  }
}

/**
 * Produces output conforming to the TAP13 specification.
 *
 * @see {@link https://testanything.org/tap-version-13-specification.html|Specification}
 */
class TAP13Producer extends TAPProducer {
  /**
   * Writes the TAP version to reporter output stream.
   * @override
   */
  writeVersion(): void {
    println("TAP version 13");
  }

  /**
   * Writes that test failed to reporter output stream, with error formatting.
   * @override
   */
  writeFail(n: number, test: TestLike, err?: ErrorLike): void {
    super.writeFail(n, test, err);
    const emitYamlBlock: boolean =
      err != null && (err.message != null || err.stack != null);
    if (emitYamlBlock) {
      println(indent(1) + "---");
      if (err!.message) {
        println(indent(2) + "message: |-");
        println(err!.message.replace(/^/gm, indent(3)));
      }
      if (err!.stack) {
        println(indent(2) + "stack: |-");
        println(err!.stack.replace(/^/gm, indent(3)));
      }
      println(indent(1) + "...");
    }
  }
}

function indent(level: number): string {
  return Array(level + 1).join("  ");
}

exports = module.exports = TAP;
