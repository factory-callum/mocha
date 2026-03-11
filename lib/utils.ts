"use strict";

/**
 * Various utility functions used throughout Mocha's codebase.
 * @module utils
 */

/**
 * Module dependencies.
 */
const path = require("node:path");
const he = require("he");
const pc = require("picocolors");
const isUnicodeSupported: boolean = require("is-unicode-supported")();

const MOCHA_ID_PROP_NAME = "__mocha_id__";

/**
 * Escape special characters in the given string of html.
 *
 * @private
 */
exports.escape = function (html: string): string {
  return he.encode(String(html), { useNamedReferences: false });
};

/**
 * Test if the given obj is type of string.
 *
 * @private
 */
exports.isString = function (obj: unknown): obj is string {
  return typeof obj === "string";
};

/**
 * Compute a slug from the given `str`.
 *
 * @private
 */
exports.slug = function (str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^-\w]/g, "")
    .replace(/-{2,}/g, "-");
};

/**
 * Strip the function definition from `str`, and re-indent for pre whitespace.
 */
exports.clean = function (str: string): string {
  str = str
    .replace(/\r\n?|[\n\u2028\u2029]/g, "\n")
    .replace(/^\uFEFF/, "")
    // (traditional)->  space/name     parameters    body     (lambda)-> parameters       body   multi-statement/single          keep body content
    .replace(
      /^function(?:\s*|\s[^(]*)\([^)]*\)\s*\{((?:.|\n)*?)\}$|^\([^)]*\)\s*=>\s*(?:\{((?:.|\n)*?)\}|((?:.|\n)*))$/,
      "$1$2$3",
    );

  const spaces = str.match(/^\n?( *)/)![1].length;
  const tabs = str.match(/^\n?(\t*)/)![1].length;
  const re = new RegExp(
    "^\n?" + (tabs ? "\t" : " ") + "{" + (tabs || spaces) + "}",
    "gm",
  );

  str = str.replace(re, "");

  return str.trim();
};

/**
 * If a value could have properties, and has none, this function is called,
 * which returns a string representation of the empty value.
 *
 * Functions w/ no properties return `'[Function]'`
 * Arrays w/ length === 0 return `'[]'`
 * Objects w/ no properties return `'{}'`
 * All else: return result of `value.toString()`
 *
 * @private
 */
function emptyRepresentation(
  value: unknown,
  typeHint: string,
): string {
  switch (typeHint) {
    case "function":
      return "[Function]";
    case "null-prototype":
    case "object":
      return "{}";
    case "array":
      return "[]";
    default:
      return String(value);
  }
}

/**
 * Takes some variable and asks `Object.prototype.toString()` what it thinks it
 * is.
 *
 * @private
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/toString
 * @example
 * canonicalType({}) // 'object'
 * canonicalType([]) // 'array'
 * canonicalType(1) // 'number'
 * canonicalType(false) // 'boolean'
 * canonicalType(Infinity) // 'number'
 * canonicalType(null) // 'null'
 * canonicalType(new Date()) // 'date'
 * canonicalType(/foo/) // 'regexp'
 * canonicalType('type') // 'string'
 * canonicalType(global) // 'global'
 * canonicalType(new String('foo')) // 'object'
 * canonicalType(async function() {}) // 'asyncfunction'
 * canonicalType(Object.create(null)) // 'null-prototype'
 */
const canonicalType = (exports.canonicalType = function canonicalType(
  value: unknown,
): string {
  if (value === undefined) {
    return "undefined";
  } else if (value === null) {
    return "null";
  } else if (Buffer.isBuffer(value)) {
    return "buffer";
  } else if (Object.getPrototypeOf(value as object) === null) {
    return "null-prototype";
  }

  return Object.prototype.toString
    .call(value)
    .replace(/^\[.+\s(.+?)]$/, "$1")
    .toLowerCase();
});

/**
 * Returns a general type or data structure of a variable
 * @private
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures
 * @example
 * type({}) // 'object'
 * type([]) // 'array'
 * type(1) // 'number'
 * type(false) // 'boolean'
 * type(Infinity) // 'number'
 * type(null) // 'null'
 * type(new Date()) // 'object'
 * type(/foo/) // 'object'
 * type('type') // 'string'
 * type(global) // 'object'
 * type(new String('foo')) // 'string'
 */
exports.type = function type(value: unknown): string {
  // Null is special
  if (value === null) return "null";
  const primitives = new Set([
    "undefined",
    "boolean",
    "number",
    "string",
    "bigint",
    "symbol",
  ]);
  const _type = typeof value;
  if (_type === "function") return _type;
  if (primitives.has(_type)) return _type;
  if (value instanceof String) return "string";
  if (value instanceof Error) return "error";
  if (Array.isArray(value)) return "array";

  return _type;
};

/**
 * Stringify `value`. Different behavior depending on type of value:
 *
 * - If `value` is undefined or null, return `'[undefined]'` or `'[null]'`, respectively.
 * - If `value` is not an object, function or array, return result of `value.toString()` wrapped in double-quotes.
 * - If `value` is an *empty* object, function, or array, return result of function
 *   {@link emptyRepresentation}.
 * - If `value` has properties, call {@link exports.canonicalize} on it, then return result of
 *   JSON.stringify().
 *
 * @private
 * @see exports.type
 */
exports.stringify = function (value: unknown): string {
  let typeHint = canonicalType(value);

  if (!~["object", "array", "function", "null-prototype"].indexOf(typeHint)) {
    if (typeHint === "buffer") {
      const json = Buffer.prototype.toJSON.call(value);
      // Based on the toJSON result
      return jsonStringify(
        json.data && json.type ? json.data : json,
        2,
      ).replace(/,(\n|$)/g, "$1");
    }

    // IE7/IE8 has a bizarre String constructor; needs to be coerced
    // into an array and back to obj.
    if (typeHint === "string" && typeof value === "object") {
      value = String(value)
        .split("")
        .reduce(function (acc: Record<string, string>, char: string, idx: number) {
          acc[idx] = char;
          return acc;
        }, {});
      typeHint = "object";
    } else {
      return jsonStringify(value);
    }
  }

  for (const prop in value as object) {
    if (Object.prototype.hasOwnProperty.call(value, prop)) {
      return jsonStringify(
        exports.canonicalize(value, null, typeHint),
        2,
      ).replace(/,(\n|$)/g, "$1");
    }
  }

  return emptyRepresentation(value, typeHint);
};

/**
 * like JSON.stringify but more sense.
 *
 * @private
 */
function jsonStringify(
  object: unknown,
  spaces?: number,
  depth?: number,
): string {
  if (typeof spaces === "undefined") {
    // primitive types
    return _stringify(object);
  }

  depth = depth || 1;
  const space = spaces * depth;
  const objectRecord = object as Record<string, unknown>;
  let str = Array.isArray(object) ? "[" : "{";
  const end = Array.isArray(object) ? "]" : "}";
  let length =
    typeof (objectRecord).length === "number"
      ? (objectRecord).length as number
      : Object.keys(objectRecord).length;
  // `.repeat()` polyfill
  function repeat(s: string, n: number): string {
    return new Array(n).join(s);
  }

  function _stringify(val: unknown): string {
    switch (canonicalType(val)) {
      case "null":
      case "undefined":
        val = "[" + val + "]";
        break;
      case "array":
      case "object":
        val = jsonStringify(val, spaces, depth! + 1);
        break;
      case "boolean":
      case "regexp":
      case "symbol":
      case "number":
        val =
          val === 0 && 1 / (val as number) === -Infinity // `-0`
            ? "-0"
            : String(val);
        break;
      case "bigint":
        val = String(val) + "n";
        break;
      case "date": {
        const d = val as Date;
        const sDate = isNaN(d.getTime()) ? d.toString() : d.toISOString();
        val = "[Date: " + sDate + "]";
        break;
      }
      case "buffer": {
        const json = (val as Buffer).toJSON();
        // Based on the toJSON result
        const data =
          (json as { data?: unknown; type?: unknown }).data &&
          (json as { data?: unknown; type?: unknown }).type
            ? (json as { data: unknown }).data
            : json;
        val = "[Buffer: " + jsonStringify(data, 2, depth! + 1) + "]";
        break;
      }
      default:
        val =
          val === "[Function]" || val === "[Circular]"
            ? val
            : JSON.stringify(val); // string
    }
    return val as string;
  }

  for (const i in objectRecord) {
    if (!Object.prototype.hasOwnProperty.call(objectRecord, i)) {
      continue; // not my business
    }
    --length;
    str +=
      "\n " +
      repeat(" ", space) +
      (Array.isArray(object) ? "" : '"' + i + '": ') + // key
      _stringify(objectRecord[i]) + // value
      (length ? "," : ""); // comma
  }

  return (
    str +
    // [], {}
    (str.length !== 1 ? "\n" + repeat(" ", space - 1) + end : end)
  );
}

/**
 * Return a new Thing that has the keys in sorted order. Recursive.
 *
 * If the Thing...
 * - has already been seen, return string `'[Circular]'`
 * - is `undefined`, return string `'[undefined]'`
 * - is `null`, return value `null`
 * - is some other primitive, return the value
 * - is not a primitive or an `Array`, `Object`, or `Function`, return the value of the Thing's `toString()` method
 * - is a non-empty `Array`, `Object`, or `Function`, return the result of calling this function again.
 * - is an empty `Array`, `Object`, or `Function`, return the result of calling `emptyRepresentation()`
 *
 * @private
 * @see {@link exports.stringify}
 */
exports.canonicalize = function canonicalize(
  value: unknown,
  stack?: unknown[],
  typeHint?: string,
): unknown {
  let canonicalizedObj: unknown;

  typeHint = typeHint || canonicalType(value);
  function withStack(value: unknown, fn: () => void): void {
    stack!.push(value);
    fn();
    stack!.pop();
  }

  stack = stack || [];

  if (stack.indexOf(value) !== -1) {
    return "[Circular]";
  }

  switch (typeHint) {
    case "undefined":
    case "buffer":
    case "null":
      canonicalizedObj = value;
      break;
    case "array":
      withStack(value, function () {
        canonicalizedObj = (value as unknown[]).map(function (item: unknown) {
          return exports.canonicalize(item, stack);
        });
      });
      break;
    case "function":
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const _prop in value as object) {
        canonicalizedObj = {};
        break;
      }

      if (!canonicalizedObj) {
        canonicalizedObj = emptyRepresentation(value, typeHint);
        break;
      }
    /* falls through */
    case "null-prototype":
    case "object":
      canonicalizedObj = canonicalizedObj || {};
      if (
        typeHint === "null-prototype" &&
        Symbol.toStringTag in (value as object)
      ) {
        (canonicalizedObj as Record<string, unknown>)["[Symbol.toStringTag]"] =
          (value as Record<symbol, unknown>)[Symbol.toStringTag];
      }
      withStack(value, function () {
        Object.keys(value as object)
          .sort()
          .forEach(function (key: string) {
            (canonicalizedObj as Record<string, unknown>)[key] =
              exports.canonicalize(
                (value as Record<string, unknown>)[key],
                stack,
              );
          });
      });
      break;
    case "date":
    case "number":
    case "regexp":
    case "boolean":
    case "symbol":
      canonicalizedObj = value;
      break;
    default:
      canonicalizedObj = value + "";
  }

  return canonicalizedObj;
};

/**
 * @summary
 * This Filter based on `mocha-clean` module.(see: `github.com/rstacruz/mocha-clean`)
 * @description
 * When invoking this function you get a filter function that get the Error.stack as an input,
 * and return a prettify output.
 * (i.e: strip Mocha and internal node functions from stack trace).
 */
exports.stackTraceFilter = function (): (stack: string) => string {
  // TODO: Replace with `process.browser`
  const is =
    typeof document === "undefined"
      ? { node: true, browser: undefined }
      : { node: undefined, browser: true };
  let slash: string = path.sep;
  let cwd: string;
  if (is.node) {
    cwd = exports.cwd() + slash;
  } else {
    cwd = (
      typeof location === "undefined" ? window.location : location
    ).href.replace(/\/[^/]*$/, "/");
    slash = "/";
  }

  function isMochaInternal(line: string): number | boolean {
    return (
      ~line.indexOf("node_modules" + slash + "mocha" + slash) ||
      ~line.indexOf(slash + "mocha.js") ||
      ~line.indexOf(slash + "mocha.min.js")
    );
  }

  function isNodeInternal(line: string): number | boolean {
    return (
      ~line.indexOf("(timers.js:") ||
      ~line.indexOf("(events.js:") ||
      ~line.indexOf("(node.js:") ||
      ~line.indexOf("(module.js:") ||
      ~line.indexOf("GeneratorFunctionPrototype.next (native)") ||
      false
    );
  }

  return function (stack: string): string {
    let lines: string[] | string = stack.split("\n");

    lines = lines.reduce(function (list: string[], line: string) {
      if (isMochaInternal(line)) {
        return list;
      }

      if (is.node && isNodeInternal(line)) {
        return list;
      }

      // Clean up cwd(absolute)
      if (/:\d+:\d+\)?$/.test(line)) {
        line = line.replace("(" + cwd, "(");
      }

      list.push(line);
      return list;
    }, []);

    return lines.join("\n");
  };
};

/**
 * Crude, but effective.
 * @public
 */
exports.isPromise = function isPromise(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).then === "function"
  );
};

/**
 * Clamps a numeric value to an inclusive range.
 */
exports.clamp = function clamp(value: number, range: [number, number]): number {
  return Math.min(Math.max(value, range[0]), range[1]);
};

/**
 * It's a noop.
 * @public
 */
exports.noop = function (): void {};

/**
 * Creates a map-like object.
 *
 * @description
 * A "map" is an object with no prototype, for our purposes. In some cases
 * this would be more appropriate than a `Map`, especially if your environment
 * doesn't support it. Recommended for use in Mocha's public APIs.
 *
 * @public
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map#Custom_and_Null_objects|MDN:Map}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/create#Custom_and_Null_objects|MDN:Object.create - Custom objects}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#Custom_and_Null_objects|MDN:Object.assign}
 */
exports.createMap = function (
  ...args: Record<string, unknown>[]
): Record<string, unknown> {
  return Object.assign.apply(
    null,
    [Object.create(null) as Record<string, unknown>].concat(args) as [
      object,
      ...Record<string, unknown>[],
    ],
  );
};

/**
 * Creates a read-only map-like object.
 *
 * @description
 * This differs from {@link module:utils.createMap createMap} only in that
 * the argument must be non-empty, because the result is frozen.
 *
 * @see {@link module:utils.createMap createMap}
 * @throws {TypeError} if argument is not a non-empty object.
 */
exports.defineConstants = function (
  obj: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  if (canonicalType(obj) !== "object" || !Object.keys(obj).length) {
    throw new TypeError("Invalid argument; expected a non-empty object");
  }
  return Object.freeze(exports.createMap(obj));
};

/**
 * Returns current working directory
 *
 * Wrapper around `process.cwd()` for isolation
 * @private
 */
exports.cwd = function cwd(): string {
  return process.cwd();
};

/**
 * Returns `true` if Mocha is running in a browser.
 * Checks for `process.browser`.
 * @private
 */
exports.isBrowser = function isBrowser(): boolean {
  return Boolean((process as unknown as Record<string, unknown>).browser);
};

/**
 * Casts `value` to an array; useful for optionally accepting array parameters
 *
 * It follows these rules, depending on `value`.  If `value` is...
 * 1. `undefined`: return an empty Array
 * 2. `null`: return an array with a single `null` element
 * 3. Any other object: return the value of `Array.from()` _if_ the object is iterable
 * 4. otherwise: return an array with a single element, `value`
 */
exports.castArray = function castArray(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (value === null) {
    return [null];
  }
  if (
    typeof value === "object" &&
    (typeof (value as Record<symbol, unknown>)[Symbol.iterator] ===
      "function" ||
      (value as Record<string, unknown>).length !== undefined)
  ) {
    return Array.from(value as Iterable<unknown>);
  }
  return [value];
};

exports.constants = exports.defineConstants({
  MOCHA_ID_PROP_NAME,
});

const uniqueIDBase =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

/**
 * Creates a new unique identifier
 * Does not create cryptographically safe ids.
 * Trivial copy of nanoid/non-secure
 */
exports.uniqueID = (): string => {
  let id = "";
  for (let i = 0; i < 21; i++) {
    id += uniqueIDBase[(Math.random() * 64) | 0];
  }
  return id;
};

exports.assignNewMochaID = (obj: Record<string, unknown>): Record<string, unknown> => {
  const id = exports.uniqueID();
  Object.defineProperty(obj, MOCHA_ID_PROP_NAME, {
    get() {
      return id;
    },
  });
  return obj;
};

/**
 * Retrieves a Mocha ID from an object, if present.
 */
exports.getMochaID = (obj?: unknown): string | undefined =>
  obj && typeof obj === "object"
    ? (obj as Record<string, unknown>)[MOCHA_ID_PROP_NAME] as string | undefined
    : undefined;

/**
 * Replaces any detected circular dependency with the string '[Circular]'
 * Mutates original object
 */
exports.breakCircularDeps = (inputObj: unknown): unknown => {
  const seen = new Set<unknown>();

  function _breakCircularDeps(obj: unknown): unknown {
    if (obj && typeof obj !== "object") {
      return obj;
    }

    if (seen.has(obj)) {
      return "[Circular]";
    }

    seen.add(obj);
    for (const k in obj as Record<string, unknown>) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, k);

      if (descriptor && descriptor.writable) {
        (obj as Record<string, unknown>)[k] = _breakCircularDeps(
          (obj as Record<string, unknown>)[k],
        );
      }
    }

    // deleting means only a seen object that is its own child will be detected
    seen.delete(obj);
    return obj;
  }

  return _breakCircularDeps(inputObj);
};

/**
 * Checks if provided input can be parsed as a JavaScript Number.
 */
exports.isNumeric = (input: unknown): boolean => {
  return !isNaN(parseFloat(input as string));
};

/**
 * Checks if being ran in a CI environment.
 *
 * This uses the CI env variable, which is set by most popular CI providers. Some
 * examples include:
 * Github:     https://docs.github.com/en/actions/reference/workflows-and-actions/variables
 * Gitlab:     https://docs.gitlab.com/ci/variables/predefined_variables/
 * CircleCI:   https://circleci.com/docs/reference/variables/#built-in-environment-variables
 * Bitbucket:  https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/
 */
exports.isCI = (): boolean => {
  return !!process.env.CI;
};

exports.logSymbols = {
  info: pc.blue(isUnicodeSupported ? "ℹ" : "i"),
  success: pc.green(isUnicodeSupported ? "✔" : "√"),
  warning: pc.yellow(isUnicodeSupported ? "⚠" : "‼"),
  error: pc.red(isUnicodeSupported ? "✖" : "×"),
};
