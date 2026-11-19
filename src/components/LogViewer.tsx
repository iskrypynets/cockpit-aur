import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ExpandableSection, Flex, FlexItem, Label, Tooltip } from "@patternfly/react-core";
import { CheckIcon, CopyIcon } from "@patternfly/react-icons";
import { LOG_CONTAINER_HEIGHT } from "../constants";

interface LogViewerProps {
  log: string;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

const FOLLOW_THRESHOLD_PX = 24;

export function renderLogLine(line: string, index: number): React.ReactNode {
  if (!line) {
    return <div key={index} style={{ minHeight: "1.25em" }}>&nbsp;</div>;
  }

  let color = "#e2e8f0";
  let fontWeight: string | number = "normal";

  // Error patterns: error:, [error], [ALPM] error:
  if (/^(?:\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+)?(?:\[ALPM\]\s+)?(?:error|failed):|^\[error\]/i.test(line)) {
    color = "var(--pf-t--global--color--status--danger--default, #f87171)";
    fontWeight = 600;
  }
  // Warning patterns: warning:, [warn], [ALPM] warning:
  else if (/^(?:\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+)?(?:\[ALPM\]\s+)?warning:|^\[warn(?:ing)?\]/i.test(line)) {
    color = "var(--pf-t--global--color--status--warning--default, #fbbf24)";
  }
  // Success / install milestone patterns:
  else if (
    /(?:\[ALPM\]\s+(?:installed|upgraded|reinstalled|transaction completed))|(?:completed successfully)|(?:==>\s+finished)/i.test(line)
  ) {
    color = "var(--pf-t--global--color--status--success--default, #4ade80)";
    fontWeight = 500;
  }
  // Initiator and pacman / cockpit lines:
  else if (/^\[(?:COCKPIT-AUR|COCKPIT-PACMAN|PACMAN)\]/i.test(line)) {
    color = "var(--pf-t--global--color--brand--default, #60a5fa)";
    fontWeight = 600;
  }
  // AUR helper steps: ==> or ->
  else if (/^\s*(?:==>|->)/.test(line)) {
    color = "#38bdf8";
    fontWeight = 500;
  }
  // ALPM hook executions:
  else if (/^\[ALPM\]\s+(?:running|transaction started)/i.test(line)) {
    color = "#94a3b8";
  }

  return (
    <div key={index} style={{ color, fontWeight, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {line}
    </div>
  );
}

/**
 * Scrollable log output with syntax coloring, terminal controls, and auto-scroll.
 * It follows new lines only while scrolled to within FOLLOW_THRESHOLD_PX of the bottom;
 * scrolling up pauses following.
 */
export const LogViewer: React.FC<LogViewerProps> = ({
  log,
  placeholder,
  className,
  "aria-label": ariaLabel = "Output",
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [copied, setCopied] = useState(false);

  const setFollow = (value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  };

  useLayoutEffect(() => {
    if (ref.current && followingRef.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [log]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
    if (atBottom !== followingRef.current) setFollow(atBottom);
  };

  const jumpToLatest = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollow(true);
    el.focus();
  };

  const copyLog = () => {
    if (!log) return;
    window.navigator.clipboard.writeText(log).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // fallback
    });
  };

  const lines = useMemo(() => {
    if (!log) return null;
    return log.split("\n");
  }, [log]);

  const lineCount = lines ? (lines[lines.length - 1] === "" ? lines.length - 1 : lines.length) : 0;

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {/* Terminal Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.35rem 0.75rem",
          background: "var(--pf-t--global--background--color--secondary--default, #1f2937)",
          borderTopLeftRadius: "6px",
          borderTopRightRadius: "6px",
          border: "1px solid var(--pf-t--global--border--color--default, #374151)",
          borderBottom: "none",
          fontSize: "0.75rem",
        }}
      >
        <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsSm" }}>
          <FlexItem>
            <span style={{ fontWeight: 600, color: "var(--pf-t--global--text--color--regular)" }}>
              {ariaLabel}
            </span>
          </FlexItem>
          {lineCount > 0 && (
            <FlexItem>
              <Badge isRead>{lineCount} {lineCount === 1 ? "line" : "lines"}</Badge>
            </FlexItem>
          )}
          <FlexItem>
            {following ? (
              <Label color="green" isCompact>Live</Label>
            ) : (
              <Label color="orange" isCompact>Paused</Label>
            )}
          </FlexItem>
        </Flex>

        <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsSm" }}>
          {log ? (
            <Tooltip content={copied ? "Copied!" : "Copy log to clipboard"}>
              <Button
                variant="plain"
                size="sm"
                aria-label="Copy log"
                onClick={copyLog}
                style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
              >
                {copied ? (
                  <CheckIcon style={{ color: "var(--pf-t--global--color--status--success--default)" }} />
                ) : (
                  <CopyIcon />
                )}
                <span style={{ marginLeft: "0.35rem" }}>{copied ? "Copied" : "Copy"}</span>
              </Button>
            </Tooltip>
          ) : null}
        </Flex>
      </div>

      {/* Terminal Log Box */}
      <div
        ref={ref}
        style={{
          maxHeight: LOG_CONTAINER_HEIGHT,
          overflow: "auto",
          background: "#0d1117",
          border: "1px solid var(--pf-t--global--border--color--default, #374151)",
          borderBottomLeftRadius: "6px",
          borderBottomRightRadius: "6px",
          padding: "0.75rem 1rem",
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: "0.8125rem",
          lineHeight: 1.5,
          position: "relative",
        }}
        onScroll={handleScroll}
        tabIndex={0}
        role="log"
        aria-live="off"
        aria-label={ariaLabel}
      >
        {lines && lines.length > 0 ? (
          lines.map((line, idx) => renderLogLine(line, idx))
        ) : (
          <span style={{ color: "#64748b" }}>{placeholder || "No output recorded"}</span>
        )}

        {!following && (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: "0.5rem",
            }}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={jumpToLatest}
              style={{
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                background: "var(--pf-t--global--background--color--primary--default)",
              }}
            >
              Jump to latest
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

interface ExpandableLogViewerProps extends Omit<LogViewerProps, "className"> {
  isExpanded: boolean;
  onToggle: (expanded: boolean) => void;
  className?: string;
}

/** LogViewer behind a Show/Hide details toggle. */
export const ExpandableLogViewer: React.FC<ExpandableLogViewerProps> = ({
  isExpanded,
  onToggle,
  className,
  ...logProps
}) => (
  <ExpandableSection
    toggleText={isExpanded ? "Hide details" : "Show details"}
    onToggle={(_event, expanded) => onToggle(expanded)}
    isExpanded={isExpanded}
    className={className}
  >
    <LogViewer {...logProps} />
  </ExpandableSection>
);
