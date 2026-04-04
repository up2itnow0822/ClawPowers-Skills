import globals from "globals";

export default [
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-constant-condition": "warn",
      "no-empty": "warn",
      "no-redeclare": "error",
      "no-unreachable": "error",
      "eqeqeq": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      "no-throw-literal": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
    }
  }
];
