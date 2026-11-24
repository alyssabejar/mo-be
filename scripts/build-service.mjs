// Bundle a service (and the workspace packages it uses) into dist/main.js.
// Run from the service directory: `pnpm build`.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // pg-native is an optional add-on of pg; never installed here.
  external: ["pg-native"],
  // Let bundled CommonJS dependencies call require() under ESM.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("built dist/main.js");
