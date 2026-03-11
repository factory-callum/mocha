"use strict";

/**
 * Responsible for loading / finding Mocha's "rc" files.
 *
 * @private
 * @module
 */

const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:config");
const findUp: {
  sync: (names: string[], options?: { cwd?: string }) => string | undefined;
} = require("find-up");
const { createUnparsableFileError }: {
  createUnparsableFileError: (message: string, filepath?: string) => Error;
} = require("../errors");
const utils: { cwd: () => string } = require("../utils");

interface ConfigParsers {
  yaml: (filepath: string) => Record<string, unknown>;
  js: (filepath: string) => Record<string, unknown>;
  json: (filepath: string) => Record<string, unknown>;
}

/**
 * These are the valid config files, in order of precedence;
 * e.g., if `.mocharc.js` is present, then `.mocharc.yaml` and the rest
 * will be ignored.
 * The user should still be able to explicitly specify a file.
 * @private
 */
exports.CONFIG_FILES = [
  ".mocharc.cjs",
  ".mocharc.js",
  ".mocharc.mjs",
  ".mocharc.yaml",
  ".mocharc.yml",
  ".mocharc.jsonc",
  ".mocharc.json",
] as const;

/**
 * Parsers for various config filetypes. Each accepts a filepath and
 * returns an object (but could throw)
 */
const parsers: ConfigParsers = (exports.parsers = {
  yaml: (filepath: string): Record<string, unknown> =>
    require("js-yaml").load(fs.readFileSync(filepath, "utf8")),
  js: (filepath: string): Record<string, unknown> => {
    let cwdFilepath: string | undefined;
    try {
      debug('parsers: load cwd-relative path: "%s"', path.resolve(filepath));
      cwdFilepath = require.resolve(path.resolve(filepath)); // evtl. throws
      return require(cwdFilepath);
    } catch (err) {
      if (cwdFilepath) throw err;

      debug('parsers: retry load as module-relative path: "%s"', filepath);
      return require(filepath);
    }
  },
  json: (filepath: string): Record<string, unknown> =>
    JSON.parse(
      require("strip-json-comments").default(fs.readFileSync(filepath, "utf8")),
    ),
});

/**
 * Loads and parses, based on file extension, a config file.
 * "JSON" files may have comments.
 *
 * @private
 */
exports.loadConfig = (filepath: string): Record<string, unknown> => {
  let config: Record<string, unknown>;
  debug("loadConfig: trying to parse config at %s", filepath);

  const ext = path.extname(filepath);
  try {
    if (ext === ".yml" || ext === ".yaml") {
      config = parsers.yaml(filepath);
    } else if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
      const parsedConfig = parsers.js(filepath) as Record<string, unknown> & {
        default?: Record<string, unknown>;
      };
      config = (parsedConfig.default ?? parsedConfig) as Record<
        string,
        unknown
      >;
    } else {
      config = parsers.json(filepath);
    }
  } catch (err) {
    throw createUnparsableFileError(
      `Unable to read/parse ${filepath}: ${err}`,
      filepath,
    );
  }
  return config;
};

/**
 * Find ("find up") config file starting at `cwd`
 *
 * @private
 */
exports.findConfig = (cwd: string = utils.cwd()): string | undefined => {
  const filepath = findUp.sync([...exports.CONFIG_FILES], { cwd });
  if (filepath) {
    debug("findConfig: found config file %s", filepath);
  }
  return filepath;
};
