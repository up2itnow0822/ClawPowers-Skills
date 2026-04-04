import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tsParser,
      globals: {
        ...globals.node,
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "off", // TypeScript handles this
      "no-constant-condition": "warn",
      "no-empty": "warn",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "error",
      "no-unreachable": "error",
      "eqeqeq": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      "no-throw-literal": "off",
      "@typescript-eslint/no-throw-literal": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
    }
  }
];
