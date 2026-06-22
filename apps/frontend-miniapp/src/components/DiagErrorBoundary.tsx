/**
 * DIAGNOSTIC ERROR BOUNDARY — temporary, remove after investigation.
 *
 * Catches React render errors, logs them, and shows a simple fallback UI.
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import { diagLog } from "../lib/diagnosticLogger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class DiagErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    diagLog("REACT_ERROR_BOUNDARY", error.message, {
      stack: error.stack?.slice(0, 800) ?? "",
      componentStack: info.componentStack?.slice(0, 500) ?? "",
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100dvh",
            padding: "24px",
            textAlign: "center",
            fontFamily: "sans-serif",
            color: "#333",
          }}
        >
          <p style={{ fontSize: "18px", marginBottom: "8px" }}>
            Что-то пошло не так 😕
          </p>
          <p style={{ fontSize: "13px", color: "#888" }}>
            Попробуйте перезапустить приложение
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
