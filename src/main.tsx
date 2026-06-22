import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SecurityProvider } from "./contexts/SecurityContext";
import "./fonts.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <SecurityProvider>
        <App />
      </SecurityProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
