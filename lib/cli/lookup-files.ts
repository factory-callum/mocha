"use strict";
/**
 * Contains `lookupFiles`, which takes some globs/dirs/options and returns a list of files.
 * @module
 * @private
 */

const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const glob: {
  sync: (pattern: string, opts?: Record<string, unknown>) => string[];
  hasMagic: (pattern: string, opts?: Record<string, unknown>) => boolean;
} = require("glob");
const errors: {
  createNoFilesMatchPatternError: (
    message: string,
    pattern: string,
  ) => Error & { code: string; pattern: string };
  createMissingArgumentError: (
    message: string,
    argument: string,
    expected: string,
  ) => Error & { code: string };
} = require("../errors");
const createNoFilesMatchPatternError = errors.createNoFilesMatchPatternError;
const createMissingArgumentError = errors.createMissingArgumentError;
const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:lookup-files");

/**
 * Determines if pathname would be a "hidden" file (or directory) on UN*X.
 *
 * @description
 * On UN*X, pathnames beginning with a full stop (aka dot) are hidden during
 * typical usage. Dotfiles, plain-text configuration files, are prime examples.
 *
 * @see {@link http://xahlee.info/UnixResource_dir/writ/unix_origin_of_dot_filename.html|Origin of Dot File Names}
 *
 * @private
 * @example
 * isHiddenOnUnix('.profile'); // => true
 */
const isHiddenOnUnix = (pathname: string): boolean =>
  path.basename(pathname).startsWith(".");

/**
 * Determines if pathname has a matching file extension.
 *
 * Supports multi-part extensions.
 *
 * @private
 * @example
 * hasMatchingExtname('foo.html', ['js', 'css']); // false
 * hasMatchingExtname('foo.js', ['.js']); // true
 * hasMatchingExtname('foo.js', ['js']); // true
 */
const hasMatchingExtname = (pathname: string, exts: string[] = []): boolean =>
  exts
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
    .some((ext) => pathname.endsWith(ext));

/**
 * Lookup file names at the given `path`.
 *
 * @description
 * Filenames are returned in _traversal_ order by the OS/filesystem.
 * **Make no assumption that the names will be sorted in any fashion.**
 *
 * @public
 * @alias module:lib/cli.lookupFiles
 * @throws {Error} if no files match pattern.
 * @throws {TypeError} if `filepath` is directory and `extensions` not provided.
 */
module.exports = function lookupFiles(
  filepath: string,
  extensions: string[] = [],
  recursive: boolean = false,
): string[] | string | undefined {
  const files: string[] = [];
  let stat: import("node:fs").Stats | undefined;

  if (!fs.existsSync(filepath)) {
    let pattern: string;
    if (glob.hasMagic(filepath, { windowsPathsNoEscape: true })) {
      // Handle glob as is without extensions
      pattern = filepath;
    } else {
      // glob pattern e.g. 'filepath+(.js|.ts)'
      const strExtensions = extensions
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
        .join("|");
      pattern = `${filepath}+(${strExtensions})`;
      debug("looking for files using glob pattern: %s", pattern);
    }
    files.push(
      ...glob
        .sync(pattern, {
          nodir: true,
          windowsPathsNoEscape: true,
        })
        // glob@8 and earlier sorted results in en; glob@9 depends on OS sorting.
        // This preserves the older glob behavior.
        // https://github.com/mochajs/mocha/pull/5250/files#r1840469747
        .sort((a: string, b: string) => a.localeCompare(b, "en")),
    );
    if (!files.length) {
      throw createNoFilesMatchPatternError(
        `Cannot find any files matching pattern "${filepath}"`,
        filepath,
      );
    }
    return files;
  }

  // Handle file
  try {
    stat = fs.statSync(filepath);
    if (stat.isFile() || stat.isFIFO()) {
      return filepath;
    }
  } catch {
    // ignore error
    return;
  }

  // Handle directory
  fs.readdirSync(filepath).forEach((dirent: string) => {
    const pathname = path.join(filepath, dirent);
    let stat: import("node:fs").Stats | undefined;

    try {
      stat = fs.statSync(pathname);
      if (stat.isDirectory()) {
        if (recursive) {
          const result = lookupFiles(pathname, extensions, recursive);
          if (Array.isArray(result)) {
            files.push(...result);
          } else if (typeof result === "string") {
            files.push(result);
          }
        }
        return;
      }
    } catch {
      return;
    }
    if (!extensions.length) {
      throw createMissingArgumentError(
        `Argument '${extensions}' required when argument '${filepath}' is a directory`,
        "extensions",
        "array",
      );
    }

    if (
      !stat!.isFile() ||
      !hasMatchingExtname(pathname, extensions) ||
      isHiddenOnUnix(pathname)
    ) {
      return;
    }
    files.push(pathname);
  });

  return files;
};
