"use strict";

const { format } = require("node:util");
const { constants } = require("./error-constants.js");
const { isCI } = require("./utils");

/**
 * Contains error codes, factory functions to create throwable error objects,
 * and warning/deprecation functions.
 * @module
 */

/**
 * Interface for errors with a Mocha error code.
 */
interface MochaError extends Error {
  code: string;
  [key: string]: unknown;
}

/**
 * Interface for no-files-match-pattern errors.
 */
interface NoFilesMatchPatternError extends MochaError {
  pattern: string;
}

/**
 * Interface for invalid reporter errors.
 */
interface InvalidReporterError extends MochaError {
  reporter: string;
}

/**
 * Interface for invalid interface errors.
 */
interface InvalidInterfaceError extends MochaError {
  interface: string;
}

/**
 * Interface for invalid argument type errors.
 */
interface InvalidArgumentTypeError extends MochaError {
  argument: string;
  expected: string;
  actual: string;
}

/**
 * Interface for invalid argument value errors.
 */
interface InvalidArgumentValueError extends MochaError {
  argument: string;
  value: unknown;
  reason: string;
}

/**
 * Interface for invalid exception errors.
 */
interface InvalidExceptionError extends MochaError {
  valueType: string;
  value: unknown;
}

/**
 * Interface for fatal errors.
 */
interface FatalError extends MochaError {
  valueType: string;
  value: unknown;
}

/**
 * Interface for instance-already-disposed errors.
 */
interface InstanceAlreadyDisposedError extends MochaError {
  cleanReferencesAfterRun: boolean;
  instance: unknown;
}

/**
 * Interface for instance-already-running errors.
 */
interface InstanceAlreadyRunningError extends MochaError {
  instance: unknown;
}

/**
 * Interface for multiple-done errors.
 */
interface MultipleDoneError extends MochaError {
  valueType: string;
  value: unknown;
}

/**
 * Type alias for forbidden-exclusivity errors.
 */
type ForbiddenExclusivityError = MochaError;

/**
 * Interface for invalid plugin definition errors.
 */
interface InvalidPluginDefinitionError extends MochaError {
  pluginDef: unknown;
}

/**
 * Interface for invalid plugin implementation errors.
 */
interface InvalidPluginImplementationError extends MochaError {
  pluginDef: unknown;
  pluginImpl: unknown;
}

/**
 * Interface for timeout errors.
 */
interface TimeoutError extends MochaError {
  timeout: number | undefined;
  file: string | undefined;
}

/**
 * Type alias for unparsable file errors.
 */
type UnparsableFileError = MochaError;

/**
 * Minimal interface for Runnable-like objects used in error creation.
 */
interface RunnableLike {
  fullTitle(): string;
  title: string;
  type?: string;
  file?: string;
  parent: {
    root?: boolean;
    fullTitle(): string;
  };
}

/**
 * Minimal interface for Mocha-like objects used in error creation.
 */
interface MochaLike {
  isWorker?: boolean;
}

/**
 * process.emitWarning or a polyfill
 * @see https://nodejs.org/api/process.html#process_process_emitwarning_warning_options
 * @ignore
 */
const emitWarning = (msg: string, type?: string): void => {
  if (process.emitWarning) {
    process.emitWarning(msg, type);
  } else {
    /* istanbul ignore next */
    process.nextTick(function () {
      console.warn(type + ": " + msg);
    });
  }
};

/**
 * Show a deprecation warning. Each distinct message is only displayed once.
 * Ignores empty messages.
 *
 * @private
 */
const deprecate = (msg?: string): void => {
  const str = String(msg);
  if (str && !deprecate.cache[str]) {
    deprecate.cache[str] = true;
    emitWarning(str, "DeprecationWarning");
  }
};
deprecate.cache = {} as Record<string, boolean>;

/**
 * Show a generic warning.
 * Ignores empty messages.
 *
 * @private
 */
const warn = (msg?: string): void => {
  if (msg) {
    emitWarning(msg);
  }
};

/**
 * A set containing all string values of all Mocha error constants, for use by {@link isMochaError}.
 * @private
 */
const MOCHA_ERRORS: Set<string> = new Set(Object.values(constants));

/**
 * Creates an error object to be thrown when no files to be tested could be found using specified pattern.
 *
 * @public
 * @static
 */
function createNoFilesMatchPatternError(
  message: string,
  pattern: string,
): NoFilesMatchPatternError {
  const err = new Error(message) as NoFilesMatchPatternError;
  err.code = constants.NO_FILES_MATCH_PATTERN;
  err.pattern = pattern;
  return err;
}

/**
 * Creates an error object to be thrown when the reporter specified in the options was not found.
 *
 * @public
 */
function createInvalidReporterError(
  message: string,
  reporter: string,
): InvalidReporterError {
  const err = new TypeError(message) as InvalidReporterError;
  err.code = constants.INVALID_REPORTER;
  err.reporter = reporter;
  return err;
}

/**
 * Creates an error object to be thrown when the interface specified in the options was not found.
 *
 * @public
 * @static
 */
function createInvalidInterfaceError(
  message: string,
  ui: string,
): InvalidInterfaceError {
  const err = new Error(message) as InvalidInterfaceError;
  err.code = constants.INVALID_INTERFACE;
  err.interface = ui;
  return err;
}

/**
 * Creates an error object to be thrown when a behavior, option, or parameter is unsupported.
 *
 * @public
 * @static
 */
function createUnsupportedError(message: string): MochaError {
  const err = new Error(message) as MochaError;
  err.code = constants.UNSUPPORTED;
  return err;
}

/**
 * Creates an error object to be thrown when an argument is missing.
 *
 * @public
 * @static
 */
function createMissingArgumentError(
  message: string,
  argument: string,
  expected: string,
): InvalidArgumentTypeError {
  return createInvalidArgumentTypeError(message, argument, expected);
}

/**
 * Creates an error object to be thrown when an argument did not use the supported type
 *
 * @public
 * @static
 */
function createInvalidArgumentTypeError(
  message: string,
  argument: string,
  expected: string,
): InvalidArgumentTypeError {
  const err = new TypeError(message) as InvalidArgumentTypeError;
  err.code = constants.INVALID_ARG_TYPE;
  err.argument = argument;
  err.expected = expected;
  err.actual = typeof argument;
  return err;
}

/**
 * Creates an error object to be thrown when an argument did not use the supported value
 *
 * @public
 * @static
 */
function createInvalidArgumentValueError(
  message: string,
  argument: string,
  value: unknown,
  reason?: string,
): InvalidArgumentValueError {
  const err = new TypeError(message) as InvalidArgumentValueError;
  err.code = constants.INVALID_ARG_VALUE;
  err.argument = argument;
  err.value = value;
  err.reason = typeof reason !== "undefined" ? reason : "is invalid";
  return err;
}

/**
 * Creates an error object to be thrown when an exception was caught, but the `Error` is falsy or undefined.
 *
 * @public
 * @static
 */
function createInvalidExceptionError(
  message: string,
  value: unknown,
): InvalidExceptionError {
  const err = new Error(message) as InvalidExceptionError;
  err.code = constants.INVALID_EXCEPTION;
  err.valueType = typeof value;
  err.value = value;
  return err;
}

/**
 * Creates an error object to be thrown when an unrecoverable error occurs.
 *
 * @public
 * @static
 */
function createFatalError(message: string, value: unknown): FatalError {
  const err = new Error(message) as FatalError;
  err.code = constants.FATAL;
  err.valueType = typeof value;
  err.value = value;
  return err;
}

/**
 * Dynamically creates a plugin-type-specific error based on plugin type
 *
 * @public
 * @static
 * @throws When `pluginType` is not known
 */
function createInvalidLegacyPluginError(
  message: string,
  pluginType: "reporter" | "ui",
  pluginId?: string,
): InvalidReporterError | InvalidInterfaceError {
  switch (pluginType) {
    case "reporter":
      return createInvalidReporterError(message, pluginId!);
    case "ui":
      return createInvalidInterfaceError(message, pluginId!);
    default:
      throw new Error('unknown pluginType "' + pluginType + '"');
  }
}

/**
 * **DEPRECATED**.  Use {@link createInvalidLegacyPluginError} instead.
 * Dynamically creates a plugin-type-specific error based on plugin type
 * @deprecated
 * @public
 * @static
 */
function createInvalidPluginError(
  ...args: Parameters<typeof createInvalidLegacyPluginError>
): InvalidReporterError | InvalidInterfaceError {
  deprecate("Use createInvalidLegacyPluginError() instead");
  return createInvalidLegacyPluginError(...args);
}

/**
 * Creates an error object to be thrown when a mocha object's `run` method is executed while it is already disposed.
 * @static
 */
function createMochaInstanceAlreadyDisposedError(
  message: string,
  cleanReferencesAfterRun: boolean,
  instance: unknown,
): InstanceAlreadyDisposedError {
  const err = new Error(message) as InstanceAlreadyDisposedError;
  err.code = constants.INSTANCE_ALREADY_DISPOSED;
  err.cleanReferencesAfterRun = cleanReferencesAfterRun;
  err.instance = instance;
  return err;
}

/**
 * Creates an error object to be thrown when a mocha object's `run` method is called while a test run is in progress.
 * @static
 * @public
 */
function createMochaInstanceAlreadyRunningError(
  message: string,
  instance: unknown,
): InstanceAlreadyRunningError {
  const err = new Error(message) as InstanceAlreadyRunningError;
  err.code = constants.INSTANCE_ALREADY_RUNNING;
  err.instance = instance;
  return err;
}

/**
 * Creates an error object to be thrown when done() is called multiple times in a test
 *
 * @public
 * @static
 */
function createMultipleDoneError(
  runnable: RunnableLike,
  originalErr?: Error,
): MultipleDoneError {
  let title: string;
  try {
    title = format("<%s>", runnable.fullTitle());
    if (runnable.parent.root) {
      title += " (of root suite)";
    }
  } catch {
    title = format("<%s> (of unknown suite)", runnable.title);
  }
  let message = format(
    "done() called multiple times in %s %s",
    runnable.type ? runnable.type : "unknown runnable",
    title,
  );
  if (runnable.file) {
    message += format(" of file %s", runnable.file);
  }
  if (originalErr) {
    message += format("; in addition, done() received error: %s", originalErr);
  }

  const err = new Error(message) as MultipleDoneError;
  err.code = constants.MULTIPLE_DONE;
  err.valueType = typeof originalErr;
  err.value = originalErr;
  return err;
}

/**
 * Creates an error object to be thrown when `.only()` is used with
 * `--forbid-only`.
 * @static
 * @public
 */
function createForbiddenExclusivityError(
  mocha: MochaLike,
): ForbiddenExclusivityError {
  let message: string;
  if (mocha.isWorker) {
    message = "`.only` is not supported in parallel mode";
  } else {
    message = "`.only` forbidden by --forbid-only";
    if (isCI()) {
      message += " (default in CI, add `--no-forbid-only` to allow `.only`)";
    }
  }

  const err = new Error(message) as ForbiddenExclusivityError;
  err.code = constants.FORBIDDEN_EXCLUSIVITY;
  return err;
}

/**
 * Creates an error object to be thrown when a plugin definition is invalid
 * @static
 * @public
 */
function createInvalidPluginDefinitionError(
  msg: string,
  pluginDef?: unknown,
): InvalidPluginDefinitionError {
  const err = new Error(msg) as InvalidPluginDefinitionError;
  err.code = constants.INVALID_PLUGIN_DEFINITION;
  err.pluginDef = pluginDef;
  return err;
}

/**
 * Creates an error object to be thrown when a plugin implementation (user code) is invalid
 * @static
 * @public
 */
function createInvalidPluginImplementationError(
  msg: string,
  { pluginDef, pluginImpl }: { pluginDef?: unknown; pluginImpl?: unknown } = {},
): InvalidPluginImplementationError {
  const err = new Error(msg) as InvalidPluginImplementationError;
  err.code = constants.INVALID_PLUGIN_IMPLEMENTATION;
  err.pluginDef = pluginDef;
  err.pluginImpl = pluginImpl;
  return err;
}

/**
 * Creates an error object to be thrown when a runnable exceeds its allowed run time.
 * @static
 */
function createTimeoutError(
  msg: string,
  timeout?: number,
  file?: string,
): TimeoutError {
  const err = new Error(msg) as TimeoutError;
  err.code = constants.TIMEOUT;
  err.timeout = timeout;
  err.file = file;
  return err;
}

/**
 * Creates an error object to be thrown when file is unparsable
 * @public
 * @static
 */
function createUnparsableFileError(message: string): UnparsableFileError {
  const err = new Error(message) as UnparsableFileError;
  err.code = constants.UNPARSABLE_FILE;
  return err;
}

/**
 * Returns `true` if an error came out of Mocha.
 * _Can suffer from false negatives, but not false positives._
 * @static
 * @public
 */
const isMochaError = (err: unknown): boolean =>
  Boolean(
    err &&
      typeof err === "object" &&
      MOCHA_ERRORS.has((err as Record<string, unknown>).code as string),
  );

module.exports = {
  createFatalError,
  createForbiddenExclusivityError,
  createInvalidArgumentTypeError,
  createInvalidArgumentValueError,
  createInvalidExceptionError,
  createInvalidInterfaceError,
  createInvalidLegacyPluginError,
  createInvalidPluginDefinitionError,
  createInvalidPluginError,
  createInvalidPluginImplementationError,
  createInvalidReporterError,
  createMissingArgumentError,
  createMochaInstanceAlreadyDisposedError,
  createMochaInstanceAlreadyRunningError,
  createMultipleDoneError,
  createNoFilesMatchPatternError,
  createTimeoutError,
  createUnparsableFileError,
  createUnsupportedError,
  deprecate,
  isMochaError,
  warn,
};
