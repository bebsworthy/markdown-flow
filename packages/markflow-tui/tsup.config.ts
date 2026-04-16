import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.tsx" },
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["react", "react/jsx-runtime", "ink", "@inkjs/ui", "markflow"],
});
