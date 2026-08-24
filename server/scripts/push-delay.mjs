#!/usr/bin/env node
// Admin tool for push.ts's per-subscription notify_after: hold one subscription back
// from receiving any notification until a given date/time — e.g. so a newly-subscribed
// device doesn't get buzzed immediately if Toby's already hungry. Never exposed in the
// app itself.
//
// Usage:
//   npm run push:delay -w server                              # list subscriptions
//   npm run push:delay -w server -- --index 0 --until "2026-08-30T14:00"

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    flags[args[i].slice(2)] = args[i + 1];
    i++;
  }
}

const port = process.env.PORT || 3001;
const base = `http://localhost:${port}`;

async function listSubscriptions() {
  const res = await fetch(`${base}/api/push/subscriptions`);
  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

const subs = await listSubscriptions();

if (flags.index === undefined) {
  if (subs.length === 0) {
    console.log("No subscriptions.");
  } else {
    subs.forEach((s, i) => {
      const shortEndpoint = s.endpoint.length > 60 ? s.endpoint.slice(0, 60) + "…" : s.endpoint;
      const notifyAfter = s.notifyAfter > 0 ? new Date(s.notifyAfter).toLocaleString() : "(none)";
      console.log(`[${i}] created ${new Date(s.createdAt).toLocaleString()} | delayed until ${notifyAfter}`);
      console.log(`    ${shortEndpoint}`);
    });
  }
  console.log('\nUsage: npm run push:delay -w server -- --index N --until "2026-08-30T14:00"');
  process.exit(0);
}

if (!flags.until) {
  console.error("--until is required alongside --index, e.g. --until \"2026-08-30T14:00\"");
  process.exit(1);
}

const index = Number(flags.index);
const sub = subs[index];
if (!sub) {
  console.error(`No subscription at index ${index} (have ${subs.length}). Run without --index to list them.`);
  process.exit(1);
}

const notifyAfter = new Date(flags.until).getTime();
if (Number.isNaN(notifyAfter)) {
  console.error(`Couldn't parse --until "${flags.until}" as a date.`);
  process.exit(1);
}

const res = await fetch(`${base}/api/push/set-notify-after`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ endpoint: sub.endpoint, notifyAfter }),
});

if (!res.ok) {
  console.error(`Request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`Subscription [${index}] held back until ${new Date(notifyAfter).toLocaleString()}.`);
