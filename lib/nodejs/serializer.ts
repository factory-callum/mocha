/**
 * Serialization/deserialization classes and functions for communication between a main Mocha process and worker processes.
 * @module serializer
 * @private
 */

"use strict";

import type {
  SerializedEvent,
  SerializedWorkerResult,
} from "../types.d.ts";

const { type, breakCircularDeps } = require("../utils");
const { createInvalidArgumentTypeError } = require("../errors");
// this is not named `mocha:parallel:serializer` because it's noisy and it's
// helpful to be able to write `DEBUG=mocha:parallel*` and get everything else.
const debug = require("debug")("mocha:serializer");

const SERIALIZABLE_RESULT_NAME = "SerializableWorkerResult";
const SERIALIZABLE_TYPES = new Set(["object", "array", "function", "error"]);

/** Type for key-value pair entries used during serialization traversal */
type SerializePair = [parent: Record<string, unknown>, key: string | number];

/** Interface for an Error-like serialized object */
interface SerializedError extends Record<string, unknown> {
  message: string;
  stack?: string;
  __type?: string;
}

/** Interface for objects that have a serialize method */
interface Serializable {
  serialize(): unknown;
}

/**
 * The serializable result of a test file run from a worker.
 * @private
 */
class SerializableWorkerResult {
  /**
   * The number of failures in this run
   */
  failureCount: number;

  /**
   * All relevant events emitted from the {@link Runner}.
   */
  events: SerializableEvent[];

  /**
   * Creates instance props; of note, the `__type` prop.
   *
   * Note that the failure count is _redundant_ and could be derived from the
   * list of events; but since we're already doing the work, might as well use
   * it.
   */
  constructor(events: SerializableEvent[] = [], failureCount: number = 0) {
    this.failureCount = failureCount;
    this.events = events;

    /**
     * Symbol-like value needed to distinguish when attempting to deserialize
     * this object (once it's been received over IPC).
     */
    Object.defineProperty(this, "__type", {
      value: SERIALIZABLE_RESULT_NAME,
      enumerable: true,
      writable: false,
    });
  }

  /**
   * Instantiates a new {@link SerializableWorkerResult}.
   */
  static create(
    ...args: ConstructorParameters<typeof SerializableWorkerResult>
  ): SerializableWorkerResult {
    return new SerializableWorkerResult(...args);
  }

  /**
   * Serializes each {@link SerializableEvent} in our `events` prop;
   * makes this object read-only.
   */
  serialize(): Readonly<SerializableWorkerResult> {
    this.events.forEach((event) => {
      event.serialize();
    });
    return Object.freeze(this);
  }

  /**
   * Deserializes a {@link SerializedWorkerResult} into something reporters can
   * use; calls {@link SerializableEvent.deserialize} on each item in its
   * `events` prop.
   */
  static deserialize(obj: SerializedWorkerResult): SerializedWorkerResult {
    obj.events.forEach((event: SerializedEvent) => {
      SerializableEvent.deserialize(event);
    });
    return obj;
  }

  /**
   * Returns `true` if this is a {@link SerializedWorkerResult} or a
   * {@link SerializableWorkerResult}.
   */
  static isSerializedWorkerResult(value: unknown): boolean {
    return (
      value instanceof SerializableWorkerResult ||
      (type(value) === "object" &&
        (value as Record<string, unknown>).__type === SERIALIZABLE_RESULT_NAME)
    );
  }
}

/**
 * Represents an event, emitted by a {@link Runner}, which is to be transmitted
 * over IPC.
 *
 * Due to the contents of the event data, it's not possible to send them
 * verbatim. When received by the main process--and handled by reporters--these
 * objects are expected to contain {@link Runnable} instances.  This class
 * provides facilities to perform the translation via serialization and
 * deserialization.
 * @private
 */
class SerializableEvent {
  /**
   * The event name.
   */
  eventName: string;

  /**
   * Serialized data (populated after serialize() is called).
   */
  data?: unknown;

  /**
   * Serialized error (populated after serialize() is called).
   */
  error?: Error;

  /**
   * The raw value (non-enumerable, set via Object.defineProperty).
   */
  declare originalValue: Record<string, unknown> | undefined;

  /**
   * An error, if present (non-enumerable, set via Object.defineProperty).
   */
  declare originalError: Error | undefined;

  /**
   * Constructs a `SerializableEvent`, throwing if we receive unexpected data.
   *
   * Practically, events emitted from `Runner` have a minimum of zero (0)
   * arguments-- (for example, {@link Runnable.constants.EVENT_RUN_BEGIN}) and a
   * maximum of two (2) (for example,
   * {@link Runnable.constants.EVENT_TEST_FAIL}, where the second argument is an
   * `Error`).  The first argument, if present, is a {@link Runnable}. This
   * constructor's arguments adhere to this convention.
   * @throws If `eventName` is empty, or `originalValue` is a non-object.
   */
  constructor(
    eventName: string,
    originalValue?: Record<string, unknown>,
    originalError?: Error,
  ) {
    if (!eventName) {
      throw createInvalidArgumentTypeError(
        "Empty `eventName` string argument",
        "eventName",
        "string",
      );
    }
    this.eventName = eventName;
    const originalValueType = type(originalValue);
    if (originalValueType !== "object" && originalValueType !== "undefined") {
      throw createInvalidArgumentTypeError(
        `Expected object but received ${originalValueType}`,
        "originalValue",
        "object",
      );
    }
    /**
     * An error, if present.
     */
    Object.defineProperty(this, "originalError", {
      value: originalError,
      enumerable: false,
    });

    /**
     * The raw value.
     *
     * We don't want this value sent via IPC; making it non-enumerable will do that.
     */
    Object.defineProperty(this, "originalValue", {
      value: originalValue,
      enumerable: false,
    });
  }

  /**
   * In case you hated using `new` (I do).
   */
  static create(
    ...args: ConstructorParameters<typeof SerializableEvent>
  ): SerializableEvent {
    return new SerializableEvent(...args);
  }

  /**
   * Used internally by {@link SerializableEvent#serialize}.
   * @ignore
   */
  static _serialize(
    pairs: SerializePair[],
    parent: Record<string, unknown>,
    key: string | number,
  ): void {
    let value = parent[key] as Record<string, unknown>;
    let _type = type(value);
    if (_type === "error") {
      // we need to reference the stack prop b/c it's lazily-loaded.
      // `__type` is necessary for deserialization to create an `Error` later.
      // `message` is apparently not enumerable, so we must handle it specifically.
      value = Object.assign(Object.create(null) as Record<string, unknown>, value, {
        stack: (value as unknown as Error).stack,
        message: (value as unknown as Error).message,
        __type: "Error",
      });
      parent[key] = value;
      // after this, set the result of type(value) to be `object`, and we'll throw
      // whatever other junk is in the original error into the new `value`.
      _type = "object";
    }
    switch (_type) {
      case "object":
        if (type((value as unknown as Serializable).serialize) === "function") {
          parent[key] = (value as unknown as Serializable).serialize();
        } else {
          // by adding props to the `pairs` array, we will process it further
          pairs.push(
            ...Object.keys(value)
              .filter((key) => SERIALIZABLE_TYPES.has(type(value[key])))
              .map((key): SerializePair => [value, key]),
          );
        }
        break;
      case "function":
        // we _may_ want to dig in to functions for some assertion libraries
        // that might put a usable property on a function.
        // for now, just zap it.
        delete parent[key];
        break;
      case "array":
        pairs.push(
          ...(value as unknown as unknown[])
            .filter((value) => SERIALIZABLE_TYPES.has(type(value)))
            .map((_value, index): SerializePair => [value, index]),
        );
        break;
    }
  }

  /**
   * Modifies this object *in place* (for theoretical memory consumption &
   * performance reasons); serializes `SerializableEvent#originalValue` (placing
   * the result in `SerializableEvent#data`) and `SerializableEvent#error`.
   * Freezes this object. The result is an object that can be transmitted over
   * IPC.
   * If this quickly becomes unmaintainable, we will want to move towards immutable
   * objects post-haste.
   */
  serialize(): Readonly<SerializableEvent> {
    // given a parent object and a key, inspect the value and decide whether
    // to replace it, remove it, or add it to our `pairs` array to further process.
    // this is recursion in loop form.
    const originalValue = this.originalValue;
    const result = Object.assign(Object.create(null) as Record<string, unknown>, {
      data:
        type(originalValue) === "object" &&
        type((originalValue as unknown as Serializable)?.serialize) === "function"
          ? (originalValue as unknown as Serializable).serialize()
          : originalValue,
      error: this.originalError,
    });

    // mutates the object
    breakCircularDeps(result.error);

    const pairs: SerializePair[] = Object.keys(result).map(
      (key): SerializePair => [result, key],
    );
    const seenPairs = new Set<string | number>();
    let pair: SerializePair | undefined;

    while ((pair = pairs.shift())) {
      if (seenPairs.has(pair[1])) {
        continue;
      }

      seenPairs.add(pair[1]);
      SerializableEvent._serialize(pairs, pair[0], pair[1]);
    }

    this.data = result.data;
    this.error = result.error as Error | undefined;

    return Object.freeze(this);
  }

  /**
   * Used internally by {@link SerializableEvent.deserialize}; creates an `Error`
   * from an `Error`-like (serialized) object
   * @ignore
   */
  static _deserializeError(value: SerializedError): Error {
    const error = new Error(value.message);
    error.stack = value.stack;
    Object.assign(error, value);
    delete (error as unknown as Record<string, unknown>).__type;
    return error;
  }

  /**
   * Used internally by {@link SerializableEvent.deserialize}; recursively
   * deserializes an object in-place.
   */
  static _deserializeObject(
    parent: Record<string | number, unknown>,
    key: string | number,
  ): void {
    if (key === "__proto__") {
      delete parent[key];
      return;
    }
    const value = parent[key] as Record<string, unknown> | unknown[];
    // keys beginning with `$$` are converted into functions returning the value
    // and renamed, stripping the `$$` prefix.
    // functions defined this way cannot be array members!
    if (type(key) === "string" && (key as string).startsWith("$$")) {
      const newKey = (key as string).slice(2);
      (parent as Record<string, unknown>)[newKey] = () => value;
      delete parent[key];
      key = newKey;
    }
    if (type(value) === "array") {
      (value as unknown[]).forEach((_: unknown, idx: number) => {
        SerializableEvent._deserializeObject(
          value as unknown as Record<string | number, unknown>,
          idx,
        );
      });
    } else if (type(value) === "object") {
      if ((value as Record<string, unknown>).__type === "Error") {
        parent[key] = SerializableEvent._deserializeError(
          value as unknown as SerializedError,
        );
      } else {
        Object.keys(value as Record<string, unknown>).forEach((key) => {
          SerializableEvent._deserializeObject(
            value as Record<string, unknown>,
            key,
          );
        });
      }
    }
  }

  /**
   * Deserialize value returned from a worker into something more useful.
   * Does not return the same object.
   * @todo do this in a loop instead of with recursion (if necessary)
   */
  static deserialize(obj: SerializedEvent): SerializedEvent {
    if (!obj) {
      throw createInvalidArgumentTypeError("Expected value", obj);
    }

    obj = Object.assign(Object.create(null) as SerializedEvent, obj);

    if (obj.data) {
      Object.keys(obj.data).forEach((key) => {
        SerializableEvent._deserializeObject(
          obj.data as Record<string, unknown>,
          key,
        );
      });
    }

    if (obj.error) {
      obj.error = SerializableEvent._deserializeError(
        obj.error as unknown as SerializedError,
      );
    }

    return obj;
  }
}

/**
 * "Serializes" a value for transmission over IPC as a message.
 *
 * If value is an object and has a `serialize()` method, call that method; otherwise return the object and hope for the best.
 */
exports.serialize = function serialize(value: unknown): unknown {
  const result =
    type(value) === "object" &&
    type((value as Serializable).serialize) === "function"
      ? (value as Serializable).serialize()
      : value;
  debug("serialized: %O", result);
  return result;
};

/**
 * "Deserializes" a "message" received over IPC.
 *
 * This could be expanded with other objects that need deserialization,
 * but at present time we only care about {@link SerializableWorkerResult} objects.
 */
exports.deserialize = function deserialize(value: unknown): unknown {
  const result = SerializableWorkerResult.isSerializedWorkerResult(value)
    ? SerializableWorkerResult.deserialize(value as SerializedWorkerResult)
    : value;
  debug("deserialized: %O", result);
  return result;
};

exports.SerializableEvent = SerializableEvent;
exports.SerializableWorkerResult = SerializableWorkerResult;
