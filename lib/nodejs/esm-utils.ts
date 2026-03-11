const path = require("node:path");
const url = require("node:url");
const debug = require("debug")("mocha:esm-utils");
const { isMochaError } = require("../errors");

const forward = (x: string | URL): string | URL => x;

/** Type for ESM decorator functions that transform file paths/URLs before import */
type EsmDecorator = (file: string | URL) => string | URL;

/** Type for an ESM module with a possible default export */
interface EsmModule {
  default?: unknown;
  [key: string]: unknown;
}

const formattedImport = async (
  file: string,
  esmDecorator: EsmDecorator = forward,
): Promise<unknown> => {
  if (path.isAbsolute(file)) {
    try {
      return await exports.doImport(esmDecorator(url.pathToFileURL(file)));
    } catch (err) {
      // This is a hack created because ESM in Node.js (at least in Node v15.5.1) does not emit
      // the location of the syntax error in the error thrown.
      // This is problematic because the user can't see what file has the problem,
      // so we add the file location to the error.
      // TODO: remove once Node.js fixes the problem.
      if (
        err instanceof SyntaxError &&
        err.message &&
        err.stack &&
        !err.stack.includes(file)
      ) {
        const newErrorWithFilename = new SyntaxError(err.message);
        newErrorWithFilename.stack = err.stack.replace(
          /^SyntaxError/,
          `SyntaxError[ @${file} ]`,
        );
        throw newErrorWithFilename;
      }
      throw err;
    }
  }
  return exports.doImport(esmDecorator(file));
};

exports.doImport = async (file: string | URL): Promise<unknown> => import(file as string);

// When require(esm) is not available, we need to use `import()` to load ESM modules.
// In this case, CJS modules are loaded using `import()` as well. When Node.js' builtin
// TypeScript support is enabled, `.ts` files are also loaded using `import()`, and
// compilers based on `require.extensions` are omitted.
const tryImportAndRequire = async (
  file: string,
  esmDecorator?: EsmDecorator,
): Promise<unknown> => {
  if (path.extname(file) === ".mjs") {
    return formattedImport(file, esmDecorator);
  }
  try {
    return dealWithExports(await formattedImport(file, esmDecorator) as EsmModule);
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
      (err as NodeJS.ErrnoException).code === "ERR_UNKNOWN_FILE_EXTENSION" ||
      (err as NodeJS.ErrnoException).code === "ERR_UNSUPPORTED_DIR_IMPORT"
    ) {
      try {
        // Importing a file usually works, but the resolution of `import` is the ESM
        // resolution algorithm, and not the CJS resolution algorithm. We may have
        // failed because we tried the ESM resolution, so we try to `require` it.
        return require(file);
      } catch (requireErr) {
        if (
          (requireErr as NodeJS.ErrnoException).code === "ERR_REQUIRE_ESM" ||
          (requireErr instanceof SyntaxError &&
            requireErr
              .toString()
              .includes("Cannot use import statement outside a module"))
        ) {
          // ERR_REQUIRE_ESM happens when the test file is a JS file, but via type:module is actually ESM,
          // AND has an import to a file that doesn't exist.
          // This throws an `ERR_MODULE_NOT_FOUND` error above,
          // and when we try to `require` it here, it throws an `ERR_REQUIRE_ESM`.
          // What we want to do is throw the original error (the `ERR_MODULE_NOT_FOUND`),
          // and not the `ERR_REQUIRE_ESM` error, which is a red herring.
          //
          // SyntaxError happens when in an edge case: when we're using an ESM loader that loads
          // a `test.ts` file (i.e. unrecognized extension), and that file includes an unknown
          // import (which throws an ERR_MODULE_NOT_FOUND). `require`-ing it will throw the
          // syntax error, because we cannot require a file that has `import`-s.
          throw err;
        } else {
          throw requireErr;
        }
      }
    } else {
      throw err;
    }
  }
};

// Utilize Node.js' require(esm) feature to load ESM modules
// and CJS modules. This keeps the require() features like `require.extensions`
// and `require.cache` effective, while allowing us to load ESM modules
// and CJS modules in the same way.
const requireModule = async (
  file: string,
  esmDecorator?: EsmDecorator,
): Promise<unknown> => {
  if (path.extname(file) === ".mjs") {
    return formattedImport(file, esmDecorator);
  }
  try {
    return require(file);
  } catch (requireErr) {
    debug("requireModule caught err: %O", (requireErr as Error).message);
    if ((requireErr as Error).name === "TSError" || isMochaError(requireErr)) {
      throw requireErr;
    }
    try {
      return dealWithExports(await formattedImport(file, esmDecorator) as EsmModule);
    } catch (importErr) {
      // If a --require module throws in a Node.js version that doesn't yet support .ts files,
      // the fallback import() will throw an uninformative error about the file extension.
      // What we actually care about is the original require() error.
      // See: https://github.com/mochajs/mocha/issues/5393
      if (
        /\.(cts|mts|ts)$/.test(file) ||
        (importErr as NodeJS.ErrnoException).code === "ERR_UNKNOWN_FILE_EXTENSION"
      ) {
        throw requireErr;
      }

      // Similarly, for an exports/imports mismatch such as a missing 'default',
      // the require() error will be more informative for users.
      // See: https://github.com/mochajs/mocha/issues/5411
      if ((importErr as NodeJS.ErrnoException).code === "ERR_INTERNAL_ASSERTION") {
        throw requireErr;
      }

      throw importErr;
    }
  }
};

// We only assign this `requireOrImport` function once based on Node version
// We check for file extensions in `requireModule` and `tryImportAndRequire`
debug(
  "assigning requireOrImport, require_module === %O",
  (process as unknown as Record<string, Record<string, unknown>>).features
    .require_module,
);
if (
  (process as unknown as Record<string, Record<string, unknown>>).features
    .require_module
) {
  exports.requireOrImport = requireModule;
} else {
  exports.requireOrImport = tryImportAndRequire;
}

function dealWithExports(module: EsmModule): unknown {
  if (module.default) {
    return module.default;
  } else {
    return { ...module, default: undefined };
  }
}

exports.loadFilesAsync = async (
  files: string[],
  preLoadFunc: (file: string) => void,
  postLoadFunc: (file: string, result: unknown) => void,
  esmDecorator?: EsmDecorator,
): Promise<void> => {
  for (const file of files) {
    preLoadFunc(file);
    const result = await exports.requireOrImport(
      path.resolve(file),
      esmDecorator,
    );
    postLoadFunc(file, result);
  }
};
