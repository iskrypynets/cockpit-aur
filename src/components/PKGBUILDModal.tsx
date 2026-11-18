import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Alert,
  Spinner,
} from "@patternfly/react-core";
import { getAurPkgbuild } from "../api";

export interface PKGBUILDModalProps {
  isOpen: boolean;
  packageName: string;
  onClose: () => void;
  onInstall?: () => void;
  isInstalling?: boolean;
}

export const PKGBUILDModal: React.FC<PKGBUILDModalProps> = ({
  isOpen,
  packageName,
  onClose,
  onInstall,
  isInstalling = false,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !packageName) return;

    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError(null);
      try {
        const res = await getAurPkgbuild(packageName);
        if (!active) return;
        setContent(res.pkgbuild);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      setContent(null);
      setError(null);
    };
  }, [isOpen, packageName]);

  return (
    <Modal
      variant={ModalVariant.large}
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="pkgbuild-modal-title"
    >
      <ModalHeader
        title={`Review PKGBUILD: ${packageName}`}
        labelId="pkgbuild-modal-title"
      />
      <ModalBody>
        <Alert
          variant="warning"
          isInline
          title="Security Review Required"
          style={{ marginBottom: "1rem" }}
        >
          Packages from the Arch User Repository (AUR) are user-contributed and run arbitrary
          shell commands during build. Always inspect the PKGBUILD below to verify download sources,
          integrity hashes, and build commands before installing.
        </Alert>

        {loading && (
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <Spinner aria-label="Loading PKGBUILD..." />
          </div>
        )}

        {error && (
          <Alert variant="danger" isInline title="Error loading PKGBUILD">
            {error}
          </Alert>
        )}

        {content && !loading && (
          <pre
            style={{
              maxHeight: "450px",
              overflowY: "auto",
              backgroundColor: "#1e1e1e",
              color: "#d4d4d4",
              padding: "1rem",
              borderRadius: "4px",
              fontSize: "0.875rem",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {content}
          </pre>
        )}
      </ModalBody>
      <ModalFooter>
        {onInstall && (
          <Button
            variant="primary"
            onClick={onInstall}
            isLoading={isInstalling}
            isDisabled={loading || isInstalling}
          >
            Install Package
          </Button>
        )}
        <Button variant="link" onClick={onClose} isDisabled={isInstalling}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};
