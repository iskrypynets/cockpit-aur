import React, { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  Spinner,
} from "@patternfly/react-core";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table";
import {
  AngleDownIcon,
  AngleUpIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ExclamationCircleIcon,
  PlusIcon,
} from "@patternfly/react-icons";
import { AurHistoryEntry, getAurHistoryLog } from "../api";
import { TimeAgo } from "./TimeAgo";
import { formatDuration } from "./ScheduleModal";

export interface AurHistoryCardProps {
  entries: AurHistoryEntry[];
  searchQuery?: string;
  isLoading?: boolean;
}

export const AurHistoryCard: React.FC<AurHistoryCardProps> = ({
  entries,
  searchQuery = "",
  isLoading = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<AurHistoryEntry | null>(null);
  const [activeLog, setActiveLog] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = normalizedQuery
    ? entries.filter(
        (e) =>
          e.packages.some((p) => p.toLowerCase().includes(normalizedQuery)) ||
          e.operation.toLowerCase().includes(normalizedQuery) ||
          (e.target && e.target.toLowerCase().includes(normalizedQuery))
      )
    : entries;

  const failedCount = entries.filter((e) => e.status === "failed").length;

  const handleOpenLog = async (entry: AurHistoryEntry) => {
    setSelectedEntry(entry);
    setActiveLog(null);
    setLogError(null);
    setCopied(false);
    setLogLoading(true);
    try {
      const res = await getAurHistoryLog(entry.id);
      setActiveLog(res.log || "(Log is empty)");
    } catch (err: unknown) {
      setLogError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogLoading(false);
    }
  };

  const handleCopyLog = () => {
    if (!activeLog) return;
    navigator.clipboard.writeText(activeLog).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCloseModal = () => {
    setSelectedEntry(null);
    setActiveLog(null);
    setLogError(null);
  };

  if (entries.length === 0 && !isLoading) {
    return null;
  }

  return (
    <>
      <Card className="pf-v6-u-mb-lg">
        <CardHeader
          actions={{
            actions: (
              <Button
                variant="plain"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-label={isExpanded ? "Collapse AUR operations history" : "Expand AUR operations history"}
              >
                {isExpanded ? <AngleUpIcon /> : <AngleDownIcon />}
              </Button>
            ),
            hasNoOffset: false,
          }}
        >
          <CardTitle>
            <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>AUR Operations History</span>
              </FlexItem>
              <FlexItem>
                <Badge isRead={failedCount === 0}>{filteredEntries.length}</Badge>
              </FlexItem>
              {failedCount > 0 && (
                <FlexItem>
                  <Label color="red" isCompact icon={<ExclamationCircleIcon />}>
                    {failedCount} failed
                  </Label>
                </FlexItem>
              )}
              {isLoading && (
                <FlexItem>
                  <Spinner size="sm" aria-label="Loading AUR history" />
                </FlexItem>
              )}
            </Flex>
          </CardTitle>
        </CardHeader>

        {isExpanded && (
          <CardBody>
            {filteredEntries.length === 0 ? (
              <p className="pf-v6-u-color-subtle">
                {searchQuery
                  ? `No AUR operations matching "${searchQuery}".`
                  : "No AUR operations recorded."}
              </p>
            ) : (
              <Table aria-label="AUR operations history table" variant="compact">
                <Thead>
                  <Tr>
                    <Th width={20}>Time</Th>
                    <Th width={15}>Operation</Th>
                    <Th width={30}>Packages</Th>
                    <Th width={15}>Status</Th>
                    <Th width={10}>Duration</Th>
                    <Th width={10} screenReaderText="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredEntries.map((entry) => {
                    const isSuccess = entry.status === "completed";
                    const isFailed = entry.status === "failed";
                    const isCancelled = entry.status === "cancelled";
                    const isInterrupted = entry.status === "interrupted";

                    return (
                      <Tr key={entry.id}>
                        <Td dataLabel="Time">
                          <span title={entry.timestamp}>
                            <TimeAgo timestamp={entry.timestamp} />
                          </span>
                        </Td>
                        <Td dataLabel="Operation">
                          {entry.operation === "install" ? (
                            <Label color="green" isCompact icon={<PlusIcon />}>
                              Install
                            </Label>
                          ) : (
                            <Label color="blue" isCompact icon={<ArrowUpIcon />}>
                              Upgrade
                            </Label>
                          )}
                        </Td>
                        <Td dataLabel="Packages">
                          <Flex spaceItems={{ default: "spaceItemsXs" }} flexWrap={{ default: "wrap" }}>
                            {entry.packages && entry.packages.length > 0 ? (
                              entry.packages.map((pkg) => (
                                <FlexItem key={pkg}>
                                  <Label color={isFailed ? "red" : "blue"} isCompact variant="outline">
                                    {pkg}
                                  </Label>
                                </FlexItem>
                              ))
                            ) : (
                              <span className="pf-v6-u-color-subtle">All packages</span>
                            )}
                          </Flex>
                          {isFailed && entry.error && (
                            <div
                              className="pf-v6-u-mt-xs pf-v6-u-color-danger pf-v6-u-font-size-xs"
                              style={{ wordBreak: "break-word" }}
                            >
                              {entry.error}
                            </div>
                          )}
                        </Td>
                        <Td dataLabel="Status">
                          {isSuccess && (
                            <Label color="green" icon={<CheckCircleIcon />}>
                              Success
                            </Label>
                          )}
                          {isFailed && (
                            <Label color="red" icon={<ExclamationCircleIcon />}>
                              Failed {entry.exit_code !== undefined && entry.exit_code !== null ? `(${entry.exit_code})` : ""}
                            </Label>
                          )}
                          {isCancelled && <Label color="orange">Cancelled</Label>}
                          {isInterrupted && <Label color="orange">Interrupted</Label>}
                        </Td>
                        <Td dataLabel="Duration">
                          {entry.duration_secs !== undefined && entry.duration_secs !== null
                            ? formatDuration(entry.duration_secs)
                            : "—"}
                        </Td>
                        <Td dataLabel="Actions" className="pf-v6-u-text-align-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<CodeIcon />}
                            onClick={() => void handleOpenLog(entry)}
                            aria-label={`View build log for ${entry.id}`}
                          >
                            Build log
                          </Button>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </CardBody>
        )}
      </Card>

      {selectedEntry && (
        <Modal
          variant={ModalVariant.large}
          isOpen={true}
          onClose={handleCloseModal}
          aria-labelledby="aur-history-modal-title"
        >
          <ModalHeader
            labelId="aur-history-modal-title"
            title={`AUR Build Log: ${selectedEntry.packages.join(", ") || selectedEntry.operation}`}
            description={`Operation: ${selectedEntry.operation} • Status: ${selectedEntry.status}${
              selectedEntry.exit_code !== undefined && selectedEntry.exit_code !== null
                ? ` (exit code ${selectedEntry.exit_code})`
                : ""
            } • Time: ${selectedEntry.timestamp}`}
          />
          <ModalBody>
            {logLoading ? (
              <Flex justifyContent={{ default: "justifyContentCenter" }} className="pf-v6-u-p-xl">
                <Spinner size="lg" aria-label="Loading build log..." />
              </Flex>
            ) : logError ? (
              <div className="pf-v6-u-color-danger pf-v6-u-p-md">
                Failed to load build log: {logError}
              </div>
            ) : (
              <pre
                style={{
                  maxHeight: "65vh",
                  overflowY: "auto",
                  backgroundColor: "#151515",
                  color: "#d4d4d4",
                  padding: "1rem",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  fontFamily: "var(--pf-t--global--font--family--mono, monospace)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {activeLog}
              </pre>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              icon={copied ? <CheckIcon /> : <CopyIcon />}
              onClick={handleCopyLog}
              isDisabled={!activeLog || logLoading}
            >
              {copied ? "Copied" : "Copy log"}
            </Button>
            <Button variant="link" onClick={handleCloseModal}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
};
