import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        module: "commonjs",
        moduleResolution: "node",
      },
    }],
    // Transform ESM-only node_modules used by sanitize-html
    "^.+\\.m?js$": ["ts-jest", {
      tsconfig: {
        module: "commonjs",
        moduleResolution: "node",
        allowJs: true,
      },
    }],
  },
  // Allow Jest to transform ESM packages (htmlparser2, sanitize-html, etc.)
  transformIgnorePatterns: [
    "/node_modules/(?!(sanitize-html|htmlparser2|domhandler|dom-serializer|domelementtype|domutils|entities|css-what|css-select|nth-check|boolbase)/)",
  ],
  testMatch: ["**/tests/**/*.test.ts"],
};

export default config;
