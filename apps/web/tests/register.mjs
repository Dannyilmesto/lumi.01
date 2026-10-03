import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(specifier, context, next) {
    let url;
    if (specifier.startsWith("@/"))
      url = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url);
    else if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) url = candidate;
    }
    return next(url?.href ?? specifier, context);
  },
});
