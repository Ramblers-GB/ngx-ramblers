import type { ConstructorOptions, JSDOM } from "jsdom";
import type * as TypeScript from "typescript";

export function jsdomFor(html: string, options: ConstructorOptions = {}): JSDOM {
  const jsdom = require("jsdom") as typeof import("jsdom");
  return new jsdom.JSDOM(html, options);
}

export function typescriptCompiler(): typeof TypeScript {
  return require("typescript") as typeof TypeScript;
}
