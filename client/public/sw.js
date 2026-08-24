// Static service worker — plain, dependency-free JS (not processed by Vite), served
// as-is from public/ the same way favicon.png etc. are. Root-scoped over the app.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Toby", body: event.data ? event.data.text() : "" };
  }

  const options = {
    body: data.body || "",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: data.tag || "toby-notification",
    // Collapses repeated renotifications for the same hungry episode into one visible
    // notification instead of stacking a new one every renotify interval.
    renotify: true,
    data: { url: "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title || "Toby", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      await clients.openWindow(targetUrl);
    })()
  );
});
