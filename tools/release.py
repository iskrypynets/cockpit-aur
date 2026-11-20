#!/usr/bin/env python3
"""
Interactive or automated release script for cockpit-aur.
Builds the project locally, extracts changelog notes, creates git tags,
and publishes releases to Gitea and/or GitHub.

Usage:
    python3 tools/release.py [--target {all,gitea,github,build-only}] [--dry-run] [--skip-build] [--skip-push]

Examples:
    make release         # Build and publish to both Gitea and GitHub
    make release-gitea   # Build and publish ONLY to Gitea
    make release-github  # Build and publish ONLY to GitHub
    make release-dry     # Build and show release notes without pushing or uploading
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


def load_env():
    """Load config from .env or ~/.config/cockpit-aur/release.env if present."""
    candidates = [
        ROOT_DIR / ".env",
        Path.home() / ".config" / "cockpit-aur" / "release.env",
    ]
    for env_file in candidates:
        if env_file.is_file():
            try:
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k not in os.environ:
                            os.environ[k] = v
            except Exception as e:
                print(f"Warning: Failed reading {env_file}: {e}")


def get_version() -> str:
    pkg_json = ROOT_DIR / "package.json"
    if pkg_json.is_file():
        data = json.loads(pkg_json.read_text(encoding="utf-8"))
        if "version" in data:
            return data["version"]
    changelog = ROOT_DIR / "CHANGELOG.md"
    if changelog.is_file():
        m = re.search(r"## \[([0-9.]+)\]", changelog.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    raise RuntimeError("Could not determine version from package.json or CHANGELOG.md")


def extract_changelog(version: str) -> str:
    changelog_path = ROOT_DIR / "CHANGELOG.md"
    if not changelog_path.is_file():
        return ""
    content = changelog_path.read_text(encoding="utf-8")
    clean_v = version.lstrip("v").strip()
    pattern = rf"## \[{re.escape(clean_v)}\][^\n]*\n(.*?)(?=\n## \[|\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""


def run(cmd: list[str] | str, cwd: Path = ROOT_DIR, check: bool = True):
    print(f"  -> Running: {cmd if isinstance(cmd, str) else ' '.join(cmd)}")
    shell = isinstance(cmd, str)
    res = subprocess.run(cmd, cwd=cwd, shell=shell, check=check, text=True, capture_output=False)
    return res


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def build_release_artifacts(version: str) -> list[Path]:
    print("\n📦 [1/3] Building frontend & backend...")
    run(["npm", "run", "build"])
    shutil.copy(ROOT_DIR / "src" / "manifest.json", ROOT_DIR / "dist" / "manifest.json")
    shutil.copy(ROOT_DIR / "src" / "index.html", ROOT_DIR / "dist" / "index.html")

    run(["cargo", "build", "--release", "--locked"], cwd=ROOT_DIR / "backend")

    backend_bin = ROOT_DIR / "backend" / "target" / "release" / "cockpit-aur-backend"
    if not backend_bin.is_file():
        raise FileNotFoundError(f"Backend binary not found at {backend_bin}")

    # Strip binary for release
    try:
        subprocess.run(["strip", str(backend_bin)], check=False)
    except Exception:
        pass

    out_dir = ROOT_DIR / "dist-releases"
    out_dir.mkdir(exist_ok=True)

    # 1. Standalone backend binary copy
    release_bin = out_dir / "cockpit-aur-backend"
    shutil.copy(backend_bin, release_bin)

    # 2. Distribution tarball
    archive_name = f"cockpit-aur-{version}-x86_64.tar.xz"
    archive_path = out_dir / archive_name
    stage_dir = out_dir / f"cockpit-aur-{version}"
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir()

    shutil.copytree(ROOT_DIR / "dist", stage_dir / "dist")
    (stage_dir / "backend").mkdir()
    shutil.copy(backend_bin, stage_dir / "backend" / "cockpit-aur-backend")
    shutil.copytree(ROOT_DIR / "tools", stage_dir / "tools")
    for f in ["deploy.sh", "package.json", "README.md", "LICENSE"]:
        src_f = ROOT_DIR / f
        if src_f.is_file():
            shutil.copy(src_f, stage_dir / f)

    print(f"  -> Packaging {archive_name}...")
    with tarfile.open(archive_path, "w:xz") as tar:
        tar.add(stage_dir, arcname=f"cockpit-aur-{version}")

    shutil.rmtree(stage_dir)

    # 3. Checksums file
    checksums_path = out_dir / "sha256sums.txt"
    bin_hash = compute_sha256(release_bin)
    arc_hash = compute_sha256(archive_path)
    checksums_path.write_text(f"{bin_hash}  cockpit-aur-backend\n{arc_hash}  {archive_name}\n", encoding="utf-8")

    print(f"✓ Release assets created in {out_dir}:")
    print(f"  - {release_bin.name} ({release_bin.stat().st_size:,} bytes)")
    print(f"  - {archive_path.name} ({archive_path.stat().st_size:,} bytes)")
    print(f"  - sha256sums.txt")

    return [release_bin, archive_path, checksums_path]


def ensure_git_tag(version: str, dry_run: bool = False, skip_push: bool = False, remotes: list[str] = ["origin", "github"]):
    tag = f"v{version}"
    print(f"\n🏷️  [2/3] Checking Git tag {tag}...")

    # Check if tag exists locally
    res = subprocess.run(["git", "tag", "-l", tag], cwd=ROOT_DIR, capture_output=True, text=True)
    if tag not in res.stdout.split():
        print(f"  -> Creating local annotated tag {tag}")
        if not dry_run:
            run(["git", "tag", "-a", tag, "-m", f"Release {tag}"])
    else:
        print(f"  -> Tag {tag} already exists locally.")

    if not skip_push and not dry_run:
        for remote in remotes:
            print(f"  -> Pushing tag {tag} to remote '{remote}'...")
            try:
                run(["git", "push", remote, tag])
            except subprocess.CalledProcessError as e:
                print(f"  Notice: Push tag to {remote} returned: {e}")


def publish_to_gitea(tag: str, title: str, notes: str, assets: list[Path]):
    print(f"\n🚀 Publishing to Gitea ({tag})...")
    token = os.getenv("GITEA_TOKEN")
    url = os.getenv("GITEA_URL", "https://git.gfnet.cloudns.be").rstrip("/")
    repo = os.getenv("GITEA_REPO", "gf/cockpit-aur")

    if not token:
        print("⚠️  GITEA_TOKEN is not set.")
        print(f"   To publish to Gitea, create a token in Gitea (Settings -> Applications -> Generate New Token)")
        print(f"   and set it in .env or ~/.config/cockpit-aur/release.env: GITEA_TOKEN=<your-token>")
        return False

    script = ROOT_DIR / "tools" / "publish_gitea_release.py"
    notes_file = ROOT_DIR / "dist-releases" / "release_notes.md"
    notes_file.parent.mkdir(exist_ok=True)
    notes_file.write_text(notes, encoding="utf-8")

    cmd = [
        sys.executable,
        str(script),
        "--tag", tag,
        "--title", title,
        "--notes-file", str(notes_file),
        "--url", url,
        "--repo", repo,
        "--token", token,
        "--assets", *[str(a) for a in assets],
    ]
    res = subprocess.run(cmd)
    return res.returncode == 0


def publish_to_github(tag: str, title: str, notes: str, assets: list[Path]):
    print(f"\n🚀 Publishing to GitHub ({tag})...")
    repo = os.getenv("GITHUB_REPO", "iskrypynets/cockpit-aur")
    notes_file = ROOT_DIR / "dist-releases" / "release_notes.md"
    notes_file.parent.mkdir(exist_ok=True)
    notes_file.write_text(notes, encoding="utf-8")

    # 1. Try gh CLI if installed and authenticated
    gh_bin = shutil.which("gh")
    if gh_bin:
        auth_check = subprocess.run([gh_bin, "auth", "status"], capture_output=True, text=True)
        if auth_check.returncode == 0 or os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN"):
            print("  -> Using 'gh release create'...")
            cmd = [
                gh_bin, "release", "create", tag,
                "--repo", repo,
                "--title", title,
                "--notes-file", str(notes_file),
                *[str(a) for a in assets],
            ]
            env = os.environ.copy()
            if "GITHUB_TOKEN" in env and "GH_TOKEN" not in env:
                env["GH_TOKEN"] = env["GITHUB_TOKEN"]
            res = subprocess.run(cmd, env=env)
            if res.returncode == 0:
                print(f"✓ GitHub release published successfully via gh CLI.")
                return True

    # 2. Fallback to GitHub REST API with GITHUB_TOKEN
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    if not token:
        print("⚠️  Neither authenticated 'gh' CLI nor GITHUB_TOKEN environment variable found.")
        print(f"   To publish to GitHub, run 'gh auth login' OR set GITHUB_TOKEN=<token> in .env")
        return False

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cockpit-aur-release-script",
    }

    # Create release
    api_url = f"https://api.github.com/repos/{repo}/releases"
    payload = json.dumps({"tag_name": tag, "name": title, "body": notes, "draft": False, "prerelease": False}).encode("utf-8")
    req = urllib.request.Request(api_url, data=payload, headers={**headers, "Content-Type": "application/json"}, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            rel = json.loads(resp.read().decode("utf-8"))
            rel_id = rel["id"]
            upload_url_tmpl = rel["upload_url"] # https://uploads.github.com/.../assets{?name,label}
            upload_url_base = upload_url_tmpl.split("{")[0]
            print(f"✓ Created GitHub release ID {rel_id}: {rel.get('html_url')}")
    except urllib.error.HTTPError as e:
        if e.code == 422: # Already exists?
            get_req = urllib.request.Request(f"{api_url}/tags/{tag}", headers=headers)
            with urllib.request.urlopen(get_req) as resp:
                rel = json.loads(resp.read().decode("utf-8"))
                rel_id = rel["id"]
                upload_url_base = rel["upload_url"].split("{")[0]
                print(f"  -> Release for {tag} already exists (ID {rel_id}).")
        else:
            sys.stderr.write(f"GitHub release creation failed: {e.code} {e.reason}\n")
            try:
                sys.stderr.write(e.read().decode("utf-8") + "\n")
            except Exception:
                pass
            return False

    # Upload assets
    for asset in assets:
        url = f"{upload_url_base}?name={urllib.parse.quote(asset.name)}"
        data = asset.read_bytes()
        upload_req = urllib.request.Request(
            url,
            data=data,
            headers={**headers, "Content-Type": "application/octet-stream"},
            method="POST",
        )
        print(f"  -> Uploading {asset.name} ({len(data)} bytes) to GitHub...")
        try:
            with urllib.request.urlopen(upload_req) as r:
                print(f"  ✓ Uploaded {asset.name}")
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"  Failed uploading {asset.name}: {e.code} {e.reason}\n")

    return True


def main():
    load_env()

    parser = argparse.ArgumentParser(description="Build and publish cockpit-aur release")
    parser.add_argument("--target", choices=["all", "gitea", "github", "build-only"], default="all",
                        help="Where to publish: 'all' (default), 'gitea', 'github', or 'build-only'")
    parser.add_argument("--version", default=None, help="Explicit version (defaults to package.json)")
    parser.add_argument("--skip-build", action="store_true", help="Skip npm and cargo build steps")
    parser.add_argument("--skip-push", action="store_true", help="Skip pushing git tags")
    parser.add_argument("--dry-run", action="store_true", help="Show actions without pushing or uploading")

    args = parser.parse_args()

    version = args.version or get_version()
    tag = f"v{version}"
    title = f"cockpit-aur {tag}"

    print(f"==================================================")
    print(f"🚀 cockpit-aur Release Tool")
    print(f"   Version : {version} ({tag})")
    print(f"   Target  : {args.target}")
    if args.dry_run:
        print(f"   Mode    : DRY RUN (no remote changes)")
    print(f"==================================================")

    # 1. Changelog
    raw_notes = extract_changelog(version)
    if not raw_notes:
        print(f"⚠️  Warning: No entry found in CHANGELOG.md for version [{version}].")
        notes = f"Release {tag}"
    else:
        notes = raw_notes

    # 2. Build
    if args.skip_build:
        out_dir = ROOT_DIR / "dist-releases"
        assets = [
            out_dir / "cockpit-aur-backend",
            out_dir / f"cockpit-aur-{version}-x86_64.tar.xz",
            out_dir / "sha256sums.txt",
        ]
        assets = [a for a in assets if a.is_file()]
        print(f"Skipping build. Found {len(assets)} existing assets in {out_dir}.")
    else:
        assets = build_release_artifacts(version)

    # Append checksums into notes if available
    checksum_file = ROOT_DIR / "dist-releases" / "sha256sums.txt"
    if checksum_file.is_file():
        notes_with_checksums = notes + "\n\n### Checksums (SHA-256)\n```\n" + checksum_file.read_text(encoding="utf-8") + "```\n"
    else:
        notes_with_checksums = notes

    if args.target == "build-only":
        print("\n✓ Target is 'build-only'. Artifacts built successfully. Exiting.")
        return

    # 3. Git tag
    remotes = []
    if args.target in ("all", "gitea"):
        remotes.append("origin")
    if args.target in ("all", "github"):
        remotes.append("github")

    ensure_git_tag(version, dry_run=args.dry_run, skip_push=args.skip_push, remotes=remotes)

    if args.dry_run:
        print("\n[DRY RUN] Would publish the following notes:")
        print("--------------------------------------------------")
        print(notes_with_checksums)
        print("--------------------------------------------------")
        print(f"[DRY RUN] Assets to upload ({len(assets)} files):")
        for a in assets:
            print(f"  - {a}")
        print("\n✓ Dry run completed.")
        return

    # 4. Publish
    if args.target in ("all", "gitea"):
        publish_to_gitea(tag, title, notes_with_checksums, assets)

    if args.target in ("all", "github"):
        publish_to_github(tag, title, notes_with_checksums, assets)

    print("\n🎉 Done!")


if __name__ == "__main__":
    main()
