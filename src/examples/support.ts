// Helpers for the examples' snippets: resolvers to hand to handlers, and ways
// for a test to read the URL and count history entries.

/** Text: anything in the URL that is not a string is "". */
export const text = (query: unknown) =>
  typeof query === "string" ? query : "";

/** A count: anything in the URL that is not a finite number is 0. */
export const count = (query: unknown) =>
  typeof query === "number" && Number.isFinite(query) ? query : 0;

/** A flag: only `true` in the URL is true. */
export const flag = (query: unknown) => query === true;

const read = (params: URLSearchParams, key: string) => {
  const all = params.getAll(key);
  return all.length > 1 ? all : (all[0] ?? null);
};

/** The value of a parameter in the URL's query: null if absent, an array if repeated. */
export const query = (key: string) =>
  read(new URL(location.href).searchParams, key);

/** The value of a parameter in the URL's hash: null if absent, an array if repeated. */
export const hash = (key: string) =>
  read(new URLSearchParams(location.hash.slice(1)), key);

/** Starts counting history entries: call what it returns for how many were added since. */
export const entries = () => {
  const start = history.length;
  return () => history.length - start;
};

/** Sets the URL's search and hash, as a link would before the page mounts. */
export const visit = (url: string) => history.replaceState(null, "", url);
