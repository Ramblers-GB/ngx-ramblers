import { ParsedMongoUri } from "../shared/mongodb-uri";
import { ContributorBundleOptions } from "./contributor-environment.model";

export function cloneSchemaNameAllowed(sourceDatabase: string, targetDatabase: string): boolean {
  return !!sourceDatabase && !!targetDatabase && targetDatabase.startsWith(`${sourceDatabase}-`);
}

export function contributorBundleProblem(options: ContributorBundleOptions, parsedMongo: ParsedMongoUri | null): string | null {
  const schema = options.clone ? options.schema : parsedMongo?.database;
  if (!options.environmentName) {
    return "environmentName is required";
  } else if (!parsedMongo) {
    return "Could not read the current database connection";
  } else if (!schema) {
    return options.clone ? "A schema name is required to clone the database" : "Could not determine the current database";
  } else if (options.clone && schema === parsedMongo.database) {
    return "Choose a schema name different from the current database for a clone";
  } else if (options.clone && !cloneSchemaNameAllowed(parsedMongo.database, schema)) {
    return `Clone schema must start with ${parsedMongo.database}- so it stays on this group's data`;
  } else {
    return null;
  }
}
