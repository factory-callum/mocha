"use strict";

import type { StatsCollector } from "./types.d.ts";

/**
 * Provides a factory function for a {@link StatsCollector} object.
 * @module
 */

const constants = require("./runner").constants;
const EVENT_TEST_PASS: string = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL: string = constants.EVENT_TEST_FAIL;
const EVENT_SUITE_BEGIN: string = constants.EVENT_SUITE_BEGIN;
const EVENT_RUN_BEGIN: string = constants.EVENT_RUN_BEGIN;
const EVENT_TEST_PENDING: string = constants.EVENT_TEST_PENDING;
const EVENT_RUN_END: string = constants.EVENT_RUN_END;
const EVENT_TEST_END: string = constants.EVENT_TEST_END;

const Date = global.Date;

/** Runner interface for stats collection */
interface RunnerLike {
  stats: StatsCollector;
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** Suite-like interface for suite begin event */
interface SuiteLike {
  root: boolean;
}

/**
 * Provides stats such as test duration, number of tests passed / failed etc., by listening for events emitted by `runner`.
 *
 * @private
 * @param runner - Runner instance
 * @throws {TypeError} If falsy `runner`
 */
function createStatsCollector(runner: RunnerLike): void {
  const stats: StatsCollector = {
    suites: 0,
    tests: 0,
    passes: 0,
    pending: 0,
    failures: 0,
  } as StatsCollector;

  if (!runner) {
    throw new TypeError("Missing runner argument");
  }

  runner.stats = stats;

  runner.once(EVENT_RUN_BEGIN, function () {
    stats.start = new Date();
  });
  runner.on(EVENT_SUITE_BEGIN, function (suite: unknown) {
    if (!(suite as SuiteLike).root) {
      stats.suites++;
    }
  });
  runner.on(EVENT_TEST_PASS, function () {
    stats.passes++;
  });
  runner.on(EVENT_TEST_FAIL, function () {
    stats.failures++;
  });
  runner.on(EVENT_TEST_PENDING, function () {
    stats.pending++;
  });
  runner.on(EVENT_TEST_END, function () {
    stats.tests++;
  });
  runner.once(EVENT_RUN_END, function () {
    stats.end = new Date();
    stats.duration = (stats.end as unknown as number) - (stats.start as unknown as number);
  });
}

module.exports = createStatsCollector;
