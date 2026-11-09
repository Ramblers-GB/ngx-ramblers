import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ESLint } from "eslint";

const baselineRelativePath = ".eslint-baselines/no-inline-route-handler.json";
const patterns = [
  "server/**/*-routes.ts",
];

const digestFromMessage = (message: string): string | null => {
  const match = message.match(/\(([a-f0-9]{12})\)$/);
  return match ? match[1] : null;
};

const main = async () => {
  const absoluteBaselinePath = join(process.cwd(), baselineRelativePath);
  mkdirSync(dirname(absoluteBaselinePath), {recursive: true});
  writeFileSync(absoluteBaselinePath, "[]\n");

  const eslint = new ESLint({
    overrideConfigFile: join(process.cwd(), ".eslint-config/eslint.config.js"),
  });

  const results = await eslint.lintFiles(patterns);
  const keys = results
    .flatMap(result => {
      const relativePath = relative(process.cwd(), result.filePath).split("\\").join("/");
      return (result.messages || [])
        .filter(message => message.ruleId === "ngx/no-inline-route-handler")
        .map(message => {
          const digest = digestFromMessage(message.message || "");
          return digest ? `${relativePath}:${digest}` : null;
        })
        .filter((key): key is string => !!key);
    });

  const uniqueKeys = Array.from(new Set(keys)).sort();
  writeFileSync(absoluteBaselinePath, `${JSON.stringify(uniqueKeys, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${uniqueKeys.length} inline-route-handler baseline entries to ${baselineRelativePath}\n`
  );
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
