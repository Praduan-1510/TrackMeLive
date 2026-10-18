// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // src/shared/ is a copy of the generated shared schema (scripts/sync-schema.mjs).
  { ignores: ["lib/**", "node_modules/**", "src/shared/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    // Plain Node scripts: no type information, Node globals.
    files: ["eslint.config.js", "scripts/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
