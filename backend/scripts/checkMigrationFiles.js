import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(backendDirectory, "prisma", "migrations");
const migrationDirectories = readdirSync(migrationsDirectory)
  .filter((name) => statSync(path.join(migrationsDirectory, name)).isDirectory())
  .sort();
const invalidMigrationNames = migrationDirectories.filter((name) =>
  name !== "0_init" && !/^\d{14}_[a-zA-Z0-9_]+$/.test(name)
);

if (invalidMigrationNames.length) {
  throw new Error(`Invalid Prisma migration directory names: ${invalidMigrationNames.join(", ")}`);
}

if (!migrationDirectories.includes("0_init")) {
  throw new Error("The checked-in Prisma migration baseline 0_init is missing.");
}

const migrationLock = path.join(migrationsDirectory, "migration_lock.toml");
if (!statSync(migrationLock).isFile() || !/^\s*provider\s*=\s*"mysql"\s*$/m.test(
  readFileSync(migrationLock, "utf8")
)) {
  throw new Error("Prisma migration lock must declare the MySQL provider.");
}

for (const migrationName of migrationDirectories) {
  const migrationFile = path.join(migrationsDirectory, migrationName, "migration.sql");
  try {
    statSync(migrationFile);
  } catch {
    throw new Error(`Migration directory is missing migration.sql: ${migrationName}`);
  }
}

console.log(`Checked ${migrationDirectories.length} Prisma migration directories.`);
