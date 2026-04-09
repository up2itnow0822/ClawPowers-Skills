import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const vitestGlobals = {
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "native/wasm/pkg/**", "native/wasm/pkg-node/**"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tsParser,
      globals: {
        ...globals.node,
        ...vitestGlobals,
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
      "no-throw-literal": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
    }
  },
  {
    files: ["benchmarks/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-constant-condition": "warn",
      "no-empty": "warn",
      "no-unreachable": "error",
      "eqeqeq": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
    },
  }
];
