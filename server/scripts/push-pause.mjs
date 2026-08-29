#!/usr/bin/env node
// Admin tool for push.ts's manual kill switch: pause/resume push notifications for
// every subscriber at once, independent of quiet hours and per-subscription
// notify_after. Never exposed in the app itself.
//
// Usage:
//   npm run push:pause -w server              # show current status
//   npm run push:pause -w server -- --pause
//   npm run push:pause -w server -- --resume

const args = process.argv.slice(2);
const port = process.env.PORT || 3001;
const base = `http://localhost:${port}`;

async function request(path, method = "GET") {
  const res = await fetch(`${base}${path}`, { method });
  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

if (args.includes("--pause")) {
  await request("/api/push/pause", "POST");
  console.log("Notifications paused for all subscribers.");
} else if (args.includes("--resume")) {
  await request("/api/push/resume", "POST");
  console.log("Notifications resumed for all subscribers.");
} else {
  const { paused } = await request("/api/push/pause-status");
  console.log(paused ? "Notifications are currently PAUSED." : "Notifications are currently active.");
  console.log("\nUsage: npm run push:pause -w server -- --pause | --resume");
}
