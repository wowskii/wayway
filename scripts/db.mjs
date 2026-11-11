// Runs Supabase CLI database commands against the cloud project, using SUPABASE_DB_URL from .env.local.
//   npm run db:push   -> applies new files from supabase/migrations to the cloud database
//   npm run db:types  -> regenerates src/lib/db/database.types.ts from the cloud database
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("Add SUPABASE_DB_URL (Session pooler connection string) to .env.local");

const cmd = process.argv[2];
// Call the CLI's JS entry with the current Node directly (no shell: arguments are passed as-is,
// so special characters in the password cannot break the command).
const CLI = "node_modules/supabase/dist/supabase.js";
const run = (args, capture = false) =>
  spawnSync(process.execPath, [CLI, ...args], {
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

if (cmd === "push") {
  const r = run(["db", "push", "--db-url", dbUrl]);
  process.exit(r.status ?? 1);
} else if (cmd === "types") {
  const r = run(["gen", "types", "typescript", "--db-url", dbUrl, "--schema", "public"], true);
  if (r.status !== 0) process.exit(r.status ?? 1);
  mkdirSync("src/lib/db", { recursive: true });
  writeFileSync("src/lib/db/database.types.ts", r.stdout);
  console.log("Wrote src/lib/db/database.types.ts");
} else {
  console.error("Usage: node scripts/db.mjs push|types");
  process.exit(1);
}
