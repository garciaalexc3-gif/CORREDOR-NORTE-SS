import React from "react";
import { createRoot } from "react-dom/client";

// Load starter CSS before App traverses authored component stylesheet imports.
import "./theme.css";
import "./styles.css";
import "./theme-picker.css";
import "./source-preview.css";
import "./content/dashboard/dashboard.css";
import "./content/report/report.css";
import "./print.css";
import "./theme-runtime.js";
import { App } from "./App.jsx";
import reviewedSnapshot from "./data.json";

const githubPages = globalThis.location?.hostname.endsWith(".github.io") ?? false;
const hosted = !githubPages && (
  (globalThis.location?.hostname.endsWith(".chatgpt.site") ?? false)
  || Boolean(globalThis.document?.querySelector('meta[name="data-app-sites-project"][content="corredor-norte"]'))
);

export function DataAppRuntime() {
  return <App hosted={hosted} staticDemo={!hosted} />;
}

if (typeof document !== "undefined") {
  document.title = reviewedSnapshot.title || "Data app";
  const root = document.getElementById("root");
  if (root) {
    createRoot(root).render(
      <React.StrictMode>
        <DataAppRuntime />
      </React.StrictMode>,
    );
  }
}
