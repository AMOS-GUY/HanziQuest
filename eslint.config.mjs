import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The CSP still allows inline scripts (SECURITY.md, limitation 1), so the app must never
    // inject raw HTML or create script elements itself. React's escaping is the defence.
    rules: {
      "react/no-danger": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='createElement'][arguments.0.value='script']",
          message:
            "Don't create script elements: the CSP relies on the app never injecting scripts.",
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: "Don't assign raw HTML: the CSP relies on React's escaping.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    ".local/**",
    "playwright-report/**",
    "test-results/**",
    "icon design/**",
  ]),
]);
