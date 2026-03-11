/**
 * "Buffered" reporter used internally by a worker process when running in parallel mode.
 * @module nodejs/reporters/parallel-buffered
 * @public
 */

"use strict";

/**
 * Module dependencies.
 */

const {
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_TEST_PENDING,
  EVENT_TEST_BEGIN,
  EVENT_TEST_END,
  EVENT_TEST_RETRY,
  EVENT_DELAY_BEGIN,
  EVENT_DELAY_END,
  EVENT_HOOK_BEGIN,
  EVENT_HOOK_END,
  EVENT_RUN_END,
} = require("../../runner").constants;
const {
  SerializableEvent,
  SerializableWorkerResult,
} = require("../serializer");
const debug = require("debug")("mocha:reporters:buffered");
const Base = require("../../reporters/base");

/** Interface for a runner-like object with event emitter capabilities */
interface RunnerLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: EventListener): void;
}

/** Type for event listener functions */
type EventListener = (...args: unknown[]) => void;

/**
 * List of events to listen to; these will be buffered and sent
 * when `Mocha#run` is complete (via {@link ParallelBuffered#done}).
 */
const EVENT_NAMES: string[] = [
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
  EVENT_TEST_BEGIN,
  EVENT_TEST_PENDING,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_TEST_RETRY,
  EVENT_TEST_END,
  EVENT_HOOK_BEGIN,
  EVENT_HOOK_END,
];

/**
 * Like {@link EVENT_NAMES}, except we expect these events to only be emitted
 * by the `Runner` once.
 */
const ONCE_EVENT_NAMES: string[] = [EVENT_DELAY_BEGIN, EVENT_DELAY_END];

/**
 * The `ParallelBuffered` reporter is used by each worker process in "parallel"
 * mode, by default.  Instead of reporting to `STDOUT`, etc., it retains a
 * list of events it receives and hands these off to the callback passed into
 * {@link Mocha#run}. That callback will then return the data to the main
 * process.
 * @public
 */
class ParallelBuffered extends Base {
  /**
   * Retained list of events emitted from the {@link Runner} instance.
   * @public
   */
  events: InstanceType<typeof SerializableEvent>[];

  /**
   * Map of `Runner` event names to listeners (for later teardown)
   * @public
   */
  listeners: Map<string, EventListener>;

  /**
   * Calls {@link ParallelBuffered#createListeners}
   */
  constructor(runner: RunnerLike, opts?: Record<string, unknown>) {
    super(runner, opts);

    this.events = [];
    this.listeners = new Map();

    this.createListeners(runner);
  }

  /**
   * Returns a new listener which saves event data in memory to
   * {@link ParallelBuffered#events}. Listeners are indexed by `eventName` and stored
   * in {@link ParallelBuffered#listeners}. This is a defensive measure, so that we
   * don't a) leak memory or b) remove _other_ listeners that may not be
   * associated with this reporter.
   *
   * Subclasses could override this behavior.
   * @public
   */
  createListener(eventName: string): EventListener {
    const listener: EventListener = (
      runnable: unknown,
      err: unknown,
    ): void => {
      this.events.push(
        SerializableEvent.create(
          eventName,
          runnable as Record<string, unknown> | undefined,
          err as Error | undefined,
        ),
      );
    };
    return this.listeners.set(eventName, listener).get(eventName)!;
  }

  /**
   * Creates event listeners (using {@link ParallelBuffered#createListener}) for each
   * reporter-relevant event emitted by a {@link Runner}. This array is drained when
   * {@link ParallelBuffered#done} is called by {@link Runner#run}.
   *
   * Subclasses could override this behavior.
   * @public
   */
  createListeners(runner: RunnerLike): this {
    EVENT_NAMES.forEach((evt: string) => {
      runner.on(evt, this.createListener(evt));
    });
    ONCE_EVENT_NAMES.forEach((evt: string) => {
      runner.once(evt, this.createListener(evt));
    });

    runner.once(EVENT_RUN_END, () => {
      debug("received EVENT_RUN_END");
      this.listeners.forEach((listener: EventListener, evt: string) => {
        runner.removeListener(evt, listener);
        this.listeners.delete(evt);
      });
    });

    return this;
  }

  /**
   * Calls the {@link Mocha#run} callback (`callback`) with the test failure
   * count and the array of {@link BufferedEvent} objects. Resets the array.
   *
   * This is called directly by `Runner#run` and should not be called by any other consumer.
   *
   * Subclasses could override this.
   * @public
   */
  done(
    failures: number,
    callback: (result: InstanceType<typeof SerializableWorkerResult>) => void,
  ): void {
    callback(SerializableWorkerResult.create(this.events, failures));
    this.events = []; // defensive
  }
}

module.exports = ParallelBuffered;
