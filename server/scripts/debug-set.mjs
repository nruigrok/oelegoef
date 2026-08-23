#!/usr/bin/env node
// Testing helper: forces hunger/weight/spots/bowl state on the running server.
// Usage: npm run debug -w server -- --hunger 80 --weight 20 [--catSpot couch] [--foodSpot table] [--foodFull false]

const args = process.argv.slice(2);
const patch = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const value = args[i + 1];
  i++;

  if (key === "hunger" || key === "weight") patch[key] = Number(value);
  else if (key === "foodFull") patch[key] = value !== "false";
  else if (key === "foodSpot") patch[key] = value === "null" ? null : value;
  else if (key === "catSpot") patch[key] = value;
  else {
    console.error(`Unknown flag --${key}`);
    process.exit(1);
  }
}

if (Object.keys(patch).length === 0) {
  console.error(
    "Usage: npm run debug -w server -- --hunger 80 --weight 20 [--catSpot couch] [--foodSpot table] [--foodFull false]"
  );
  process.exit(1);
}

const port = process.env.PORT || 3001;
const res = await fetch(`http://localhost:${port}/api/debug`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(patch),
});

if (!res.ok) {
  console.error(`Request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(await res.json());
