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

const ANSI_PATTERN = /\x1b\[([0-9;]*)m/g;

export interface StyledSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const ANSI_FG_COLORS: Record<number, string> = {
  30: "#1e293b", // black
  31: "#f87171", // red
  32: "#4ade80", // green
  33: "#fbbf24", // yellow
  34: "#60a5fa", // blue
  35: "#c084fc", // magenta
  36: "#38bdf8", // cyan
  37: "#f1f5f9", // white
  90: "#94a3b8", // bright black / gray
  91: "#fca5a5", // bright red
  92: "#86efac", // bright green
  93: "#fde047", // bright yellow
  94: "#93c5fd", // bright blue
  95: "#e879f9", // bright magenta
  96: "#67e8f9", // bright cyan
  97: "#ffffff", // bright white
};

export function parseAnsiSpans(line: string): StyledSpan[] {
  const spans: StyledSpan[] = [];
  let currentColor: string | undefined;
  let isBold = false;
  let isDim = false;
  let isItalic = false;
  let isUnderline = false;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(ANSI_PATTERN);

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      const text = line.slice(lastIndex, match.index);
      if (text) {
        spans.push({
          text,
          color: currentColor,
          bold: isBold,
          dim: isDim,
          italic: isItalic,
          underline: isUnderline,
        });
      }
    }

    const codeStr = match[1];
    if (!codeStr || codeStr === "0") {
      currentColor = undefined;
      isBold = false;
      isDim = false;
      isItalic = false;
      isUnderline = false;
    } else {
      const codes = codeStr.split(";").map((c) => parseInt(c, 10));
      for (const code of codes) {
        if (code === 0) {
          currentColor = undefined;
          isBold = false;
          isDim = false;
          isItalic = false;
          isUnderline = false;
        } else if (code === 1) {
          isBold = true;
        } else if (code === 2) {
          isDim = true;
        } else if (code === 3) {
          isItalic = true;
        } else if (code === 4) {
          isUnderline = true;
        } else if (code === 22) {
          isBold = false;
          isDim = false;
        } else if (code === 23) {
          isItalic = false;
        } else if (code === 24) {
          isUnderline = false;
        } else if (code === 39) {
          currentColor = undefined;
        } else if (ANSI_FG_COLORS[code]) {
          currentColor = ANSI_FG_COLORS[code];
        }
      }
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    const text = line.slice(lastIndex);
    if (text) {
      spans.push({
        text,
        color: currentColor,
        bold: isBold,
        dim: isDim,
        italic: isItalic,
        underline: isUnderline,
      });
    }
  }

  return spans;
}

function renderSemanticLineText(text: string): React.ReactNode {
  // Error patterns:
  if (
    /(?:==>\s+ERROR:|->\s+error|error:|failed:|undefined reference to|collect2:\s+error:|make\[\d+\]:\s+\*\*\*.*Error \d+)/i.test(
      text
    )
  ) {
    return (
      <span style={{ color: "var(--pf-t--global--color--status--danger--default, #f87171)", fontWeight: 600 }}>
        {text}
      </span>
    );
  }

  // Warning patterns:
  if (/(?:==>\s+WARNING:|warning:|\[warn(?:ing)?\])/i.test(text)) {
    return (
      <span style={{ color: "var(--pf-t--global--color--status--warning--default, #fbbf24)", fontWeight: 600 }}>
        {text}
      </span>
    );
  }

  // AUR / Makepkg step: ==>
  if (/^\s*==>/.test(text)) {
    const arrowMatch = text.match(/^(\s*==>)\s*(.*)$/);
    if (arrowMatch) {
      return (
        <span>
          <span style={{ color: "#38bdf8", fontWeight: 700 }}>{arrowMatch[1]} </span>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{arrowMatch[2]}</span>
        </span>
      );
    }
  }

  // Substep: ->
  if (/^\s*->/.test(text)) {
    const arrowMatch = text.match(/^(\s*->)\s*(.*)$/);
    if (arrowMatch) {
      return (
        <span>
          <span style={{ color: "#60a5fa", fontWeight: 700 }}>{arrowMatch[1]} </span>
          <span style={{ color: "#cbd5e1" }}>{arrowMatch[2]}</span>
        </span>
      );
    }
  }

  // Header: ::
  if (/^\s*::/.test(text)) {
    const headerMatch = text.match(/^(\s*::)\s*(.*)$/);
    if (headerMatch) {
      return (
        <span>
          <span style={{ color: "#c084fc", fontWeight: 700 }}>{headerMatch[1]} </span>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{headerMatch[2]}</span>
        </span>
      );
    }
  }

  // Passed / Skipped / Failed validation lines (e.g. "kgamma-6.7.5.tar.xz ... Passed")
  if (/\s+\.\.\.\s+(Passed|Skipped|Failed)$/i.test(text)) {
    const vMatch = text.match(/^(.*?\s+\.\.\.\s+)(Passed|Skipped|Failed)$/i);
    if (vMatch) {
      const status = vMatch[2];
      const statusColor =
        status.toLowerCase() === "passed"
          ? "#4ade80"
          : status.toLowerCase() === "failed"
          ? "#f87171"
          : "#94a3b8";
      return (
        <span>
          <span style={{ color: "#e2e8f0" }}>{vMatch[1]}</span>
          <span style={{ color: statusColor, fontWeight: 700 }}>{status}</span>
        </span>
      );
    }
  }

  // Compilation progress: [ 82%] Building CXX object ...
  if (/^\s*\[\s*\d+%\s*\]/.test(text)) {
    const pMatch = text.match(/^(\s*\[\s*\d+%\s*\])\s*(.*)$/);
    if (pMatch) {
      return (
        <span>
          <span style={{ color: "#38bdf8", fontWeight: 700 }}>{pMatch[1]} </span>
          <span style={{ color: "#94a3b8" }}>{pMatch[2]}</span>
        </span>
      );
    }
  }

  // General success milestones:
  if (
    /(?:installed|upgraded|reinstalled|transaction completed|completed successfully|finished)/i.test(
      text
    )
  ) {
    return (
      <span style={{ color: "var(--pf-t--global--color--status--success--default, #4ade80)", fontWeight: 500 }}>
        {text}
      </span>
    );
  }

  // Compiler chatter (CC, CXX, CCLD, make):
  if (/^\s*(?:CC|CXX|CCLD|AR|GEN|LD)\s+/i.test(text) || /^\s*make\[\d+\]:/.test(text)) {
    return <span style={{ color: "#64748b" }}>{text}</span>;
  }

  return <span style={{ color: "#e2e8f0" }}>{text}</span>;
}

export function renderLogLine(line: string, index: number): React.ReactNode {
  if (!line) {
    return <div key={index} style={{ minHeight: "1.25em" }}>&nbsp;</div>;
  }

  // If the line contains ANSI escape codes, render with exact ANSI styles
  if (line.includes("\x1b[")) {
    const spans = parseAnsiSpans(line);
    return (
      <div key={index} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
        {spans.map((span, sIdx) => (
          <span
            key={sIdx}
            style={{
              color: span.color ?? "#e2e8f0",
              fontWeight: span.bold ? 700 : undefined,
              opacity: span.dim ? 0.7 : undefined,
              fontStyle: span.italic ? "italic" : undefined,
              textDecoration: span.underline ? "underline" : undefined,
            }}
          >
            {span.text}
          </span>
        ))}
      </div>
    );
  }

  // Check for timestamp and initiator tag [TAG]
  const match = line.match(/^(\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+)?(\[[A-Za-z0-9_-]+\])\s*(.*)$/);
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
        {renderSemanticLineText(msg)}
      </div>
    );
  }

  return (
    <div key={index} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
      {renderSemanticLineText(line)}
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
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") {
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
    const rawLines = log.split(/\r?\n|\r/);
    const result: string[] = [];

    // Helper to detect download / fetch / compile progress lines (curl, git, pacman progress meters)
    const isProgressLine = (text: string) => {
      return (
        /\[AUR\]\s*(?:\d+\s+[\d.]+[KkMmGg]?|\s*%\s*Total|\s*Dload\s+Upload|(?:Receiving|Resolving|Compressing|Writing)\s+objects:\s*\d+%)/i.test(text) ||
        /^\s*(?:\d+\s+[\d.]+[KkMmGg]?|\s*%\s*Total|\s*Dload\s+Upload|(?:Receiving|Resolving|Compressing|Writing)\s+objects:\s*\d+%)/i.test(text)
      );
    };

    for (const raw of rawLines) {
      const clean = raw.trimEnd();
      if (!clean) continue;

      if (isProgressLine(clean) && result.length > 0 && isProgressLine(result[result.length - 1])) {
        // Overwrite previous progress line in place so download progress updates cleanly on a single line
        result[result.length - 1] = clean;
      } else {
        result.push(clean);
      }
    }

    return result;
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
