import React from "react";
import { createRoot } from "react-dom/client";
import App, { AppErrorBoundary } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary><App /></AppErrorBoundary>
);
