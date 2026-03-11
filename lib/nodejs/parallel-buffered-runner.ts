/**
 * A test Runner that uses a {@link module:buffered-worker-pool}.
 * @module parallel-buffered-runner
 * @private
 */

"use strict";

import type { MochaOptions } from "../types.d.ts";

const Runner = require("../runner");
const { EVENT_RUN_BEGIN, EVENT_RUN_END } = Runner.constants;
const debug = require("debug")("mocha:parallel:parallel-buffered-runner");
const { BufferedWorkerPool } = require("./buffered-worker-pool");
const { setInterval, clearInterval } = global;
const { createMap, constants } = require("../utils");
const { MOCHA_ID_PROP_NAME } = constants;
const { createFatalError } = require("../errors");

const DEFAULT_WORKER_REPORTER: string =
  require.resolve("./reporters/parallel-buffered");

/**
 * List of options to _not_ serialize for transmission to workers
 */
const DENY_OPTIONS: string[] = [
  "globalSetup",
  "globalTeardown",
  "parallel",
  "p",
  "jobs",
  "j",
];

/** Stats from the worker pool */
interface PoolStats {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
}

/** Interface for events coming from worker results */
interface WorkerEvent {
  eventName: string;
  data?: Record<string, unknown> & { _bail?: boolean };
  error?: Error;
}

/** Interface for the options passed to ParallelBufferedRunner#run */
interface ParallelRunOptions {
  files?: string[];
  options?: MochaOptions & { jobs?: number; reporter?: string };
}

/**
 * Outputs a debug statement with worker stats
 */
/* istanbul ignore next */
const debugStats = (pool: InstanceType<typeof BufferedWorkerPool>): void => {
  const { totalWorkers, busyWorkers, idleWorkers, pendingTasks }: PoolStats =
    pool.stats();
  debug(
    "%d/%d busy workers; %d idle; %d tasks queued",
    busyWorkers,
    totalWorkers,
    idleWorkers,
    pendingTasks,
  );
};

/**
 * The interval at which we will display stats for worker processes in debug mode
 */
const DEBUG_STATS_INTERVAL = 5000;

const ABORTED = "ABORTED";
const IDLE = "IDLE";
const ABORTING = "ABORTING";
const RUNNING = "RUNNING";
const BAILING = "BAILING";
const BAILED = "BAILED";
const COMPLETE = "COMPLETE";

const states: Record<string, Set<string>> = createMap({
  [IDLE]: new Set([RUNNING, ABORTING]),
  [RUNNING]: new Set([COMPLETE, BAILING, ABORTING]),
  [COMPLETE]: new Set(),
  [ABORTED]: new Set(),
  [ABORTING]: new Set([ABORTED]),
  [BAILING]: new Set([BAILED, ABORTING]),
  [BAILED]: new Set([COMPLETE, ABORTING]),
});

/**
 * This `Runner` delegates tests runs to worker threads.  Does not execute any
 * {@link Runnable}s by itself!
 * @public
 */
class ParallelBufferedRunner extends Runner {
  _workerReporter: string;
  _linkPartialObjects: boolean;
  _linkedObjectMap: Map<string, Record<string, unknown>>;

  constructor(...args: ConstructorParameters<typeof Runner>) {
    super(...args);

    let state = IDLE;
    Object.defineProperty(this, "_state", {
      get(): string {
        return state;
      },
      set(newState: string) {
        if (states[state].has(newState)) {
          state = newState;
        } else {
          throw new Error(`invalid state transition: ${state} => ${newState}`);
        }
      },
    });

    this._workerReporter = DEFAULT_WORKER_REPORTER;
    this._linkPartialObjects = false;
    this._linkedObjectMap = new Map();

    this.once(Runner.constants.EVENT_RUN_END, () => {
      this._state = COMPLETE;
    });
  }

  /**
   * Returns a mapping function to enqueue a file in the worker pool and return results of its execution.
   * @private
   */
  _createFileRunner(
    pool: InstanceType<typeof BufferedWorkerPool>,
    options: MochaOptions,
  ): (file: string) => Promise<void> {
    /**
     * Emits event and sets `BAILING` state, if necessary.
     */
    const emitEvent = (event: WorkerEvent, failureCount: number): void => {
      this.emit(event.eventName, event.data, event.error);
      if (
        this._state !== BAILING &&
        event.data &&
        event.data._bail &&
        (failureCount || event.error)
      ) {
        debug("run(): nonzero failure count & found bail flag");
        // we need to let the events complete for this file, as the worker
        // should run any cleanup hooks
        this._state = BAILING;
      }
    };

    /**
     * Given an event, recursively find any objects in its data that have ID's, and create object references to already-seen objects.
     */
    const linkEvent = (event: WorkerEvent): void => {
      const stack: { parent: Record<string, unknown>; prop: string }[] = [
        { parent: event as unknown as Record<string, unknown>, prop: "data" },
      ];
      while (stack.length) {
        const { parent, prop } = stack.pop()!;
        const obj = parent[prop] as Record<string, unknown> | undefined;
        let newObj: Record<string, unknown> | undefined;
        if (obj && typeof obj === "object") {
          if (obj[MOCHA_ID_PROP_NAME]) {
            const id = obj[MOCHA_ID_PROP_NAME] as string;
            newObj = this._linkedObjectMap.has(id)
              ? Object.assign(this._linkedObjectMap.get(id)!, obj)
              : obj;
            this._linkedObjectMap.set(id, newObj);
            parent[prop] = newObj;
          } else {
            throw createFatalError(
              "Object missing ID received in event data",
              obj,
            );
          }
        }
        Object.keys(newObj!).forEach((key) => {
          const value = obj![key];
          if (
            value &&
            typeof value === "object" &&
            (value as Record<string, unknown>)[MOCHA_ID_PROP_NAME]
          ) {
            stack.push({
              parent: newObj!,
              prop: key,
            });
          }
        });
      }
    };

    return async (file: string): Promise<void> => {
      debug("run(): enqueueing test file %s", file);
      try {
        const {
          failureCount,
          events,
        }: { failureCount: number; events: WorkerEvent[] } = (await pool.run(
          file,
          options,
        )) as unknown as { failureCount: number; events: WorkerEvent[] };

        if (this._state === BAILED) {
          // short-circuit after a graceful bail. if this happens,
          // some other worker has bailed.
          // TODO: determine if this is the desired behavior, or if we
          // should report the events of this run anyway.
          return;
        }
        debug(
          "run(): completed run of file %s; %d failures / %d events",
          file,
          failureCount,
          events.length,
        );
        this.failures += failureCount; // can this ever be non-numeric?
        let event: WorkerEvent | undefined = events.shift();

        if (this._linkPartialObjects) {
          while (event) {
            linkEvent(event);
            emitEvent(event, failureCount);
            event = events.shift();
          }
        } else {
          while (event) {
            emitEvent(event, failureCount);
            event = events.shift();
          }
        }
        if (this._state === BAILING) {
          debug('run(): terminating pool due to "bail" flag');
          this._state = BAILED;
          await pool.terminate();
        }
      } catch (err) {
        if (this._state === BAILED || this._state === ABORTING) {
          debug(
            "run(): worker pool terminated with intent; skipping file %s",
            file,
          );
        } else {
          // this is an uncaught exception
          debug("run(): encountered uncaught exception: %O", err);
          if (this.allowUncaught) {
            // still have to clean up
            this._state = ABORTING;
            await pool.terminate(true);
          }
          throw err;
        }
      } finally {
        debug("run(): done running file %s", file);
      }
    };
  }

  /**
   * Listen on `Process.SIGINT`; terminate pool if caught.
   * Returns the listener for later call to `process.removeListener()`.
   * @private
   */
  _bindSigIntListener(
    pool: InstanceType<typeof BufferedWorkerPool>,
  ): () => Promise<void> {
    const sigIntListener = async (): Promise<void> => {
      debug("run(): caught a SIGINT");
      this._state = ABORTING;

      try {
        debug("run(): force-terminating worker pool");
        await pool.terminate(true);
      } catch (err) {
        console.error(
          `Error while attempting to force-terminate worker pool: ${err}`,
        );
        process.exitCode = 1;
      } finally {
        process.nextTick(() => {
          debug("run(): imminent death");
          this._state = ABORTED;
          process.kill(process.pid, "SIGINT");
        });
      }
    };

    process.once("SIGINT", sigIntListener);

    return sigIntListener;
  }

  /**
   * Runs Mocha tests by creating a thread pool, then delegating work to the
   * worker threads.
   *
   * Each worker receives one file, and as workers become available, they take a
   * file from the queue and run it. The worker thread execution is treated like
   * an RPC--it returns a `Promise` containing serialized information about the
   * run.  The information is processed as it's received, and emitted to a
   * {@link Reporter}, which is likely listening for these events.
   */
  run(
    callback?: (failures: number) => void,
    { files, options = {} }: ParallelRunOptions = {},
  ): this {
    /**
     * Listener on `Process.SIGINT` which tries to cleanly terminate the worker pool.
     */
    let sigIntListener: (() => Promise<void>) | undefined;

    // assign the reporter the worker will use, which will be different than the
    // main process' reporter
    const workerOptions: MochaOptions & { reporter?: string; jobs?: number } = {
      ...options,
      reporter: this._workerReporter,
    };

    // This function should _not_ return a `Promise`; its parent (`Runner#run`)
    // returns this instance, so this should do the same. However, we want to make
    // use of `async`/`await`, so we use this IIFE.
    (async () => {
      /**
       * This is an interval that outputs stats about the worker pool every so often
       */
      let debugInterval: ReturnType<typeof setInterval> | undefined;

      let pool: InstanceType<typeof BufferedWorkerPool> | undefined;

      try {
        pool = BufferedWorkerPool.create({
          maxWorkers: workerOptions.jobs,
        });

        sigIntListener = this._bindSigIntListener(pool);

        /* istanbul ignore next */
        debugInterval = setInterval(
          () => debugStats(pool!),
          DEBUG_STATS_INTERVAL,
        ).unref();

        // this is set for uncaught exception handling in `Runner#uncaught`
        // TODO: `Runner` should be using a state machine instead.
        this.started = true;
        this._state = RUNNING;

        this.emit(EVENT_RUN_BEGIN);

        const filteredOptions: Record<string, unknown> = { ...workerOptions };
        DENY_OPTIONS.forEach((opt) => {
          delete filteredOptions[opt];
        });

        const results = await Promise.allSettled(
          files!.map(this._createFileRunner(pool, filteredOptions as MochaOptions)),
        );

        // note that pool may already be terminated due to --bail
        await pool.terminate();

        results
          .filter(
            ({ status }: PromiseSettledResult<void>) => status === "rejected",
          )
          .forEach((result: PromiseSettledResult<void>) => {
            const { reason } = result as PromiseRejectedResult;
            if (this.allowUncaught) {
              // yep, just the first one.
              throw reason;
            }
            // "rejected" will correspond to uncaught exceptions.
            // unlike the serial runner, the parallel runner can always recover.
            this.uncaught(reason);
          });

        if (this._state === ABORTING) {
          return;
        }

        this.emit(EVENT_RUN_END);
        debug("run(): completing with failure count %d", this.failures);
        callback!(this.failures);
      } catch (err) {
        // this `nextTick` takes us out of the `Promise` scope, so the
        // exception will not be caught and returned as a rejected `Promise`,
        // which would lead to an `unhandledRejection` event.
        process.nextTick(() => {
          debug("run(): re-throwing uncaught exception");
          throw err;
        });
      } finally {
        clearInterval(debugInterval);
        process.removeListener("SIGINT", sigIntListener!);
      }
    })();
    return this;
  }

  /**
   * Toggle partial object linking behavior; used for building object references from
   * unique ID's.
   * @public
   * @example
   * // this reporter needs proper object references when run in parallel mode
   * class MyReporter() {
   *   constructor(runner) {
   *     runner.linkPartialObjects(true)
   *       .on(EVENT_SUITE_BEGIN, suite => {
   *         // this Suite may be the same object...
   *       })
   *       .on(EVENT_TEST_BEGIN, test => {
   *         // ...as the `test.parent` property
   *       });
   *   }
   * }
   */
  linkPartialObjects(value?: boolean): this {
    this._linkPartialObjects = Boolean(value);
    return super.linkPartialObjects(value);
  }

  /**
   * If this class is the `Runner` in use, then this is going to return `true`.
   *
   * For use by reporters.
   * @public
   */
  isParallelMode(): true {
    return true;
  }

  /**
   * Configures an alternate reporter for worker processes to use. Subclasses
   * using worker processes should implement this.
   * @public
   * @throws When in serial mode
   */
  workerReporter(reporter: string): this {
    this._workerReporter = reporter;
    return this;
  }
}

module.exports = ParallelBufferedRunner;
