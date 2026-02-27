#!/usr/bin/env python3
"""
Kjer Upgrade Manager
====================
Downloads and applies a version upgrade from the private GitHub repository
(PhanesGuild/Kjer-upgrades) using a GitHub token returned by the license
validation backend.

Called by the Electron GUI (via execute-command IPC) when the user
reinitializes after a successful license key upgrade.

Usage:
    python3 upgrade_manager.py <version> <github_token> <install_path>

Output:
    JSON to stdout — { "success": bool, "message": str }
"""

import sys
import os
import json
import shutil
import tarfile
import tempfile
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── Configuration ─────────────────────────────────────────────────────────────
REPO_OWNER   = "PhanesGuild"
REPO_NAME    = "Kjer-upgrades"
TIMEOUT_SECS = 120
# ─────────────────────────────────────────────────────────────────────────────


def _result(success: bool, message: str) -> dict:
    return {"success": success, "message": message}


def _print_result(d: dict):
    print(json.dumps(d))


def _utcnow() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_version_json(install_path: str) -> dict:
    vf = os.path.join(install_path, "version.json")
    try:
        with open(vf) as f:
            return json.load(f)
    except Exception:
        return {}


def _write_version_json(install_path: str, data: dict):
    vf = os.path.join(install_path, "version.json")
    with open(vf, "w") as f:
        json.dump(data, f, indent=2)


def _strip_prefix_tarball(tar: tarfile.TarFile, extract_dir: str):
    """Extract a GitHub tarball, stripping the auto-generated top-level directory."""
    members = tar.getmembers()
    if not members:
        return

    # GitHub tarballs look like: "PhanesGuild-Kjer-upgrades-<sha>/<files>"
    prefix = members[0].name.split("/")[0] + "/"

    for member in members:
        if member.name.startswith(prefix):
            member.name = member.name[len(prefix):]
        if not member.name:          # was the prefix directory itself
            continue
        # Safety: prevent path traversal
        if member.name.startswith("..") or member.name.startswith("/"):
            continue
        tar.extract(member, extract_dir)


def _apply_upgrade(extract_dir: str, install_path: str) -> tuple[bool, str]:
    """
    Merge extracted files into install_path.
    Protected directories/files (user data, venv) are never overwritten.
    """
    PROTECTED = {"kjer-venv", "dist", ".gitignore", "version.json"}

    try:
        for item in os.listdir(extract_dir):
            if item in PROTECTED:
                continue
            src = os.path.join(extract_dir, item)
            dst = os.path.join(install_path, item)
            if os.path.isdir(src):
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
        return True, "ok"
    except Exception as e:
        return False, str(e)


def download_and_apply(version: str, github_token: str, install_path: str) -> dict:
    """Main entry point: download release tarball and apply to install_path."""

    # Validate inputs
    if not version or not github_token or not install_path:
        return _result(False, "Missing required arguments.")

    if not os.path.isdir(install_path):
        return _result(False, f"Install path not found: {install_path}")

    # GitHub API URL for the versioned tarball
    api_url = (
        f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}"
        f"/tarball/v{version}"
    )

    req = urllib.request.Request(
        api_url,
        headers={
            "Authorization":        f"token {github_token}",
            "Accept":               "application/vnd.github+json",
            "User-Agent":           "Kjer-Upgrade-Manager/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tarball_path = os.path.join(tmpdir, f"kjer-v{version}.tar.gz")
        extract_dir  = os.path.join(tmpdir, "extracted")
        os.makedirs(extract_dir)

        # ── Download ─────────────────────────────────────────────────
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
                with open(tarball_path, "wb") as f:
                    shutil.copyfileobj(resp, f)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return _result(False,
                    "Not authorized. Your license key may not include this version, "
                    "or the token has expired. Please re-enter your license key.")
            elif e.code == 404:
                return _result(False,
                    f"Version v{version} was not found in the upgrade repository. "
                    "Check that the version number is correct.")
            else:
                return _result(False, f"Download failed (HTTP {e.code}).")
        except urllib.error.URLError as e:
            return _result(False,
                f"Network error during download: {e.reason}. "
                "Please check your internet connection.")
        except Exception as e:
            return _result(False, f"Unexpected download error: {e}")

        # ── Extract ──────────────────────────────────────────────────
        try:
            with tarfile.open(tarball_path, "r:gz") as tar:
                _strip_prefix_tarball(tar, extract_dir)
        except Exception as e:
            return _result(False, f"Failed to extract upgrade archive: {e}")

        if not os.listdir(extract_dir):
            return _result(False, "Upgrade archive was empty.")

        # ── Backup version.json ──────────────────────────────────────
        vf     = os.path.join(install_path, "version.json")
        vf_bak = os.path.join(install_path, "version.json.bak")
        if os.path.exists(vf):
            shutil.copy2(vf, vf_bak)

        # ── Apply files ──────────────────────────────────────────────
        ok, err = _apply_upgrade(extract_dir, install_path)
        if not ok:
            # Rollback version.json
            if os.path.exists(vf_bak):
                shutil.copy2(vf_bak, vf)
            return _result(False, f"Failed to apply upgrade files: {err}")

        # ── Update version.json ──────────────────────────────────────
        try:
            vdata = _read_version_json(install_path)
            old_version = vdata.get("version", "unknown")
            vdata.update({
                "version":          version,
                "channel":          "licensed",
                "previous_version": old_version,
                "upgraded_at":      _utcnow(),
                "repo_owner":       REPO_OWNER,
                "repo_name":        REPO_NAME,
            })
            _write_version_json(install_path, vdata)
        except Exception:
            pass  # non-fatal — upgrade files are already applied

        return _result(True, f"Successfully upgraded Kjer to v{version}.")


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 4:
        _print_result(_result(
            False,
            "Usage: upgrade_manager.py <version> <github_token> <install_path>"
        ))
        sys.exit(1)

    _version      = sys.argv[1].lstrip("v")   # accept "v1.1.0" or "1.1.0"
    _token        = sys.argv[2]
    _install_path = sys.argv[3]

    res = download_and_apply(_version, _token, _install_path)
    _print_result(res)
    sys.exit(0 if res["success"] else 1)
