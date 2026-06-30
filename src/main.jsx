import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// ── Service worker cleanup ──────────────────────────────────
// Earlier versions registered a service worker via vite-plugin-pwa.
// That plugin has been removed, but browsers keep using the old
// service worker to serve cached (stale) files until it's explicitly
// unregistered. This forces a one-time cleanup so users always get
// the latest deployed code instead of a frozen snapshot.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((reg) => reg.unregister());
  });
  if ("caches" in window) {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
