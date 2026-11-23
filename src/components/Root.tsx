import React, { Component, ErrorInfo, ReactNode } from "react";
import {
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Page,
  PageSection,
} from "@patternfly/react-core";
import { ExclamationCircleIcon } from "@patternfly/react-icons";
import { App } from "./App";
import { ErrorDetails } from "./ErrorDetails";
import { AnnouncerProvider } from "../contexts/AnnouncerContext";

interface RootBoundaryProps {
  children: ReactNode;
}

interface RootBoundaryState {
  error: Error | null;
}

/** Catches shell errors; reloads because a broken provider may fail again on remount. */
export class RootBoundary extends Component<RootBoundaryProps, RootBoundaryState> {
  state: RootBoundaryState = { error: null };
  private wakeListener?: () => void;

  static getDerivedStateFromError(error: Error): RootBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("cockpit-aur stopped working:", error, errorInfo);
  }

  componentDidMount(): void {
    this.wakeListener = () => {
      if (!document.hidden && this.state.error) {
        // Automatically reload when returning to a crashed or disconnected session
        window.location.reload();
      }
    };
    document.addEventListener("visibilitychange", this.wakeListener);
    window.addEventListener("focus", this.wakeListener);
  }

  componentWillUnmount(): void {
    if (this.wakeListener) {
      document.removeEventListener("visibilitychange", this.wakeListener);
      window.removeEventListener("focus", this.wakeListener);
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Page className="no-masthead-sidebar pf-m-no-sidebar">
        <PageSection hasBodyWrapper={false}>
          <EmptyState
            headingLevel="h1"
            icon={ExclamationCircleIcon}
            titleText="cockpit-pacman stopped working"
            status="danger"
          >
            <EmptyStateBody>
              Reload the page to start it again.
              <ErrorDetails details={error.message || String(error)} />
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }
}

export const Root: React.FC = () => (
  <RootBoundary>
    <AnnouncerProvider>
      <App />
    </AnnouncerProvider>
  </RootBoundary>
);
