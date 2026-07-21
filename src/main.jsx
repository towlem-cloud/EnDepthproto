import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { installCoachIdentityBridge } from "./installCoachIdentityBridge.js";
import { installCsvSafetyBridge } from "./installCsvSafetyBridge.js";

installCoachIdentityBridge();
installCsvSafetyBridge();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
