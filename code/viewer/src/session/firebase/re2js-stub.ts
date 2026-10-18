/**
 * Stands in for the re2js package (about 144 KB of the Firestore chunk's 537 KB), which Firestore
 * imports only to evaluate the regex and LIKE functions of its Pipelines API on the client. The page
 * never runs a pipeline, so vite.config.ts points the import here. If a pipeline ever did reach it,
 * Firestore's own try/catch turns the error into a failed expression, never a crash.
 */

export const RE2JS = {
  compile(): never {
    throw new Error('Regular expressions in Firestore pipelines aren’t available on the viewer page.');
  },
};
