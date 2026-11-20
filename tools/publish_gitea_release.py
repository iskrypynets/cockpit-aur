#!/usr/bin/env python3
"""
Publish or update a release in Gitea via the REST API with notes and asset uploads.
Uses Python standard library only (no external dependencies required).

Environment variables or CLI arguments:
  GITEA_URL: Base URL of Gitea instance (default: https://git.gfnet.cloudns.be)
  GITEA_REPO: Owner and repository name (default: gf/cockpit-aur)
  GITEA_TOKEN: Personal access token with repo permissions
"""

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def make_request(url: str, token: str, method: str = "GET", data: bytes | None = None, content_type: str | None = None):
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/json")
    if content_type:
        req.add_header("Content-Type", content_type)
    return req


def get_existing_release(base_url: str, repo: str, tag: str, token: str) -> dict | None:
    url = f"{base_url}/api/v1/repos/{repo}/releases/tags/{urllib.parse.quote(tag)}"
    req = make_request(url, token)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        sys.stderr.write(f"HTTP error checking existing release: {e.code} {e.reason}\n")
    except Exception as e:
        sys.stderr.write(f"Error checking release: {e}\n")
    return None


def create_or_update_release(base_url: str, repo: str, tag: str, title: str, notes: str, token: str) -> dict:
    existing = get_existing_release(base_url, repo, tag, token)
    if existing:
        release_id = existing["id"]
        print(f"Release for tag '{tag}' already exists (ID: {release_id}). Updating notes...")
        url = f"{base_url}/api/v1/repos/{repo}/releases/{release_id}"
        payload = json.dumps({"name": title, "body": notes}).encode("utf-8")
        req = make_request(url, token, method="PATCH", data=payload, content_type="application/json")
    else:
        print(f"Creating new release for tag '{tag}'...")
        url = f"{base_url}/api/v1/repos/{repo}/releases"
        payload = json.dumps({
            "tag_name": tag,
            "name": title,
            "body": notes,
            "draft": false if False else False,
            "prerelease": false if False else False,
        }).encode("utf-8")
        req = make_request(url, token, method="POST", data=payload, content_type="application/json")

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upload_asset(base_url: str, repo: str, release_id: int, file_path: Path, token: str):
    if not file_path.is_file():
        print(f"Warning: Asset file '{file_path}' does not exist, skipping.")
        return

    filename = file_path.name
    print(f"Uploading asset: {filename} ({file_path.stat().st_size} bytes)...")

    # Multipart form-data encoding using standard library
    boundary = "----GiteaReleaseBoundary" + os.urandom(16).hex()
    file_bytes = file_path.read_bytes()
    mime_type, _ = mimetypes.guess_type(str(file_path))
    if not mime_type:
        mime_type = "application/octet-stream"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="attachment"; filename="{filename}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    url = f"{base_url}/api/v1/repos/{repo}/releases/{release_id}/assets?name={urllib.parse.quote(filename)}"
    req = make_request(url, token, method="POST", data=body, content_type=f"multipart/form-data; boundary={boundary}")

    try:
        with urllib.request.urlopen(req) as resp:
            print(f"✓ Uploaded {filename} successfully.")
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"Failed to upload {filename}: {e.code} {e.reason}\n")
        try:
            sys.stderr.write(f"Response: {e.read().decode('utf-8')}\n")
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Publish release to Gitea")
    parser.add_argument("--tag", required=True, help="Git tag (e.g. v0.5.3)")
    parser.add_argument("--title", default=None, help="Release title")
    parser.add_argument("--notes-file", default=None, help="Path to markdown release notes file")
    parser.add_argument("--assets", nargs="*", default=[], help="Paths to files to upload as assets")
    parser.add_argument("--url", default=os.getenv("GITEA_URL", "https://git.gfnet.cloudns.be"))
    parser.add_argument("--repo", default=os.getenv("GITEA_REPO", "gf/cockpit-aur"))
    parser.add_argument("--token", default=os.getenv("GITEA_TOKEN"))

    args = parser.parse_args()

    if not args.token:
        print("Notice: GITEA_TOKEN is not set. Skipping Gitea release publish.")
        sys.exit(0)

    title = args.title or f"Release {args.tag}"
    notes = ""
    if args.notes_file and Path(args.notes_file).is_file():
        notes = Path(args.notes_file).read_text(encoding="utf-8")

    base_url = args.url.rstrip("/")
    try:
        release = create_or_update_release(base_url, args.repo, args.tag, title, notes, args.token)
        release_id = release.get("id")
        print(f"✓ Release ready: {release.get('html_url', f'{base_url}/{args.repo}/releases')}")

        if release_id and args.assets:
            for asset in args.assets:
                upload_asset(base_url, args.repo, release_id, Path(asset), args.token)

    except Exception as e:
        sys.stderr.write(f"Error publishing to Gitea: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
