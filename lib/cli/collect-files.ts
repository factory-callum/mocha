"use strict";

import type {
  FileCollectionOptions,
  FileCollectionResponse,
  UnmatchedFile,
} from "../types.d.ts";

const path: typeof import("node:path") = require("node:path");
const pc: typeof import("picocolors") = require("picocolors");
const debug: (...args: unknown[]) => void =
  require("debug")("mocha:cli:run:helpers");
const { minimatch }: { minimatch: (file: string, pattern: string, opts?: Record<string, unknown>) => boolean } =
  require("minimatch");
const { NO_FILES_MATCH_PATTERN }: { NO_FILES_MATCH_PATTERN: string } =
  require("../error-constants").constants;
const lookupFiles: (
  filepath: string,
  extensions?: string[],
  recursive?: boolean,
) => string[] | string | undefined = require("./lookup-files");
const { castArray }: { castArray: (val: unknown) => unknown[] } =
  require("../utils");

/**
 * Exports a function that collects test files from CLI parameters.
 * @see module:lib/cli/run-helpers
 * @see module:lib/cli/watch-run
 * @module
 * @private
 */

interface UnmatchedSpecFile {
  message: string;
  pattern: string;
}

/**
 * Smash together an array of test files in the correct order
 * @private
 */
module.exports = ({
  ignore = [],
  extension = [],
  file: fileArgs = [],
  recursive = false,
  sort = false,
  spec = [],
}: FileCollectionOptions = {}): FileCollectionResponse => {
  const unmatchedSpecFiles: UnmatchedSpecFile[] = [];
  const specFiles = spec.reduce<string[]>((specFiles, arg) => {
    try {
      const moreSpecFiles = (castArray(lookupFiles(arg, extension, recursive)) as string[])
        .filter((filename: string) =>
          ignore.every(
            (pattern: string) =>
              !minimatch(filename, pattern, { windowsPathsNoEscape: true }),
          ),
        )
        .map((filename: string) => path.resolve(filename));
      return [...specFiles, ...moreSpecFiles];
    } catch (err: unknown) {
      if ((err as Record<string, unknown>).code === NO_FILES_MATCH_PATTERN) {
        const e = err as { message: string; pattern: string };
        unmatchedSpecFiles.push({ message: e.message, pattern: e.pattern });
        return specFiles;
      }

      throw err;
    }
  }, []);

  // check that each file passed in to --file exists

  const unmatchedFiles: UnmatchedFile[] = [];
  fileArgs.forEach((file: string) => {
    const fileAbsolutePath = path.resolve(file);
    try {
      // Used instead of fs.existsSync to ensure that file-ending less files are still resolved correctly
      require.resolve(fileAbsolutePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
        unmatchedFiles.push({
          pattern: file,
          absolutePath: fileAbsolutePath,
        });
        return;
      }

      throw err;
    }
  });

  // ensure we don't sort the stuff from fileArgs; order is important!
  if (sort) {
    specFiles.sort();
  }

  // add files given through --file to be ran first
  const files: string[] = [
    ...fileArgs.map((filepath: string) => path.resolve(filepath)),
    ...specFiles,
  ];
  debug("test files (in order): ", files);

  if (!files.length) {
    // give full message details when only 1 file is missing
    const noneFoundMsg =
      unmatchedSpecFiles.length === 1
        ? `Error: No test files found: ${JSON.stringify(
            unmatchedSpecFiles[0].pattern,
          )}` // stringify to print escaped characters raw
        : "Error: No test files found";
    console.error(pc.red(noneFoundMsg));
    process.exit(1);
  } else {
    // print messages as a warning
    unmatchedSpecFiles.forEach((warning) => {
      console.warn(pc.yellow(`Warning: ${warning.message}`));
    });
  }

  return {
    files,
    unmatchedFiles,
  };
};
