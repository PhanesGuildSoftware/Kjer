#!/usr/bin/env python3
"""
Kjer Upgrade Manager
====================
Downloads and applies a version upgrade from the private GitHub repository
configured in version.json (repo_owner / repo_name) using a GitHub token
returned by the license validation backend.

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
REPO_OWNER   = "PhanesGuildSoftware"   # default; overridden by version.json at runtime
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

    # Read repo owner/name from version.json (falls back to module constants)
    vdata    = _read_version_json(install_path)
    owner    = vdata.get("repo_owner", REPO_OWNER)
    reponame = vdata.get("repo_name",  REPO_NAME)

    # GitHub API URL for the versioned tarball
    api_url = (
        f"https://api.github.com/repos/{owner}/{reponame}"
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
                "repo_owner":       owner,
                "repo_name":        reponame,
            })
            _write_version_json(install_path, vdata)
        except Exception:
            pass  # non-fatal — upgrade files are already applied

        return _result(True, f"Successfully upgraded Kjer to v{version}.")


def check_for_updates(install_path: str, github_token: str = "") -> dict:
    """
    Query the GitHub Releases API for the latest available version and compare
    it against the currently installed version read from version.json.

    Returns:
        {
            "success":          bool,
            "current_version":  str,
            "latest_version":   str,
            "update_available": bool,
            "release_notes":    str,
            "published_at":     str,
            "message":          str  # human-readable status / error
        }
    """
    vdata           = _read_version_json(install_path)
    current_version = vdata.get("version", "0.0.0").lstrip("v")
    owner           = vdata.get("repo_owner", REPO_OWNER)
    reponame        = vdata.get("repo_name",  REPO_NAME)

    api_url = f"https://api.github.com/repos/{owner}/{reponame}/releases/latest"

    headers = {
        "Accept":               "application/vnd.github+json",
        "User-Agent":           "Kjer-Upgrade-Manager/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    req = urllib.request.Request(api_url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {**_result(False, "Not authorized — a valid license token is required to access the upgrade repository. Re-activate your license key and try again."),
                    "current_version": current_version, "latest_version": "", "update_available": False,
                    "release_notes": "", "published_at": ""}
        elif e.code == 404:
            # Distinguish between "repo not found" and "repo exists but no releases yet"
            # by making a second lightweight call to the repo endpoint.
            repo_url     = f"https://api.github.com/repos/{owner}/{reponame}"
            repo_req     = urllib.request.Request(repo_url, headers=headers)
            repo_exists  = False
            try:
                with urllib.request.urlopen(repo_req, timeout=10) as r:
                    repo_exists = r.status == 200
            except Exception:
                repo_exists = False

            if repo_exists:
                msg = (f"No releases have been published yet for {owner}/{reponame}. "
                       "Check back after the next release is deployed.")
            else:
                msg = (f"Upgrade repository '{owner}/{reponame}' was not found. "
                       "Verify the repository name in version.json or contact support.")

            return {**_result(False, msg),
                    "current_version": current_version, "latest_version": "", "update_available": False,
                    "release_notes": "", "published_at": ""}
        else:
            return {**_result(False, f"GitHub API error (HTTP {e.code})."),
                    "current_version": current_version, "latest_version": "", "update_available": False,
                    "release_notes": "", "published_at": ""}
    except urllib.error.URLError as e:
        return {**_result(False, f"Network error: {e.reason}. Check your internet connection."),
                "current_version": current_version, "latest_version": "", "update_available": False,
                "release_notes": "", "published_at": ""}
    except Exception as e:
        return {**_result(False, f"Unexpected error: {e}"),
                "current_version": current_version, "latest_version": "", "update_available": False,
                "release_notes": "", "published_at": ""}

    # Parse latest release
    tag          = data.get("tag_name", "").lstrip("v")
    release_notes = data.get("body", "").strip() or "No release notes provided."
    published_at  = data.get("published_at", "")

    if not tag:
        return {**_result(False, "Could not parse latest release version from GitHub."),
                "current_version": current_version, "latest_version": "", "update_available": False,
                "release_notes": "", "published_at": ""}

    # Simple semver comparison: split on "." and compare tuples of ints
    def _ver(v: str):
        try:
            parts = [int(x) for x in v.split(".")[:3]]
            # Pad to 3 elements so "1.0" == "1.0.0" and comparisons are always consistent
            while len(parts) < 3:
                parts.append(0)
            return tuple(parts)
        except ValueError:
            return (0, 0, 0)

    update_available = _ver(tag) > _ver(current_version)

    return {
        "success":          True,
        "current_version":  current_version,
        "latest_version":   tag,
        "update_available": update_available,
        "release_notes":    release_notes,
        "published_at":     published_at,
        "message":          (
            f"Update available: v{current_version} → v{tag}" if update_available
            else f"Kjer is up to date (v{current_version})."
        ),
    }


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        _print_result(_result(
            False,
            "Usage:\n"
            "  upgrade_manager.py check  <install_path> [github_token]\n"
            "  upgrade_manager.py install <version> <github_token> <install_path>"
        ))
        sys.exit(1)

    _cmd = sys.argv[1].lower()

    if _cmd == "check":
        if len(sys.argv) < 3:
            _print_result(_result(False, "Usage: upgrade_manager.py check <install_path> [github_token]"))
            sys.exit(1)
        _install_path = sys.argv[2]
        _token        = sys.argv[3] if len(sys.argv) >= 4 else ""
        res = check_for_updates(_install_path, _token)
        _print_result(res)
        sys.exit(0 if res["success"] else 1)

    elif _cmd == "install":
        if len(sys.argv) < 5:
            _print_result(_result(False, "Usage: upgrade_manager.py install <version> <github_token> <install_path>"))
            sys.exit(1)
        _version      = sys.argv[2].lstrip("v")
        _token        = sys.argv[3]
        _install_path = sys.argv[4]
        res = download_and_apply(_version, _token, _install_path)
        _print_result(res)
        sys.exit(0 if res["success"] else 1)

    else:
        # Legacy positional call: upgrade_manager.py <version> <token> <install_path>
        # Kept for backwards compatibility with any existing callers.
        if len(sys.argv) < 4:
            _print_result(_result(False, "Usage: upgrade_manager.py install <version> <github_token> <install_path>"))
            sys.exit(1)
        _version      = sys.argv[1].lstrip("v")
        _token        = sys.argv[2]
        _install_path = sys.argv[3]
        res = download_and_apply(_version, _token, _install_path)
        _print_result(res)
        sys.exit(0 if res["success"] else 1)
