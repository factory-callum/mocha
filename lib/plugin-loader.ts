"use strict";

import type {
  PluginDefinition,
  MochaRootHookObject,
} from "./types.d.ts";

/**
 * Provides a way to load "plugins" as provided by the user.
 *
 * Currently supports:
 *
 * - Root hooks
 * - Global fixtures (setup/teardown)
 * @private
 * @module plugin
 */

const debug: (...args: unknown[]) => void = require("debug")(
  "mocha:plugin-loader",
);
const {
  createInvalidPluginDefinitionError,
  createInvalidPluginImplementationError,
} = require("./errors");
const { castArray } = require("./utils");

/** Hook function type */
type HookFn = (...args: unknown[]) => unknown;

/** Interface for a root hook object with array hooks */
interface RootHookArrayObject {
  beforeAll: HookFn[];
  beforeEach: HookFn[];
  afterAll: HookFn[];
  afterEach: HookFn[];
}

/** Local options interface that correctly types pluginDefs as array */
interface PluginLoaderConstructorOptions {
  pluginDefs?: PluginDefinition[];
  ignore?: string[];
}

/**
 * Built-in plugin definitions.
 */
const MochaPlugins: PluginDefinition[] = [
  /**
   * Root hook plugin definition
   */
  {
    exportName: "mochaHooks",
    optionName: "rootHooks",
    validate(value: unknown): void {
      if (
        Array.isArray(value) ||
        (typeof value !== "function" && typeof value !== "object")
      ) {
        throw createInvalidPluginImplementationError(
          `mochaHooks must be an object or a function returning (or fulfilling with) an object`,
        );
      }
    },
    async finalize(
      rootHooks: unknown[],
    ): Promise<MochaRootHookObject | undefined> {
      if (rootHooks.length) {
        const rootHookObjects: Record<string, unknown>[] = await Promise.all(
          rootHooks.map(async (hook: unknown) =>
            typeof hook === "function" ? hook() : hook,
          ),
        );

        return rootHookObjects.reduce<RootHookArrayObject>(
          (acc, hook) => {
            const normalized: RootHookArrayObject = Object.assign(
              { beforeAll: [], beforeEach: [], afterAll: [], afterEach: [] },
              hook,
            );
            return {
              beforeAll: [
                ...acc.beforeAll,
                ...castArray(normalized.beforeAll),
              ],
              beforeEach: [
                ...acc.beforeEach,
                ...castArray(normalized.beforeEach),
              ],
              afterAll: [
                ...acc.afterAll,
                ...castArray(normalized.afterAll),
              ],
              afterEach: [
                ...acc.afterEach,
                ...castArray(normalized.afterEach),
              ],
            };
          },
          { beforeAll: [], beforeEach: [], afterAll: [], afterEach: [] },
        );
      }
    },
  },
  /**
   * Global setup fixture plugin definition
   */
  {
    exportName: "mochaGlobalSetup",
    optionName: "globalSetup",
    validate(this: PluginDefinition, value: unknown): void {
      let isValid = true;
      if (Array.isArray(value)) {
        if (value.some((item: unknown) => typeof item !== "function")) {
          isValid = false;
        }
      } else if (typeof value !== "function") {
        isValid = false;
      }
      if (!isValid) {
        throw createInvalidPluginImplementationError(
          `mochaGlobalSetup must be a function or an array of functions`,
          { pluginDef: this, pluginImpl: value },
        );
      }
    },
  },
  /**
   * Global teardown fixture plugin definition
   */
  {
    exportName: "mochaGlobalTeardown",
    optionName: "globalTeardown",
    validate(this: PluginDefinition, value: unknown): void {
      let isValid = true;
      if (Array.isArray(value)) {
        if (value.some((item: unknown) => typeof item !== "function")) {
          isValid = false;
        }
      } else if (typeof value !== "function") {
        isValid = false;
      }
      if (!isValid) {
        throw createInvalidPluginImplementationError(
          `mochaGlobalTeardown must be a function or an array of functions`,
          { pluginDef: this, pluginImpl: value },
        );
      }
    },
  },
];

/**
 * Contains a registry of plugin definitions and discovers plugin implementations in user-supplied code.
 *
 * - [load()]{@link #load} should be called for all required modules
 * - The result of [finalize()]{@link #finalize} should be merged into the options for the {@link Mocha} constructor.
 * @private
 */
class PluginLoader {
  /** Map of registered plugin defs */
  registered: Map<string, PluginDefinition>;

  /** Cache of known `optionName` values for checking conflicts */
  knownOptionNames: Set<string>;

  /** Cache of known `exportName` values for checking conflicts */
  knownExportNames: Set<string>;

  /** Map of user-supplied plugin implementations */
  loaded: Map<string, unknown[]>;

  /** Set of ignored plugins by export name */
  ignoredExportNames: Set<string>;

  /**
   * Initializes plugin names, plugin map, etc.
   * @param opts - Options
   */
  constructor({
    pluginDefs = MochaPlugins,
    ignore = [],
  }: PluginLoaderConstructorOptions = {}) {
    this.registered = new Map();
    this.knownOptionNames = new Set();
    this.knownExportNames = new Set();
    this.loaded = new Map();
    this.ignoredExportNames = new Set(
      castArray(ignore) as string[],
    );

    (castArray(pluginDefs) as PluginDefinition[]).forEach(
      (pluginDef: PluginDefinition) => {
        this.register(pluginDef);
      },
    );

    debug(
      "registered %d plugin defs (%d ignored)",
      this.registered.size,
      this.ignoredExportNames.size,
    );
  }

  /**
   * Register a plugin
   * @param pluginDef - Plugin definition
   */
  register(pluginDef: PluginDefinition): void {
    if (!pluginDef || typeof pluginDef !== "object") {
      throw createInvalidPluginDefinitionError(
        "pluginDef is non-object or falsy",
        pluginDef,
      );
    }
    if (!pluginDef.exportName) {
      throw createInvalidPluginDefinitionError(
        `exportName is expected to be a non-empty string`,
        pluginDef,
      );
    }
    let { exportName } = pluginDef;
    if (this.ignoredExportNames.has(exportName)) {
      debug(
        'refusing to register ignored plugin with export name "%s"',
        exportName,
      );
      return;
    }
    exportName = String(exportName);
    pluginDef.optionName = String(pluginDef.optionName || exportName);
    if (this.knownExportNames.has(exportName)) {
      throw createInvalidPluginDefinitionError(
        `Plugin definition conflict: ${exportName}; exportName must be unique`,
        pluginDef,
      );
    }
    this.loaded.set(exportName, []);
    this.registered.set(exportName, pluginDef);
    this.knownExportNames.add(exportName);
    this.knownOptionNames.add(pluginDef.optionName);
    debug('registered plugin def "%s"', exportName);
  }

  /**
   * Inspects a module's exports for known plugins and keeps them in memory.
   *
   * @param requiredModule - The exports of a module loaded via `--require`
   * @returns If one or more plugins was found, return `true`.
   */
  load(requiredModule: unknown): boolean {
    // we should explicitly NOT fail if other stuff is exported.
    // we only care about the plugins we know about.
    if (requiredModule && typeof requiredModule === "object") {
      return Array.from(this.knownExportNames).reduce<boolean>(
        (pluginImplFound: boolean, pluginName: string) => {
          const pluginImpl = (requiredModule as Record<string, unknown>)[
            pluginName
          ];
          if (pluginImpl) {
            const plugin = this.registered.get(pluginName)!;
            if (typeof plugin.validate === "function") {
              plugin.validate(pluginImpl);
            }
            this.loaded.set(pluginName, [
              ...this.loaded.get(pluginName)!,
              ...castArray(pluginImpl),
            ]);
            return true;
          }
          return pluginImplFound;
        },
        false,
      );
    }
    return false;
  }

  /**
   * Call the `finalize()` function of each known plugin definition on the plugins found by {@link PluginLoader#load}.
   *
   * Output suitable for passing as input into {@link Mocha} constructor.
   * @returns Object having keys corresponding to registered plugin definitions' `optionName` prop (or `exportName`, if none), and the values are the implementations as provided by a user.
   */
  async finalize(): Promise<Record<string, unknown>> {
    const finalizedPlugins: Record<string, unknown> = Object.create(null);

    for await (const [exportName, pluginImpls] of this.loaded.entries()) {
      if (pluginImpls.length) {
        const plugin = this.registered.get(exportName)!;
        finalizedPlugins[plugin.optionName!] =
          typeof plugin.finalize === "function"
            ? await plugin.finalize(pluginImpls)
            : pluginImpls;
      }
    }

    debug("finalized plugins: %O", finalizedPlugins);
    return finalizedPlugins;
  }

  /**
   * Constructs a {@link PluginLoader}
   * @param opts - Plugin loader options
   */
  static create({
    pluginDefs = MochaPlugins,
    ignore = [],
  }: PluginLoaderConstructorOptions = {}): PluginLoader {
    return new PluginLoader({ pluginDefs, ignore });
  }
}

module.exports = PluginLoader;
