import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ExpandableSection, Flex, FlexItem, Label, Tooltip } from "@patternfly/react-core";
import { CheckIcon, CopyIcon, DownloadIcon, ShareAltIcon } from "@patternfly/react-icons";
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

  // Parse: optional timestamp, initiator tag [INITIATOR], and message
  const match = line.match(/^(\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+)?(\[[A-Za-z0-9_\-]+\])\s*(.*)$/);

  let messageColor = "#e2e8f0";
  let fontWeight: string | number = "normal";

  // Error patterns: error:, failed:
  if (/(?:error|failed):/i.test(line)) {
    messageColor = "var(--pf-t--global--color--status--danger--default, #f87171)";
    fontWeight = 600;
  }
  // Warning patterns: warning:, [warn]
  else if (/(?:warning|\[warn(?:ing)?\]):?/i.test(line)) {
    messageColor = "var(--pf-t--global--color--status--warning--default, #fbbf24)";
  }
  // Success / install milestone patterns:
  else if (
    /(?:installed|upgraded|reinstalled|transaction completed|completed successfully|==>\s+finished)/i.test(line)
  ) {
    messageColor = "var(--pf-t--global--color--status--success--default, #4ade80)";
    fontWeight = 500;
  }
  // AUR helper steps: ==> or ->
  else if (/^\s*(?:==>|->)/.test(line) || (match && /^\s*(?:==>|->)/.test(match[3]))) {
    messageColor = "#38bdf8";
    fontWeight = 500;
  }
  // ALPM hook executions or running steps:
  else if (/(?:running|transaction started)/i.test(line)) {
    messageColor = "#94a3b8";
  }

  if (match) {
    const [, timestamp, initiator, msg] = match;
    let initiatorColor = "#60a5fa";
    const tagUpper = initiator.toUpperCase();
    if (tagUpper.includes("ALPM-SCRIPTLET")) {
      initiatorColor = "#34d399";
    } else if (tagUpper.includes("ALPM")) {
      initiatorColor = "#818cf8";
    } else if (tagUpper.includes("AUR") || tagUpper.includes("YAY") || tagUpper.includes("PARU")) {
      initiatorColor = "#c084fc";
    } else if (tagUpper.includes("COCKPIT")) {
      initiatorColor = "#38bdf8";
    } else if (tagUpper.includes("MIRROR")) {
      initiatorColor = "#2dd4bf";
    }

    return (
      <div key={index} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
        {timestamp && <span style={{ color: "#64748b", marginRight: "0.5rem" }}>{timestamp.trim()}</span>}
        <span style={{ color: initiatorColor, fontWeight: 700, marginRight: "0.5rem" }}>{initiator}</span>
        <span style={{ color: messageColor, fontWeight }}>{msg}</span>
      </div>
    );
  }

  return (
    <div key={index} style={{ color: messageColor, fontWeight, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
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

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copyLog = async () => {
    if (!log) return;
    let ok = false;
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(log);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok && typeof document !== "undefined") {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = log;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "-9999px";
        textarea.setAttribute("readonly", "");
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        ok = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareLog = async () => {
    if (!log || !canShare) return;
    try {
      await navigator.share({
        title: `${ariaLabel || "Cockpit AUR Log"}`,
        text: log,
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        copyLog();
      }
    }
  };

  const downloadLog = () => {
    if (!log) return;
    const blob = new Blob([log], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `cockpit-aur-log-${timestamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
          flexWrap: "wrap",
          gap: "0.5rem",
          minHeight: "40px",
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
            <>
              {canShare && (
                <Tooltip content="Share log via system share sheet">
                  <Button
                    variant="plain"
                    size="sm"
                    aria-label="Share log"
                    onClick={shareLog}
                    style={{ minHeight: "36px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                  >
                    <ShareAltIcon />
                    <span style={{ marginLeft: "0.35rem" }}>Share</span>
                  </Button>
                </Tooltip>
              )}
              <Tooltip content={copied ? "Copied!" : "Copy log to clipboard"}>
                <Button
                  variant="plain"
                  size="sm"
                  aria-label="Copy log"
                  onClick={copyLog}
                  style={{ minHeight: "36px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                >
                  {copied ? (
                    <CheckIcon style={{ color: "var(--pf-t--global--color--status--success--default)" }} />
                  ) : (
                    <CopyIcon />
                  )}
                  <span style={{ marginLeft: "0.35rem" }}>{copied ? "Copied" : "Copy"}</span>
                </Button>
              </Tooltip>
              <Tooltip content="Download log as .txt file">
                <Button
                  variant="plain"
                  size="sm"
                  aria-label="Download log"
                  onClick={downloadLog}
                  style={{ minHeight: "36px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                >
                  <DownloadIcon />
                  <span style={{ marginLeft: "0.35rem" }}>Download</span>
                </Button>
              </Tooltip>
            </>
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
          userSelect: "text",
          WebkitUserSelect: "text",
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
