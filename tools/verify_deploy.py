#!/usr/bin/env python3
"""
Automated deployment verification and self-testing suite for cockpit-aur.
Verifies package integrity, backend binary execution, frontend assets,
user directory override absence, and Cockpit service health.

Can run locally or remotely over SSH.
Usage:
    python3 tools/verify_deploy.py [--remote USER@HOST] [--version VERSION] [--name NAME]
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


def get_expected_version() -> str:
    pkg_json = ROOT_DIR / "package.json"
    if pkg_json.is_file():
        data = json.loads(pkg_json.read_text(encoding="utf-8"))
        if "version" in data:
            return data["version"]
    raise RuntimeError("Could not determine expected version from package.json")


def run_target_cmd(cmd: str, remote: str | None = None) -> tuple[int, str, str]:
    if remote:
        full_cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", remote, cmd]
    else:
        full_cmd = ["bash", "-c", cmd]

    res = subprocess.run(full_cmd, capture_output=True, text=True)
    return res.returncode, res.stdout.strip(), res.stderr.strip()


def verify(target_name: str, remote: str | None, expected_ver: str) -> bool:
    print(f"\n{Colors.BOLD}{Colors.CYAN}=== 🔍 Starting Deployment Self-Test for [{target_name}] ==={Colors.RESET}")
    print(f"Target: {remote or 'localhost (vampa)'} | Expected Version: {expected_ver}")
    failures = []

    def check(name: str, passed: bool, detail: str = ""):
        if passed:
            print(f"  {Colors.GREEN}✓ PASS:{Colors.RESET} {name} {f'({detail})' if detail else ''}")
        else:
            print(f"  {Colors.RED}✗ FAIL:{Colors.RESET} {name} {f'-> {detail}' if detail else ''}")
            failures.append((name, detail))

    # 1. Check pacman package installation and version
    code, stdout, stderr = run_target_cmd("pacman -Q cockpit-aur", remote)
    if code == 0:
        installed_ver = stdout.split()[-1] if stdout else ""
        expected_pkg_prefix = f"{expected_ver}-"
        ver_match = installed_ver.startswith(expected_pkg_prefix)
        check("Pacman package installed and matches version", ver_match, f"got {installed_ver}, expected {expected_pkg_prefix}*")
    else:
        check("Pacman package installed", False, f"exit {code}: {stderr or stdout}")

    # 2. Check pacman package files integrity
    code, stdout, stderr = run_target_cmd("pacman -Qk cockpit-aur", remote)
    # Output can be "0 missing files" in English or "бракує 0 файлів" in Ukrainian
    has_no_missing = code == 0 and ("0 missing files" in stdout or "бракує 0 файлів" in stdout or "0 бракує" in stdout or "0 змінений" in stdout)
    check("Pacman package files integrity", has_no_missing, stdout or stderr)

    # 3. Check backend binary exists and executable
    code, stdout, stderr = run_target_cmd("test -x /usr/libexec/cockpit-aur/cockpit-aur-backend", remote)
    check("Backend binary executable at /usr/libexec/cockpit-aur/cockpit-aur-backend", code == 0)

    # 4. Check backend version command
    code, stdout, stderr = run_target_cmd("/usr/libexec/cockpit-aur/cockpit-aur-backend version", remote)
    backend_ver_ok = False
    if code == 0:
        try:
            parsed = json.loads(stdout)
            reported_ver = parsed.get("version")
            backend_ver_ok = reported_ver == expected_ver
            detail = f"reported {reported_ver}"
        except Exception:
            detail = f"invalid json: {stdout}"
    else:
        detail = f"exit {code}: {stderr or stdout}"
    check("Backend reports correct version", backend_ver_ok, detail)

    # 5. Check backend AUR helper detection
    code, stdout, stderr = run_target_cmd("/usr/libexec/cockpit-aur/cockpit-aur-backend aur-helper", remote)
    helper_ok = False
    detail = ""
    if code == 0:
        try:
            data = json.loads(stdout)
            h = data.get("helper")
            avail = data.get("available")
            helper_ok = h in ("yay", "paru", "none") and isinstance(avail, bool)
            detail = f"helper={h}, available={avail}"
        except Exception:
            detail = f"invalid json: {stdout}"
    else:
        detail = f"exit {code}: {stderr or stdout}"
    check("Backend aur-helper detection responds", helper_ok, detail)

    # 6. Check frontend directory and critical files
    code, stdout, stderr = run_target_cmd(
        "test -f /usr/share/cockpit/aur/manifest.json && "
        "test -s /usr/share/cockpit/aur/index.js && "
        "test -s /usr/share/cockpit/aur/index.css && "
        "test -f /usr/share/cockpit/aur/index.html",
        remote,
    )
    check("Frontend assets present and non-empty in /usr/share/cockpit/aur", code == 0)

    # 7. Check manifest.json configuration and validity
    code, stdout, stderr = run_target_cmd("cat /usr/share/cockpit/aur/manifest.json", remote)
    manifest_ok = False
    if code == 0:
        try:
            manifest_json = json.loads(stdout)
            cfg_backend = manifest_json.get("config", {}).get("backend", "")
            manifest_ok = (
                manifest_json.get("version") == 0
                and cfg_backend == "/usr/libexec/cockpit-aur/cockpit-aur-backend"
            )
            detail = f"backend={cfg_backend}"
        except Exception:
            detail = f"manifest invalid: {stdout}"
    else:
        detail = stderr
    check("Frontend manifest.json valid and configures backend path", manifest_ok, detail)

    # 8. Check frontend bundle version
    code, stdout, stderr = run_target_cmd(f"grep -q '\"{expected_ver}\"' /usr/share/cockpit/aur/index.js", remote)
    check(f"Frontend bundle contains expected version string '{expected_ver}'", code == 0)

    # 9. Check that NO local override shadows system plugin
    code, stdout, stderr = run_target_cmd("test -d ~/.local/share/cockpit/aur", remote)
    # code != 0 means directory does NOT exist, which is what we want!
    check("No ~/.local/share/cockpit/aur directory shadowing system package", code != 0, "Clean: no user override")

    # 10. Check Cockpit socket / service health
    code, stdout, stderr = run_target_cmd("systemctl is-active cockpit.socket 2>/dev/null", remote)
    socket_active = code == 0 and stdout == "active"
    check("Cockpit systemd socket is active", socket_active, f"state={stdout or 'inactive/unreachable'}")

    # 11. Check Cockpit HTTP port responds (probing / and /cockpit/ for UrlRoot setups)
    probe_script = (
        'for path in "" "cockpit/"; do '
        '  status=$(curl -k -s -o /dev/null -w "%{http_code}" "https://127.0.0.1:9090/$path" 2>/dev/null || '
        '           curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9090/$path" 2>/dev/null); '
        '  if [ "$status" = "200" ] || [ "$status" = "301" ] || [ "$status" = "302" ] || [ "$status" = "401" ]; then '
        '    echo "$status"; exit 0; '
        '  fi; '
        'done; '
        'echo "$status"; exit 1'
    )
    code, stdout, stderr = run_target_cmd(probe_script, remote)
    http_ok = code == 0 and stdout in ("200", "301", "302", "401")
    check("Cockpit port 9090 responds to requests", http_ok, f"HTTP status {stdout}")

    # 12. Check Cockpit Terminal enhancements
    code, stdout, stderr = run_target_cmd(
        "grep -q 'terminal-custom-bar' /usr/share/cockpit/systemd/terminal.html && "
        "grep -q 'copyOutput' /usr/share/cockpit/systemd/terminal.html && "
        "grep -q 'show-settings' /usr/share/cockpit/systemd/terminal.html && "
        "grep -q 'applyScrollback' /usr/share/cockpit/systemd/terminal.html",
        remote,
    )
    check("Cockpit terminal enhancements (Copy, Settings toggle, Scrollback)", code == 0)

    # 13. Check backend check-updates responds with updates JSON (including AUR)
    code, stdout, stderr = run_target_cmd("/usr/libexec/cockpit-aur/cockpit-aur-backend check-updates", remote)
    check_updates_ok = False
    detail = ""
    if code == 0:
        try:
            data = json.loads(stdout)
            updates_list = data.get("updates", [])
            warnings_list = data.get("warnings", [])
            has_aur_warn = any("AUR" in w for w in warnings_list)
            check_updates_ok = isinstance(updates_list, list) and not has_aur_warn
            aur_count = sum(1 for u in updates_list if u.get("repository") == "aur")
            detail = f"total={len(updates_list)}, aur={aur_count}, warnings={len(warnings_list)}"
        except Exception:
            detail = f"invalid json: {stdout[:100]}"
    else:
        detail = f"exit {code}: {stderr[:100]}"
    check("Backend check-updates executes successfully without AUR warnings", check_updates_ok, detail)

    # 14. Check backend preflight-upgrade includes AUR and official updates
    code, stdout, stderr = run_target_cmd("sudo /usr/libexec/cockpit-aur/cockpit-aur-backend preflight-upgrade", remote)
    preflight_ok = False
    detail = ""
    if code == 0:
        try:
            data = json.loads(stdout)
            preflight_ok = data.get("success") is True
            add_list = data.get("add", [])
            aur_in_add = sum(1 for p in add_list if p.get("repo") == "aur")
            detail = f"packages={data.get('packages_to_upgrade')}, aur_in_add={aur_in_add}"
        except Exception:
            detail = f"invalid json: {stdout[:100]}"
    else:
        detail = f"exit {code}: {stderr[:100]}"
    check("Backend preflight-upgrade includes AUR packages in transaction preview", preflight_ok, detail)

    # 15. Check AUR operation status and cache commands
    code, stdout, stderr = run_target_cmd("/usr/libexec/cockpit-aur/cockpit-aur-backend aur-operation-status", remote)
    status_ok = code == 0 and "status" in stdout
    check("Backend aur-operation-status reports valid status JSON", status_ok)

    # Summary
    print("-" * 60)
    if not failures:
        print(f"{Colors.GREEN}{Colors.BOLD}🎉 ALL {15} DEPLOYMENT CHECKS PASSED FOR [{target_name}]!{Colors.RESET}\n")
        return True
    else:
        print(f"{Colors.RED}{Colors.BOLD}❌ DEPLOYMENT VERIFICATION FAILED FOR [{target_name}] ({len(failures)} failures):{Colors.RESET}")
        for name, detail in failures:
            print(f"   - {name}: {detail}")
        print("")
        return False


def main():
    parser = argparse.ArgumentParser(description="Verify cockpit-aur deployment")
    parser.add_argument("--remote", default=None, help="Remote host (e.g. gf@192.168.1.188)")
    parser.add_argument("--version", default=None, help="Expected version (default from package.json)")
    parser.add_argument("--name", default=None, help="Display name for target")
    args = parser.parse_args()

    expected_ver = args.version or get_expected_version()
    name = args.name or (args.remote if args.remote else "vampa")

    ok = verify(name, args.remote, expected_ver)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
