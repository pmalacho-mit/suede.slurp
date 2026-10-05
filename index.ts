export { default as URLParameterize, defaults } from "./URLParameterize.svelte";

import type {
  ParameterHandlers,
  ParameterHandler,
  Options as URLParameterizeOptions,
  Return as URLParameterizeReturn,
} from "./URLParameterize.svelte";

export namespace URLParameterize {
  export type Return<Property extends string = string> =
    URLParameterizeReturn<Property>;

  /**
   * Defines parameter handlers for all properties of type T.
   *
   * Maps each property name to its corresponding handler configuration.
   */
  export type Handlers<T> = ParameterHandlers<T>;

  /**
   * Defines a parameter handler for a single property of type T.
   *
   * Can be either a resolve function or a verbose handler configuration object.
   */
  export type Handler<T> = ParameterHandler<T>;

  /**
   * Global configuration options for URLParameterize.
   *
   * Includes settings for URL key prefix, cleanup callback, and debounce behavior,
   *
   * as well as global settings for serialization, deserialization, encoding, decoding, and history management.
   */
  export type Options = URLParameterizeOptions;
}
