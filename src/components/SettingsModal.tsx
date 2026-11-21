import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  Stack,
  StackItem,
} from "@patternfly/react-core";
import { clearAurCache, getSettings, setSettings, type SettingsResponse } from "../api";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: () => void;
}

const CACHE_TTL_OPTIONS = [
  { value: 600, label: "10 minutes" },
  { value: 1800, label: "30 minutes (Default)" },
  { value: 3600, label: "1 hour" },
  { value: 7200, label: "2 hours" },
  { value: 14400, label: "4 hours" },
  { value: 86400, label: "24 hours" },
];

const UPGRADE_TIMEOUT_OPTIONS = [
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour (Default)" },
  { value: 7200, label: "2 hours" },
  { value: 10800, label: "3 hours" },
  { value: 21600, label: "6 hours" },
];

const RPC_TIMEOUT_OPTIONS = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds (Default)" },
  { value: 60, label: "60 seconds" },
  { value: 120, label: "120 seconds" },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSettingsSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheClearMsg, setCacheClearMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [securityAdvisories, setSecurityAdvisories] = useState(true);
  const [cacheTtl, setCacheTtl] = useState(1800);
  const [upgradeTimeout, setUpgradeTimeout] = useState(3600);
  const [rpcTimeout, setRpcTimeout] = useState(30);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setCacheClearMsg(null);

    getSettings()
      .then((settings: SettingsResponse) => {
        if (settings.security_advisories !== null && settings.security_advisories !== undefined) {
          setSecurityAdvisories(settings.security_advisories);
        }
        if (settings.aur_cache_ttl_secs) setCacheTtl(settings.aur_cache_ttl_secs);
        if (settings.aur_upgrade_timeout_secs) setUpgradeTimeout(settings.aur_upgrade_timeout_secs);
        if (settings.aur_rpc_timeout_secs) setRpcTimeout(settings.aur_rpc_timeout_secs);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await setSettings({
        security_advisories: securityAdvisories,
        aur_cache_ttl_secs: cacheTtl,
        aur_upgrade_timeout_secs: upgradeTimeout,
        aur_rpc_timeout_secs: rpcTimeout,
      });
      onSettingsSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    setCacheClearMsg(null);
    try {
      const res = await clearAurCache();
      setCacheClearMsg(res.message || "AUR cache cleared successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <Modal
      variant={ModalVariant.medium}
      isOpen={isOpen}
      onClose={onClose}
      aria-label="AUR and System Settings"
    >
      <ModalHeader title="AUR & Timeout Settings" />
      <ModalBody>
        <Stack hasGutter>
          {error && (
            <StackItem>
              <Alert variant="danger" isInline title={error} />
            </StackItem>
          )}

          {cacheClearMsg && (
            <StackItem>
              <Alert variant="success" isInline title={cacheClearMsg} />
            </StackItem>
          )}

          <StackItem>
            <Form>
              <FormGroup
                label="AUR Server Cache TTL (Time to Live)"
                fieldId="settings-cache-ttl"
              >
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <FormSelect
                    id="settings-cache-ttl"
                    value={cacheTtl}
                    onChange={(_event, val) => setCacheTtl(Number(val))}
                    isDisabled={loading || saving}
                    style={{ maxWidth: "250px" }}
                  >
                    {CACHE_TTL_OPTIONS.map((opt) => (
                      <FormSelectOption key={opt.value} value={opt.value} label={opt.label} />
                    ))}
                  </FormSelect>
                  <Button
                    variant="secondary"
                    onClick={handleClearCache}
                    isLoading={clearingCache}
                    isDisabled={loading || saving || clearingCache}
                  >
                    Clear AUR Cache
                  </Button>
                </div>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "4px" }}>
                  Keeps cached metadata for AUR packages to reduce RPC queries to aur.archlinux.org and avoid anti-bot/rate limits.
                </div>
              </FormGroup>

              <FormGroup
                label="AUR Build & Upgrade Timeout"
                fieldId="settings-upgrade-timeout"
              >
                <FormSelect
                  id="settings-upgrade-timeout"
                  value={upgradeTimeout}
                  onChange={(_event, val) => setUpgradeTimeout(Number(val))}
                  isDisabled={loading || saving}
                  style={{ maxWidth: "250px" }}
                >
                  {UPGRADE_TIMEOUT_OPTIONS.map((opt) => (
                    <FormSelectOption key={opt.value} value={opt.value} label={opt.label} />
                  ))}
                </FormSelect>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "4px" }}>
                  Maximum duration allowed for building and installing AUR packages (useful for large packages like browsers or IDEs).
                </div>
              </FormGroup>

              <FormGroup
                label="AUR RPC Network Request Timeout"
                fieldId="settings-rpc-timeout"
              >
                <FormSelect
                  id="settings-rpc-timeout"
                  value={rpcTimeout}
                  onChange={(_event, val) => setRpcTimeout(Number(val))}
                  isDisabled={loading || saving}
                  style={{ maxWidth: "250px" }}
                >
                  {RPC_TIMEOUT_OPTIONS.map((opt) => (
                    <FormSelectOption key={opt.value} value={opt.value} label={opt.label} />
                  ))}
                </FormSelect>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "4px" }}>
                  Timeout for connecting and querying the AUR RPC server.
                </div>
              </FormGroup>

              <FormGroup fieldId="settings-security-advisories">
                <Checkbox
                  id="settings-security-advisories"
                  label="Check security advisories from Arch Security Tracker"
                  isChecked={securityAdvisories}
                  onChange={(_event, checked) => setSecurityAdvisories(checked)}
                  isDisabled={loading || saving}
                />
              </FormGroup>
            </Form>
          </StackItem>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button
          key="save"
          variant="primary"
          onClick={handleSave}
          isLoading={saving}
          isDisabled={loading || saving}
        >
          Save Settings
        </Button>
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={saving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};
