/**
 * A wrapper around a third-party child process worker pool implementation.
 * Used by {@link module:buffered-runner}.
 * @private
 * @module buffered-worker-pool
 */

"use strict";

import type { MochaOptions, SerializedWorkerResult } from "../types.d.ts";
import type { WorkerPoolOptions } from "workerpool";

const serializeJavascript = require("serialize-javascript");
const workerpool = require("workerpool");
const { deserialize } = require("./serializer");
const debug = require("debug")("mocha:parallel:buffered-worker-pool");
const { createInvalidArgumentTypeError } = require("../errors");

const WORKER_PATH = require.resolve("./worker.js");

/** Stats returned by the worker pool */
interface PoolStats {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  activeTasks: number;
}

/** Interface representing the workerpool Pool instance */
interface WorkerPool {
  terminate(force?: boolean): Promise<void>;
  exec(method: string, params: unknown[]): Promise<unknown>;
  stats(): PoolStats;
}

/**
 * A mapping of Mocha `Options` objects to serialized values.
 *
 * This is helpful because we tend to same the same options over and over
 * over IPC.
 */
let optionsCache: WeakMap<MochaOptions, string> = new WeakMap();

/**
 * These options are passed into the [workerpool](https://npm.im/workerpool) module.
 */
const WORKER_POOL_DEFAULT_OPTS: Partial<WorkerPoolOptions> = {
  // use child processes, not worker threads!
  workerType: "process",
  // ensure the same flags sent to `node` for this `mocha` invocation are passed
  // along to children
  forkOpts: { execArgv: process.execArgv },
  maxWorkers: workerpool.cpus - 1,
};

/**
 * A wrapper around a third-party worker pool implementation.
 * @private
 */
class BufferedWorkerPool {
  options: Partial<WorkerPoolOptions>;
  _pool: WorkerPool;

  /**
   * Creates an underlying worker pool instance; determines max worker count
   */
  constructor(opts: Partial<WorkerPoolOptions> = {}) {
    const maxWorkers = Math.max(
      1,
      typeof opts.maxWorkers === "undefined"
        ? (WORKER_POOL_DEFAULT_OPTS.maxWorkers as number)
        : (opts.maxWorkers as number),
    );

    /* istanbul ignore next */
    if (workerpool.cpus < 2) {
      // TODO: decide whether we should warn
      debug(
        "not enough CPU cores available to run multiple jobs; avoid --parallel on this machine",
      );
    } else if (maxWorkers >= workerpool.cpus) {
      // TODO: decide whether we should warn
      debug(
        "%d concurrent job(s) requested, but only %d core(s) available",
        maxWorkers,
        workerpool.cpus,
      );
    }
    /* istanbul ignore next */
    debug(
      "run(): starting worker pool of max size %d, using node args: %s",
      maxWorkers,
      process.execArgv.join(" "),
    );

    let counter = 0;
    const onCreateWorker = ({
      forkOpts,
    }: {
      forkOpts?: import("child_process").ForkOptions;
    }): {
      forkOpts: import("child_process").ForkOptions;
    } => {
      return {
        forkOpts: {
          ...forkOpts,
          // adds an incremental id to all workers, which can be useful to allocate resources for each process
          env: { ...process.env, MOCHA_WORKER_ID: String(counter++) },
        },
      };
    };

    this.options = {
      ...WORKER_POOL_DEFAULT_OPTS,
      ...opts,
      maxWorkers,
      onCreateWorker,
    };
    this._pool = workerpool.pool(WORKER_PATH, this.options) as WorkerPool;
  }

  /**
   * Terminates all workers in the pool.
   * @private
   */
  async terminate(force: boolean = false): Promise<void> {
    /* istanbul ignore next */
    debug("terminate(): terminating with force = %s", force);
    return this._pool.terminate(force);
  }

  /**
   * Adds a test file run to the worker pool queue for execution by a worker process.
   *
   * Handles serialization/deserialization.
   * @private
   */
  async run(
    filepath: string,
    options: MochaOptions = {},
  ): Promise<SerializedWorkerResult> {
    if (!filepath || typeof filepath !== "string") {
      throw createInvalidArgumentTypeError(
        "Expected a non-empty filepath",
        "filepath",
        "string",
      );
    }
    const serializedOptions = BufferedWorkerPool.serializeOptions(options);
    const result = await this._pool.exec("run", [filepath, serializedOptions]);
    return deserialize(result) as SerializedWorkerResult;
  }

  /**
   * Returns stats about the state of the worker processes in the pool.
   *
   * Used for debugging.
   * @private
   */
  stats(): PoolStats {
    return this._pool.stats();
  }

  /**
   * Instantiates a {@link WorkerPool}.
   * @private
   */
  static create(
    ...args: ConstructorParameters<typeof BufferedWorkerPool>
  ): BufferedWorkerPool {
    return new BufferedWorkerPool(...args);
  }

  /**
   * Given Mocha options object `opts`, serialize into a format suitable for
   * transmission over IPC.
   * @private
   */
  static serializeOptions(opts: MochaOptions = {}): string {
    if (!optionsCache.has(opts)) {
      const serialized: string = serializeJavascript(opts, {
        unsafe: true, // this means we don't care about XSS
        ignoreFunction: true, // do not serialize functions
      });
      optionsCache.set(opts, serialized);
      /* istanbul ignore next */
      debug(
        "serializeOptions(): serialized options %O to: %s",
        opts,
        serialized,
      );
    }
    return optionsCache.get(opts) as string;
  }

  /**
   * Resets internal cache of serialized options objects.
   *
   * For testing/debugging
   * @private
   */
  static resetOptionsCache(): void {
    optionsCache = new WeakMap();
  }
}

exports.BufferedWorkerPool = BufferedWorkerPool;
