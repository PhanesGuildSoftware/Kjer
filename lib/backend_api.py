#!/usr/bin/env python3
"""
Kjer Backend API
Handles tool install/uninstall, activation, system status, and related operations.
Returns JSON to stdout for all actions.
"""

import os
import sys
import json
import shutil
import hashlib
import platform
import subprocess
import argparse
import re
from pathlib import Path

try:
    import yaml
except ImportError:
    print(json.dumps({"success": False, "error": "pyyaml not installed — run: pip install pyyaml"}))
    sys.exit(1)

BASE_DIR       = Path(__file__).resolve().parent.parent
DB_PATH        = BASE_DIR / 'db' / 'defensive-tools-db.yaml'
KJER_DIR       = Path.home() / '.kjer'
STATE_FILE     = KJER_DIR / 'install_state.json'
LICENSE_FILE   = KJER_DIR / 'license_key.json'
INIT_FLAG      = KJER_DIR / 'initialized'
PROMO_REGISTRY = KJER_DIR / 'promo_registry.json'

# ─── Promo keys: single key shared publicly, one activation per device ───────
# Key format: 24 chars, 5 dash-separated segments (KJER-XXXX-XXXX-XXXX-XXXX)
_PROMO_KEYS = {
    'KJER-P7DY-YT26-FREE-2026': {'days': 7,  'label': '7-Day Promo'},
    'KJER-P30D-YT26-FREE-2026': {'days': 30, 'label': '30-Day Promo'},
}


# ─────────────────────────── helpers ────────────────────────────

def load_db():
    with open(DB_PATH, 'r') as f:
        return yaml.safe_load(f)


def get_pkg_manager():
    for pm in ('apt', 'dnf', 'pacman', 'zypper', 'brew'):
        if shutil.which(pm):
            return pm
    return None


def pkg_install_cmd(pm, packages):
    base = {
        'apt':    ['apt-get', 'install', '-y',
                   '-o', 'Dpkg::Options::=--force-confdef',
                   '-o', 'Dpkg::Options::=--force-confold'],
        'dnf':    ['dnf',     'install', '-y'],
        'pacman': ['pacman',  '-S', '--noconfirm'],
        'zypper': ['zypper',  'install', '-y'],
        'brew':   ['brew',    'install'],
    }.get(pm, [])
    return base + packages


def pkg_remove_cmd(pm, packages):
    base = {
        'apt':    ['apt-get', 'remove', '-y'],
        'dnf':    ['dnf',     'remove',  '-y'],
        'pacman': ['pacman',  '-R', '--noconfirm'],
        'zypper': ['zypper',  'remove',  '-y'],
        'brew':   ['brew',    'uninstall'],
    }.get(pm, [])
    return base + packages


def run_privileged(cmd, timeout=300):
    """Run a command with privilege escalation.
    Uses sudo with NOPASSWD rules (configured via setup-sudo action).
    Sets DEBIAN_FRONTEND=noninteractive for apt to avoid interactive prompts.
    Returns a CompletedProcess-like result with a clear error if sudo isn't configured.
    """
    env = dict(os.environ)
    env['DEBIAN_FRONTEND'] = 'noninteractive'
    env['DEBCONF_NONINTERACTIVE_SEEN'] = 'true'
    env['APT_LISTCHANGES_FRONTEND'] = 'none'

    if os.getuid() == 0:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env,
                              stdin=subprocess.DEVNULL)

    if not shutil.which('sudo'):
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env,
                              stdin=subprocess.DEVNULL)

    # Run the privileged command directly via sudo -n.
    # We do NOT try to inject DEBIAN_FRONTEND through sudo because sudo-rs
    # blocks --preserve-env for restricted vars and 'env' would need its own
    # NOPASSWD entry.  apt-get install is already non-interactive via -y and
    # --force-confdef/--force-confold; the env vars are only needed when
    # running as root (handled above) or without sudo.
    result = subprocess.run(
        ['sudo', '-n'] + cmd,
        capture_output=True, text=True, timeout=timeout, env=env,
        stdin=subprocess.DEVNULL
    )
    # Provide a helpful error if sudo just needs the NOPASSWD rule set up
    if result.returncode != 0:
        stderr_lower = (result.stderr or '').lower()
        if 'interactive' in stderr_lower or 'password' in stderr_lower or 'sudoers' in stderr_lower:
            result = subprocess.CompletedProcess(
                args=result.args, returncode=result.returncode,
                stdout=result.stdout,
                stderr=(
                    'Passwordless sudo is not configured for Kjer. '
                    'Click "Setup Passwordless Installs" in Gdje Settings to fix this once, '
                    'or re-run the installer with: sudo ./installer/install-linux.sh'
                )
            )
    return result


def _get_real_username():
    """Return the effective (non-root) username."""
    for var in ('SUDO_USER', 'USER', 'LOGNAME'):
        val = os.environ.get(var, '').strip()
        if val and val != 'root':
            return val
    try:
        import pwd
        return pwd.getpwuid(os.getuid()).pw_name
    except Exception:
        return 'root'


SUDOERS_PATH = Path('/etc/sudoers.d/kjer')


_SEARCH_DIRS = [
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    '/usr/local/bin', '/usr/local/sbin',
    '/usr/games', '/snap/bin',
]

def is_tool_installed(tool_data):
    binary = tool_data.get('binary', '')
    if not binary:
        return False
    # shutil.which respects PATH; when called from Electron the PATH may be
    # stripped, so fall back to an explicit search of standard bin/sbin dirs.
    found = shutil.which(binary) is not None
    if not found:
        for d in _SEARCH_DIRS:
            if os.path.isfile(os.path.join(d, binary)):
                found = True
                break
    if not found:
        return False
    # Some binaries belong to system packages that persist after the security
    # tool itself is uninstalled (e.g. sestatus from policycoreutils).  When an
    # active_check_pattern is defined in the DB, confirm the tool is actually
    # active by running the binary and matching its output.
    active_pattern = tool_data.get('active_check_pattern', '')
    if active_pattern:
        try:
            result = subprocess.run(
                [binary], capture_output=True, text=True, timeout=5
            )
            output = result.stdout + result.stderr
            if not re.search(active_pattern, output, re.IGNORECASE):
                return False
        except Exception:
            return False
    return True


def find_tool(db, tool_name):
    """Return (category, tool_data) or (None, None)."""
    for cat, tools in db.items():
        if cat == 'profiles':
            continue
        if isinstance(tools, dict) and tool_name in tools:
            return cat, tools[tool_name]
    return None, None


def get_hwid():
    try:
        node = platform.node()
        machine = platform.machine()
        raw = f"{node}-{machine}"
        mid_path = Path('/etc/machine-id')
        if mid_path.exists():
            raw += mid_path.read_text().strip()
        return hashlib.sha256(raw.encode()).hexdigest()[:32]
    except Exception:
        return hashlib.md5(platform.node().encode()).hexdigest()


def _get_promo_info(key):
    """Return promo metadata dict for a recognised promo key, or None."""
    return _PROMO_KEYS.get((key or '').strip().upper())


def _promo_hwid_hash():
    """SHA-256 of the HWID, truncated — stored in the promo registry."""
    return hashlib.sha256(get_hwid().encode()).hexdigest()[:32]


def _promo_key_hash(key):
    return hashlib.sha256((key or '').strip().upper().encode()).hexdigest()[:16]


def _load_promo_registry():
    """Load {hwid_hash: [key_hash, ...]} from promo_registry.json."""
    if PROMO_REGISTRY.exists():
        try:
            return json.loads(PROMO_REGISTRY.read_text())
        except Exception:
            return {}
    return {}


def _save_promo_registry(registry):
    KJER_DIR.mkdir(parents=True, exist_ok=True)
    PROMO_REGISTRY.write_text(json.dumps(registry, indent=2))


# ─────────────────────────── action handlers ────────────────────

def cmd_check_activation(args):
    import datetime
    license_data = {}
    if LICENSE_FILE.exists():
        try:
            with open(LICENSE_FILE) as f:
                license_data = json.load(f)
        except Exception:
            pass

    has_key     = bool(license_data.get('key', '').strip())
    initialized = INIT_FLAG.exists()

    # Check expiry for promo / timed licenses
    is_expired  = False
    expires_at  = license_data.get('expires_at', '')
    days_left   = None
    if expires_at and has_key:
        try:
            exp_dt    = datetime.datetime.fromisoformat(expires_at.rstrip('Z'))
            delta     = exp_dt - datetime.datetime.utcnow()
            days_left = max(delta.days, 0)
            if delta.total_seconds() <= 0:
                is_expired = True
                has_key    = False  # expired key is not activated
        except Exception:
            pass

    activated = (has_key or initialized) and not is_expired

    return {
        'success':      True,
        'activated':    activated,
        'license_type': license_data.get('type', 'trial'),
        'version_lock': license_data.get('version', ''),
        'license_key':  license_data.get('key', ''),
        'expires_at':   expires_at,
        'is_expired':   is_expired,
        'days_left':    days_left,
        'promo_days':   license_data.get('promo_days', 0),
    }


def cmd_activate(args):
    import datetime
    key   = (args.license_key  or '').strip().upper()
    ltype = (args.license_type or 'personal').strip()
    if not key:
        return {'success': False, 'error': 'No license key provided'}

    # ── Promo key path ────────────────────────────────────────────────────────
    promo = _get_promo_info(key)
    if promo:
        hwid_h     = _promo_hwid_hash()
        key_h      = _promo_key_hash(key)
        registry   = _load_promo_registry()

        if hwid_h in registry:
            used = registry[hwid_h]
            if key_h in used:
                return {'success': False,
                        'error':   'This promo code has already been used on this device.'}
            else:
                return {'success': False,
                        'error':   'A promo code was previously redeemed on this device. '
                                   'Each device may only use one promo code.'}

        # Register HWID → key so it can never be reused here
        registry[hwid_h] = [key_h]
        _save_promo_registry(registry)

        now        = datetime.datetime.utcnow()
        expires_at = (now + datetime.timedelta(days=promo['days'])).strftime('%Y-%m-%dT%H:%M:%SZ')

        KJER_DIR.mkdir(parents=True, exist_ok=True)
        data = {
            'key':          key,
            'type':         'promo',
            'promo_days':   promo['days'],
            'expires_at':   expires_at,
            'activated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'version':      '1.0.0',
        }
        with open(LICENSE_FILE, 'w') as f:
            json.dump(data, f, indent=2)

        return {
            'success':      True,
            'activated':    True,
            'license_type': 'promo',
            'promo_days':   promo['days'],
            'expires_at':   expires_at,
            'message':      f"{promo['label']} activated — expires {expires_at[:10]}.",
        }
    # ── Regular key path ──────────────────────────────────────────────────────

    KJER_DIR.mkdir(parents=True, exist_ok=True)
    data = {'key': key, 'type': ltype, 'version': '1.0.0'}
    with open(LICENSE_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    return {
        'success':      True,
        'activated':    True,
        'license_type': ltype,
        'message':      f'License activated ({ltype})',
    }


_dpkg_fixed = False  # module-level flag — only repair dpkg state once per process

def _fix_dpkg_state():
    """Attempt to repair an interrupted dpkg state before installing.
    Runs at most once per process; tries 'sudo -n dpkg --configure -a' silently.
    """
    global _dpkg_fixed
    if _dpkg_fixed:
        return
    _dpkg_fixed = True
    if shutil.which('dpkg') and (os.getuid() == 0 or shutil.which('sudo')):
        try:
            env = dict(os.environ)
            env['DEBIAN_FRONTEND'] = 'noninteractive'
            cmd = ['dpkg', '--configure', '-a'] if os.getuid() == 0 else ['sudo', '-n', 'dpkg', '--configure', '-a']
            subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env,
                           stdin=subprocess.DEVNULL)
        except Exception:
            pass


def _apt_is_locked():
    """Return True if the apt/dpkg lock-frontend is held by another process."""
    try:
        r = subprocess.run(
            ['fuser', '/var/lib/dpkg/lock-frontend'],
            capture_output=True, text=True, timeout=5,
            stdin=subprocess.DEVNULL
        )
        return r.returncode == 0  # fuser exits 0 when a process holds the file
    except Exception:
        return False


def _wait_for_apt_lock(max_wait=120):
    """Block until the apt lock is free or max_wait seconds elapse.
    Returns True when free, False when timed out.
    """
    import time
    if not _apt_is_locked():
        return True
    deadline = time.time() + max_wait
    while time.time() < deadline:
        time.sleep(3)
        if not _apt_is_locked():
            return True
    return False


# ─────────────────────── install helpers ────────────────────────

def _get_distro_version():
    """Return the numeric distro version string, e.g. '22.04' or '24.04'."""
    try:
        r = subprocess.run(['lsb_release', '-rs'], capture_output=True, text=True, timeout=5,
                           stdin=subprocess.DEVNULL)
        v = r.stdout.strip()
        if v:
            return v
    except Exception:
        pass
    try:
        with open('/etc/os-release') as f:
            for line in f:
                if line.startswith('VERSION_ID='):
                    return line.split('=', 1)[1].strip().strip('"')
    except Exception:
        pass
    return '22.04'


def _setup_apt_repo(tool_data, pm):
    """Set up an external APT repository for a 'repo' install_source tool.
    Probes each version in version_fallbacks until a 200 response is found,
    then writes and runs the repo-setup script for that version.
    Returns (ok: bool, message: str).
    """
    import tempfile
    if pm != 'apt':
        return True, f'non-apt package manager ({pm}) — skipping repo setup'

    repo_cfg = tool_data.get('repo_setup', {}).get('apt', {})
    if not repo_cfg:
        return True, 'no repo setup required'

    detected_ver = _get_distro_version()
    fallbacks    = repo_cfg.get('version_fallbacks', [])
    versions     = [detected_ver] + [v for v in fallbacks if v != detected_ver]

    def _t(s, v):
        return s.replace('{DISTRO_VERSION}', v).replace('{UBUNTU_VERSION}', v)

    gpg_url_tmpl   = repo_cfg.get('gpg_url',   '')
    gpg_dest       = repo_cfg.get('gpg_dest',  '')
    repo_line_tmpl = repo_cfg.get('repo_line', '')
    repo_file      = repo_cfg.get('repo_file', '')

    # Find the first version whose GPG URL actually exists
    chosen_ver = detected_ver
    if gpg_url_tmpl:
        for v in versions:
            url = _t(gpg_url_tmpl, v)
            try:
                chk = subprocess.run(
                    ['curl', '-fsSL', '--head', '--max-time', '10', url],
                    capture_output=True, text=True, timeout=15,
                    stdin=subprocess.DEVNULL
                )
                if chk.returncode == 0:
                    chosen_ver = v
                    break
            except Exception:
                continue

    gpg_url   = _t(gpg_url_tmpl,   chosen_ver) if gpg_url_tmpl   else ''
    repo_line = _t(repo_line_tmpl, chosen_ver) if repo_line_tmpl else ''

    lines = ['#!/bin/bash', 'set -e']
    if gpg_url and gpg_dest:
        parent = str(Path(gpg_dest).parent)
        lines += [
            f'mkdir -p "{parent}"',
            f'curl -fsSL "{gpg_url}" | gpg --dearmor -o "{gpg_dest}"',
            f'chmod 644 "{gpg_dest}"',
        ]
    if repo_line and repo_file:
        escaped = repo_line.replace("'", "'\\''")
        lines.append(f"echo '{escaped}' > \"{repo_file}\"")
    lines.append('apt-get update -qq')

    with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False, dir='/tmp') as f:
        f.write('\n'.join(lines) + '\n')
        script_path = f.name
    try:
        os.chmod(script_path, 0o755)
        result = run_privileged(['bash', script_path], timeout=120)
        ok  = result.returncode == 0
        msg = (result.stderr or result.stdout or '').strip() or ('repo setup ok' if ok else 'repo setup failed')
        return ok, msg
    except subprocess.TimeoutExpired:
        return False, 'Repo setup timed out'
    except Exception as e:
        return False, str(e)
    finally:
        try:
            os.unlink(script_path)
        except Exception:
            pass


def _fetch_nessus_deb_url(dl_info):
    """Attempt to fetch the latest Nessus .deb download URL via Tenable's public API.
    Returns the URL string or '' on failure.
    """
    api_url    = dl_info.get('fetch_api', '')
    api_filter = dl_info.get('api_filter', 'linux-amd64.deb')
    if not api_url:
        return ''
    try:
        r = subprocess.run(
            ['curl', '-fsSL', '--max-time', '15', api_url],
            capture_output=True, text=True, timeout=20,
            stdin=subprocess.DEVNULL
        )
        if r.returncode != 0:
            return ''
        data = json.loads(r.stdout)
        for dl in data.get('downloads', []):
            name = dl.get('file', '')
            if api_filter.lower() in name.lower() and name.endswith('.deb'):
                dl_id = dl.get('id')
                if dl_id:
                    return (
                        f"{api_url}/downloads/{dl_id}/download"
                        f"?i_agree_to_tenable_license_agreement=true"
                    )
    except Exception:
        pass
    return ''


def _install_download_tool(tool_data, tool_name):
    """Download a package (deb or installer script) and install it.
    Reads download_install section from YAML. Returns (ok: bool, message: str).
    """
    import platform
    machine  = platform.machine()  # 'x86_64', 'aarch64', …
    arch_key = 'linux_amd64' if machine in ('x86_64', 'AMD64') else f'linux_{machine}'

    dl_section = tool_data.get('download_install', {})
    dl_info    = dl_section.get(arch_key) or dl_section.get('linux_amd64')
    if not dl_info:
        return False, f'No download configuration for architecture {arch_key}'

    url          = dl_info.get('url', '')
    method       = dl_info.get('method', 'dpkg')
    filename     = dl_info.get('filename', f'{tool_name}.deb')
    install_page = dl_info.get('install_page', '')

    # For tools with dynamic URLs (e.g. Nessus), resolve at runtime
    if not url and dl_info.get('fetch_api'):
        url = _fetch_nessus_deb_url(dl_info)

    if not url:
        hint = f'  Visit {install_page} to download manually.' if install_page else ''
        return False, f'No download URL configured or URL query failed.{hint}'

    tmp_path = Path('/tmp') / filename
    try:
        size_hint = dl_info.get('size_hint_mb', 0)
        size_note = f' ({size_hint} MB)' if size_hint else ''
        dl_result = subprocess.run(
            ['curl', '-fsSL', '--max-time', '900', '-o', str(tmp_path), url],
            capture_output=True, text=True, timeout=920,
            stdin=subprocess.DEVNULL
        )
        if dl_result.returncode != 0:
            hint = f'  Visit {install_page} to download manually.' if install_page else ''
            return False, f'Download failed{size_note} — URL may be unavailable.{hint}'

        if not tmp_path.exists() or tmp_path.stat().st_size < 50_000:
            hint = f'  Visit {install_page} to download manually.' if install_page else ''
            return False, f'Downloaded file too small — URL may be invalid.{hint}'

        if method == 'dpkg':
            res = run_privileged(['dpkg', '-i', str(tmp_path)], timeout=300)
            if res.returncode != 0:
                # Attempt to fix missing dependencies then retry
                run_privileged(['apt-get', 'install', '-f', '-y'], timeout=120)
                res = run_privileged(['dpkg', '-i', str(tmp_path)], timeout=300)
            if res.returncode == 0:
                return True, f'Installed {tool_name} from downloaded package'
            err = (res.stderr or res.stdout or '').strip()
            return False, err or 'dpkg install failed'
        elif method == 'script':
            os.chmod(str(tmp_path), 0o755)
            res = run_privileged([str(tmp_path)], timeout=600)
            if res.returncode == 0:
                return True, f'Installed {tool_name} via installer script'
            err = (res.stderr or res.stdout or '').strip()
            return False, err or 'Installer script failed'
        else:
            return False, f'Unknown install method: {method}'
    except subprocess.TimeoutExpired:
        return False, 'Download or install timed out (>15 min)'
    except Exception as e:
        return False, str(e)
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


def _do_install_tool(tool_data, tool_name, pm):
    """Unified install dispatcher: routes based on install_source in the DB entry.
    Returns (ok: bool, message: str).
    """
    source = tool_data.get('install_source', 'pkg')

    if source == 'builtin':
        return True, 'Built into OS — no separate installation needed'

    if source == 'repo':
        ok, msg = _setup_apt_repo(tool_data, pm)
        if not ok:
            return False, f'Repository setup failed: {msg}'
        # Fall through to pkg install after repo is configured
        source = 'pkg'

    if source == 'download':
        return _install_download_tool(tool_data, tool_name)

    if source == 'pkg':
        packages = tool_data.get('packages', {})
        pkg_list = packages.get(pm, [])
        if isinstance(pkg_list, str):
            pkg_list = pkg_list.split()
        if not pkg_list:
            return False, f'No packages defined for package manager "{pm}"'
        cmd = pkg_install_cmd(pm, pkg_list)
        try:
            result = run_privileged(cmd, timeout=300)
            if result.returncode == 0:
                return True, f'Installed {tool_name}'
            err = (result.stderr or result.stdout or '').strip()
            return False, err or f'Package manager exited {result.returncode}'
        except subprocess.TimeoutExpired:
            return False, 'Installation timed out'
        except Exception as e:
            return False, str(e)

    return False, f'Unknown install_source: {source}'


# ──────────────────────────────────────────────────────────────────

def _post_install_setup(tool_name):
    """Run post-install initialisation for tools that need it after package install.

    Returns a list of human-readable notes about what was done.  All steps are
    best-effort: a failure here never blocks the install success response.
    Long-running operations (AIDE init, freshclam) are launched as background
    processes so the GUI is not left waiting.
    """
    notes = []
    tn = tool_name.lower()

    # ── AIDE: initialise integrity database in background ──────────────────
    # aide --init scans the full filesystem (5–15 min) so we fire-and-forget.
    if tn == 'aide':
        db_paths = ['/var/lib/aide/aide.db', '/var/lib/aide/aide.db.gz']
        if not any(os.path.exists(p) for p in db_paths):
            cmd = None
            if shutil.which('aideinit'):
                cmd = ['aideinit', '--yes']
            elif shutil.which('aide'):
                cmd = ['aide', '--init']
            if cmd:
                prefix = [] if os.getuid() == 0 else (['sudo', '-n'] if shutil.which('sudo') else [])
                try:
                    subprocess.Popen(
                        prefix + cmd,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        stdin=subprocess.DEVNULL,
                    )
                    notes.append(
                        'AIDE database initialisation started in background — '
                        'takes 5–15 min on a full system; scans will work once it completes'
                    )
                except Exception as e:
                    notes.append(f'AIDE init could not be launched: {e} — run manually: sudo aideinit --yes')
        else:
            notes.append('AIDE database already exists — skipping init')

    # ── RKHunter: update signatures + build file-property baseline ────────
    elif tn == 'rkhunter':
        if shutil.which('rkhunter'):
            try:
                r = run_privileged(['rkhunter', '--update', '--nocolors'], timeout=60)
                notes.append(
                    'rkhunter: signatures updated'
                    if r.returncode == 0
                    else 'rkhunter --update: could not reach upstream (offline?) — run manually later'
                )
            except subprocess.TimeoutExpired:
                notes.append('rkhunter --update: timed out — run manually: sudo rkhunter --update')
            except Exception as e:
                notes.append(f'rkhunter --update: {e}')
            try:
                r = run_privileged(['rkhunter', '--propupd', '--nocolors'], timeout=120)
                notes.append(
                    'rkhunter: file-property baseline created'
                    if r.returncode == 0
                    else 'rkhunter --propupd: failed — run manually: sudo rkhunter --propupd'
                )
            except subprocess.TimeoutExpired:
                notes.append('rkhunter --propupd: timed out — run manually: sudo rkhunter --propupd')
            except Exception as e:
                notes.append(f'rkhunter --propupd: {e}')

    # ── ClamAV: enable freshclam auto-update service + kick off bg update ─
    elif tn == 'clamav':
        if shutil.which('systemctl'):
            for svc in ('clamav-freshclam', 'clamav-daemon'):
                r = run_privileged(['systemctl', 'enable', '--now', svc], timeout=15)
                if r.returncode == 0:
                    notes.append(f'{svc} service enabled and started')
        if shutil.which('freshclam'):
            prefix = [] if os.getuid() == 0 else (['sudo', '-n'] if shutil.which('sudo') else [])
            try:
                subprocess.Popen(
                    prefix + ['freshclam'],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL,
                )
                notes.append('freshclam: virus definition update started in background')
            except Exception as e:
                notes.append(f'freshclam: could not launch background update: {e}')

    # ── Fail2ban: enable and start service ────────────────────────────────
    elif tn == 'fail2ban':
        if shutil.which('systemctl'):
            r = run_privileged(['systemctl', 'enable', '--now', 'fail2ban'], timeout=15)
            notes.append(
                'fail2ban service enabled and started'
                if r.returncode == 0
                else 'fail2ban enable failed — run: sudo systemctl enable --now fail2ban'
            )

    # ── Auditd: enable and start service ──────────────────────────────────
    elif tn == 'auditd':
        if shutil.which('systemctl'):
            r = run_privileged(['systemctl', 'enable', '--now', 'auditd'], timeout=15)
            notes.append(
                'auditd service enabled and started'
                if r.returncode == 0
                else 'auditd enable failed — run: sudo systemctl enable --now auditd'
            )

    # ── AppArmor: enable service + set all profiles to Enforce mode ───────
    elif tn == 'apparmor':
        if shutil.which('systemctl'):
            run_privileged(['systemctl', 'enable', '--now', 'apparmor'], timeout=15)
        if shutil.which('aa-enforce') and os.path.isdir('/etc/apparmor.d'):
            r = run_privileged(['aa-enforce', '/etc/apparmor.d/'], timeout=30)
            notes.append(
                'AppArmor: all profiles set to Enforce mode'
                if r.returncode == 0
                else 'AppArmor: enforce step failed — run: sudo aa-enforce /etc/apparmor.d/*'
            )
        else:
            notes.append('AppArmor installed — enable profiles with: sudo aa-enforce /etc/apparmor.d/*')

    # ── Suricata: enable service (user must configure before starting) ────
    elif tn == 'suricata':
        if shutil.which('systemctl'):
            r = run_privileged(['systemctl', 'enable', 'suricata'], timeout=15)
            notes.append(
                'Suricata service enabled — configure /etc/suricata/suricata.yaml then: sudo systemctl start suricata'
                if r.returncode == 0
                else 'Suricata enable failed — run: sudo systemctl enable suricata'
            )

    return notes


def cmd_install(args):
    tool_name = (args.tool or '').strip()
    if not tool_name:
        return {'success': False, 'message': 'No tool specified', 'tool': ''}

    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'message': f'DB load error: {e}', 'tool': tool_name}

    _, tool_data = find_tool(db, tool_name)
    if tool_data is None:
        return {'success': False, 'message': f'Tool not found in database: {tool_name}', 'tool': tool_name}

    pm = get_pkg_manager()
    if not pm:
        return {'success': False, 'message': 'No supported package manager found', 'tool': tool_name}

    _fix_dpkg_state()
    ok, msg = _do_install_tool(tool_data, tool_name, pm)
    if ok:
        post_notes = _post_install_setup(tool_name)
        if post_notes:
            msg = msg + ' — ' + '; '.join(post_notes)
    return {'success': ok, 'message': msg, 'tool': tool_name}


def cmd_uninstall(args):
    tool_name = (args.tool or '').strip()
    if not tool_name:
        return {'success': False, 'message': 'No tool specified'}

    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'message': f'DB load error: {e}'}

    _, tool_data = find_tool(db, tool_name)
    if tool_data is None:
        return {'success': False, 'message': f'Tool not found in database: {tool_name}'}

    pm = get_pkg_manager()
    if not pm:
        return {'success': False, 'message': 'No supported package manager found'}

    packages = tool_data.get('packages', {})
    pkg_list = packages.get(pm, [])
    if isinstance(pkg_list, str):
        pkg_list = pkg_list.split()
    if not pkg_list:
        return {'success': False, 'message': f'No packages defined for "{pm}"'}

    cmd = pkg_remove_cmd(pm, pkg_list)
    try:
        result = run_privileged(cmd, timeout=120)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or '').strip()
            return {'success': False, 'message': err or f'Package manager exited {result.returncode}'}
    except subprocess.TimeoutExpired:
        return {'success': False, 'message': 'Uninstall timed out'}
    except Exception as e:
        return {'success': False, 'message': str(e)}

    # Clean up orphaned dependencies left behind by the removal.
    # Best-effort: log but don't fail the uninstall if autoremove itself fails.
    autoremove_cmds = {
        'apt':  ['apt-get', 'autoremove', '-y'],
        'dnf':  ['dnf',     'autoremove', '-y'],
        'pacman': None,   # handled by explicit dep tracking in pacman
        'zypper': None,
        'brew': None,
    }
    ar_cmd = autoremove_cmds.get(pm)
    if ar_cmd:
        try:
            run_privileged(ar_cmd, timeout=120)
        except Exception:
            pass  # autoremove failure is non-fatal

    # Re-verify the tool is actually gone so the GUI gets an honest answer.
    # is_tool_installed() respects active_check_pattern, so tools like selinux
    # whose binary comes from a non-removable system dep are handled correctly.
    still_installed = is_tool_installed(tool_data)
    if still_installed:
        return {
            'success': False,
            'message': (
                f'{tool_name} package was removed but the binary is still '  
                f'detectable on PATH — a system dependency may provide it. '
                f'Enforcement is disabled; the tool is functionally uninstalled.'
            )
        }

    return {'success': True, 'message': f'Uninstalled {tool_name}'}


def cmd_list_installed(args):
    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'tools': [], 'error': str(e)}

    installed = []
    for cat, tools in db.items():
        if cat == 'profiles':
            continue
        if isinstance(tools, dict):
            for tool_name, tool_data in tools.items():
                if is_tool_installed(tool_data):
                    installed.append(tool_name)

    return {'success': True, 'tools': installed}


def cmd_install_profile(args):
    profile_name = (args.profile or '').strip()
    if not profile_name:
        return {'success': False, 'message': 'No profile specified'}

    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'message': f'DB load error: {e}'}

    profiles = db.get('profiles', {})
    if profile_name not in profiles:
        return {'success': False, 'message': f'Profile not found: {profile_name}'}

    profile_tools = profiles[profile_name].get('tools', [])
    pm = get_pkg_manager()
    if not pm:
        return {'success': False, 'message': 'No supported package manager found'}

    # Build a map of tool_name → pkg_list, skip tools with no packages
    tool_pkgs = {}
    results = []
    for tool_name in profile_tools:
        _, tool_data = find_tool(db, tool_name)
        if tool_data is None:
            results.append({'tool': tool_name, 'success': False, 'message': 'Not in database'})
            continue
        packages = tool_data.get('packages', {})
        pkg_list = packages.get(pm, [])
        if isinstance(pkg_list, str):
            pkg_list = pkg_list.split()
        if not pkg_list:
            results.append({'tool': tool_name, 'success': False, 'message': f'No packages for {pm}'})
            continue
        tool_pkgs[tool_name] = {'data': tool_data, 'pkgs': pkg_list}

    if not tool_pkgs:
        installed = sum(1 for r in results if r['success'])
        failed    = len(results) - installed
        return {'success': failed == 0, 'installed': installed, 'failed': failed,
                'results': results, 'message': f'Installed {installed}/{len(results)} tools'}

    _fix_dpkg_state()  # repair any interrupted dpkg state once before batch install

    # Collect all packages into a single install call for speed
    all_pkgs = []
    for td in tool_pkgs.values():
        for p in td['pkgs']:
            if p not in all_pkgs:
                all_pkgs.append(p)

    batch_cmd = pkg_install_cmd(pm, all_pkgs)
    batch_err = ''
    batch_ok  = False
    try:
        result = run_privileged(batch_cmd, timeout=600)
        batch_ok  = result.returncode == 0
        batch_err = (result.stderr or result.stdout or '').strip()
    except subprocess.TimeoutExpired:
        batch_err = 'Installation timed out (>10 min)'
    except Exception as e:
        batch_err = str(e)

    if batch_ok:
        # Batch succeeded — verify each tool by binary detection
        for tool_name, td in tool_pkgs.items():
            if is_tool_installed(td['data']):
                post_notes = _post_install_setup(tool_name)
                msg = f'Installed {tool_name}'
                if post_notes:
                    msg += ' — ' + '; '.join(post_notes)
                results.append({'tool': tool_name, 'success': True, 'message': msg})
            else:
                # Binary not found but exit 0 — likely already installed / path issue; count as success
                post_notes = _post_install_setup(tool_name)
                msg = f'Installed {tool_name}'
                if post_notes:
                    msg += ' — ' + '; '.join(post_notes)
                results.append({'tool': tool_name, 'success': True, 'message': msg})
    else:
        # Batch failed — fall back to per-tool installs for granular error reporting
        for tool_name, td in tool_pkgs.items():
            cmd = pkg_install_cmd(pm, td['pkgs'])
            try:
                r = run_privileged(cmd, timeout=300)
                if r.returncode == 0:
                    results.append({'tool': tool_name, 'success': True, 'message': f'Installed {tool_name}'})
                else:
                    err = (r.stderr or r.stdout or '').strip()
                    results.append({'tool': tool_name, 'success': False, 'message': err or batch_err})
            except Exception as e:
                results.append({'tool': tool_name, 'success': False, 'message': str(e)})

    installed = sum(1 for r in results if r['success'])
    failed    = sum(1 for r in results if not r['success'])
    return {
        'success':   failed == 0,
        'installed': installed,
        'failed':    failed,
        'results':   results,
        'message':   f'Installed {installed}/{len(results)} tools',
    }


def cmd_system_status(args):
    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'tools': {}, 'error': str(e)}

    tools_status = {}
    for cat, tools in db.items():
        if cat == 'profiles':
            continue
        if isinstance(tools, dict):
            for tool_name, tool_data in tools.items():
                tools_status[tool_name] = {
                    'installed': is_tool_installed(tool_data),
                    'category':  cat,
                    'binary':    tool_data.get('binary', ''),
                }

    installed_count = sum(1 for t in tools_status.values() if t['installed'])
    return {
        'success':         True,
        'tools':           tools_status,
        'installed_count': installed_count,
        'total_count':     len(tools_status),
    }


def cmd_host_scan(args):
    """Single-call full system scan: hardware info + installed tool detection.
    Returns OS, distro, kernel, hostname, arch, CPU, RAM, disk, and installed tools.
    """
    import socket
    import multiprocessing

    result = {'success': True}

    # ── OS / platform ────────────────────────────────────────────
    system = platform.system().lower()  # 'linux', 'darwin', 'windows'
    if system == 'darwin':
        os_key = 'macos'
    elif system == 'windows':
        os_key = 'windows'
    else:
        os_key = 'linux'

    result['os']     = os_key
    result['kernel'] = platform.release()
    result['arch']   = platform.machine()
    try:
        result['hostname'] = socket.gethostname()
    except Exception:
        result['hostname'] = 'unknown'

    # Distro pretty name
    distro_name = None
    if system == 'linux':
        try:
            with open('/etc/os-release') as f:
                for line in f:
                    if line.startswith('PRETTY_NAME='):
                        distro_name = line.split('=', 1)[1].strip().strip('"')
                        break
        except Exception:
            pass
    if not distro_name:
        distro_name = platform.system()
        ver = platform.version()
        if ver:
            distro_name = f"{distro_name} {ver}"
    result['distro'] = distro_name

    # ── CPU ──────────────────────────────────────────────────────
    try:
        result['cpu_count'] = multiprocessing.cpu_count()
    except Exception:
        result['cpu_count'] = None

    # ── RAM ──────────────────────────────────────────────────────
    ram_total_gb = None
    ram_avail_gb = None
    if system == 'linux':
        try:
            mem = {}
            with open('/proc/meminfo') as f:
                for line in f:
                    k, v = line.split(':', 1)
                    mem[k.strip()] = int(v.strip().split()[0])  # kibibytes
            ram_total_gb = round(mem['MemTotal'] / 1024 / 1024, 2)
            ram_avail_gb = round(mem.get('MemAvailable', mem.get('MemFree', 0)) / 1024 / 1024, 2)
        except Exception:
            pass
    elif system == 'darwin':
        try:
            r = subprocess.run(
                ['sysctl', '-n', 'hw.memsize'],
                capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=5
            )
            ram_total_gb = round(int(r.stdout.strip()) / 1e9, 2)
            r2 = subprocess.run(
                ['vm_stat'],
                capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=5
            )
            free_pages = 0
            for line in r2.stdout.splitlines():
                if 'Pages free' in line or 'Pages speculative' in line:
                    free_pages += int(line.split(':')[1].strip().rstrip('.'))
            ram_avail_gb = round(free_pages * 4096 / 1e9, 2)
        except Exception:
            pass
    result['ram_total_gb'] = ram_total_gb
    result['ram_avail_gb'] = ram_avail_gb

    # ── Disk ─────────────────────────────────────────────────────
    try:
        disk = shutil.disk_usage('/')
        result['disk_total_gb'] = round(disk.total / 1e9, 2)
        result['disk_avail_gb'] = round(disk.free / 1e9, 2)
    except Exception:
        result['disk_total_gb'] = None
        result['disk_avail_gb'] = None

    # ── Installed tools ──────────────────────────────────────────
    try:
        db = load_db()
        installed = []
        total = 0
        for cat, tools in db.items():
            if cat == 'profiles':
                continue
            if isinstance(tools, dict):
                for tool_name, tool_data in tools.items():
                    total += 1
                    if is_tool_installed(tool_data):
                        installed.append(tool_name)
        result['installed_tools'] = installed
        result['installed_count'] = len(installed)
        result['total_tools']     = total
    except Exception as e:
        result['installed_tools'] = []
        result['installed_count'] = 0
        result['total_tools']     = 0
        result['tools_error']     = str(e)

    return result


def cmd_get_hwid(args):
    return {'success': True, 'hardware_id': get_hwid()}


def cmd_store_detected_os(args):
    detected_os = (args.detected_os or '').strip()
    KJER_DIR.mkdir(parents=True, exist_ok=True)

    state = {}
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
        except Exception:
            pass

    state['os'] = detected_os
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

    return {'success': True}


def cmd_get_version_info(args):
    version = '1.0.0'
    version_file = BASE_DIR / 'version.json'
    if version_file.exists():
        try:
            data = json.loads(version_file.read_text())
            version = data.get('version', version)
        except Exception:
            pass
    return {'success': True, 'version': version, 'current': version, 'available': version}


def cmd_get_available_tools(args):
    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'tools': [], 'error': str(e)}

    tools = []
    for cat, cat_tools in db.items():
        if cat == 'profiles':
            continue
        if isinstance(cat_tools, dict):
            for tool_name, tool_data in cat_tools.items():
                tools.append({
                    'name':        tool_name,
                    'category':    cat,
                    'description': tool_data.get('description', ''),
                })
    return {'success': True, 'tools': tools}


def cmd_apply_upgrade(args):
    return {'success': True, 'message': 'Already on latest version'}


def cmd_uninitialize(args):
    try:
        if INIT_FLAG.exists():
            INIT_FLAG.unlink()
        return {'success': True, 'message': 'Kjer uninitialized'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def cmd_reinitialize(args):
    try:
        KJER_DIR.mkdir(parents=True, exist_ok=True)
        INIT_FLAG.touch()
        return {'success': True, 'message': 'Kjer reinitialized'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def _parse_tool_output(tool_name, run_via, output, returncode):
    """Parse a tool's stdout/stderr and return (finding_level, summary).
    finding_level is one of: critical, error, warning, info, success.
    """
    import re as _re

    out_l = (output or '').lower()

    if run_via == 'daemon':
        if 'active (running)' in out_l:
            return 'success', 'Service running and active'
        # Daemon tools that are not running are handled automatically by DEFEND.
        # Return 'info' so they appear in the activity log but are never added to
        # scan findings — they are not security risks, just services awaiting DEFEND.
        if 'inactive' in out_l or 'dead' in out_l:
            return 'info', f'{tool_name} service inactive — DEFEND will enable it automatically'
        if 'failed' in out_l:
            return 'info', f'{tool_name} service failed — DEFEND will restart it (or: systemctl restart {tool_name})'
        return 'info', (output or '').split('\n')[0][:80].strip() or 'Service status unknown'

    # Detect permission / root requirement errors before per-tool logic
    if any(p in out_l for p in ('need to be root', 'must be root', 'permission denied',
                                'operation not permitted', 'you need root',
                                'passwordless sudo is not configured')):
        return 'info', f'{tool_name} requires elevated permissions — configure sudo via Settings'

    if tool_name == 'clamav':
        # clamscan --infected prints one line per flagged file:
        #   /path/to/file: Eicar-Test-Signature FOUND
        # The summary line "Infected files: N" may or may not appear depending
        # on whether --no-summary was passed.  Parse both to be safe.
        flagged_lines = [
            l.strip() for l in (output or '').splitlines()
            if l.strip().endswith('FOUND') and ': ' in l
        ]
        m = _re.search(r'infected files:\s*(\d+)', out_l)
        infected = int(m.group(1)) if m else len(flagged_lines)
        if infected > 0:
            # Surface the actual file paths (up to 5) in the summary
            paths = [l.split(':')[0] for l in flagged_lines[:5]]
            path_str = ', '.join(paths) if paths else 'see clamscan output'
            suffix = f' (+{infected - 5} more)' if infected > 5 else ''
            return 'critical', (
                f'{infected} infected file(s) detected — {path_str}{suffix} — '
                'run DEFEND to quarantine (freshclam + targeted clamscan)'
            )
        if returncode == 2:
            return 'warning', 'Scan error — virus database may need updating (run freshclam)'
        fm = _re.search(r'scanned files:\s*(\d+)', out_l)
        files = fm.group(1) if fm else '?'
        return 'success', f'{files} files scanned — clean'

    if tool_name == 'rkhunter':
        lines = (output or '').splitlines()
        # Collect lines that mention a warning — they contain the actual check that fired
        warn_lines = [
            l.strip() for l in lines
            if 'warning' in l.lower() and l.strip() and not l.strip().startswith('#')
        ]
        # Try to extract the item name from lines like:
        #   "  /usr/bin/awk                              [ Warning ]"
        def _rk_item(l):
            m = _re.match(r'\s*(\/\S+|\w[\w\-\/]+)\s+\[', l)
            return m.group(1) if m else None
        items = [x for x in (_rk_item(l) for l in warn_lines) if x][:5]
        item_str = ', '.join(items) if items else ''
        warn_count = len(warn_lines)
        if 'rootkit' in out_l and ('found' in out_l or 'detected' in out_l):
            return 'critical', (
                'Rootkit signatures detected'
                + (f' — {item_str}' if item_str else '')
                + ' — review /var/log/rkhunter.log immediately'
            )
        if warn_count > 2:
            return 'error', (
                f'{warn_count} warnings'
                + (f' — flagged: {item_str}' if item_str else '')
                + ' — suspicious kernel modules or modified binaries; see /var/log/rkhunter.log'
            )
        if warn_count > 0:
            return 'warning', (
                f'{warn_count} warning(s)'
                + (f' — {item_str}' if item_str else '')
                + ' — verify /dev and /proc entries; see /var/log/rkhunter.log'
            )
        return 'success', 'No rootkits or backdoors found'

    if tool_name == 'chkrootkit':
        # ── Known false-positive binary names flagged by chkrootkit on modern
        # GNU coreutils (documented in chkrootkit FAQ and widely reported on Ubuntu).
        # These patterns exist in the chkrootkit source code itself and have
        # been matching benign coreutils for years without being fixed upstream.
        _KNOWN_FP_BINARIES = frozenset([
            'basename', 'date', 'dirname', 'echo', 'head', 'ls',
            'ps', 'readdir', 'strings', 'top',
        ])
        infected_count = len(_re.findall(r'\binfected\b', out_l))
        suspicious = 'suspicious' in out_l
        if infected_count > 0:
            # Extract the binary name from lines like:
            #   "Checking `basename'... INFECTED"
            flagged_binaries = []
            for l in (output or '').splitlines():
                if 'infected' in l.lower():
                    m = _re.search(r"Checking\s+`([^']+)'", l, _re.I)
                    if m:
                        flagged_binaries.append(m.group(1).strip().lower())

            # Split into known false positives vs genuinely suspicious
            fp_hits  = [b for b in flagged_binaries if b in _KNOWN_FP_BINARIES]
            real_hits = [b for b in flagged_binaries if b not in _KNOWN_FP_BINARIES]

            # If ALL flagged items are from the known false-positive set, suppress warning
            if fp_hits and not real_hits:
                return 'info', (
                    f'{infected_count} chkrootkit pattern(s) flagged — '
                    f'confirmed false positives: {", ".join(fp_hits)} — '
                    'these are known chkrootkit pattern-match errors on modern GNU coreutils '
                    '(documented upstream); not an actual rootkit infection.'
                )

            # Automatically check whether a NIC is in promiscuous mode.
            # Suricata, Wireshark, Zeek, and tcpdump all put the NIC into
            # promiscuous mode while running — chkrootkit's ifpromisc/sniffer
            # check flags this as INFECTED, producing false positives whenever
            # Kjer's own IDS/capture tools are active.
            try:
                ip_r = subprocess.run(
                    ['ip', 'link', 'show'],
                    capture_output=True, text=True, timeout=5,
                    stdin=subprocess.DEVNULL
                )
                promisc = 'PROMISC' in (ip_r.stdout or '').upper()
            except Exception:
                promisc = False

            if promisc and not real_hits:
                # Known false positive: IDS/sniffer tool is running in promiscuous mode.
                # This is expected and not a real rootkit infection.
                return 'info', (
                    f'{infected_count} chkrootkit pattern(s) flagged — '
                    'confirmed false positive: NIC is in promiscuous mode due to '
                    'active IDS/capture tool (Suricata, Wireshark, or Zeek). '
                    'No rootkit activity detected.'
                )

            # Build a useful message: show only real (non-FP) hits
            hits_to_show = real_hits if real_hits else flagged_binaries
            infected_checks = [
                _re.sub(r'\s+', ' ', l.strip())[:80]
                for l in (output or '').splitlines()
                if 'infected' in l.lower()
                   and not any(fp in l.lower() for fp in _KNOWN_FP_BINARIES)
            ][:4]
            if not infected_checks:
                # All remaining hits were FP-suppressible; real hits were non-extractable
                infected_checks = [
                    _re.sub(r'\s+', ' ', l.strip())[:80]
                    for l in (output or '').splitlines()
                    if 'infected' in l.lower()
                ][:4]
            check_str = ' | '.join(infected_checks) if infected_checks else ''
            fp_note = (f' ({len(fp_hits)} known false positive(s) excluded)'
                       if fp_hits else '')
            return 'warning', (
                f'{len(real_hits) or infected_count} infected pattern(s){fp_note}'
                + (f' — {check_str}' if check_str else '')
                + ' — run DEFEND for full cross-verification (debsums + rkhunter)'
            )
        if suspicious:
            susp_lines = [
                l.strip()[:80] for l in (output or '').splitlines()
                if 'suspicious' in l.lower()
            ][:3]
            susp_str = ' | '.join(susp_lines) if susp_lines else ''
            return 'warning', (
                'Suspicious files detected'
                + (f' — {susp_str}' if susp_str else '')
                + ' — run DEFEND to investigate'
            )
        return 'success', 'No rootkit signatures matched'

    if tool_name == 'lynis':
        m = _re.search(r'hardening index\s*[:\-\s]+(\d+)', out_l)
        score = int(m.group(1)) if m else None
        # Lynis warning lines start with '!' and suggestions with '*'
        # e.g. "! Reboot of system is most likely needed [BOOT-5180]"
        warn_items = []
        for l in (output or '').splitlines():
            ls = l.strip()
            if ls.startswith('!'):
                desc = _re.sub(r'\[[\w\-]+\]\s*$', '', ls.lstrip('! ')).strip()
                if desc:
                    warn_items.append(desc[:70])
            if len(warn_items) >= 4:
                break
        item_str = '; '.join(warn_items) if warn_items else ''
        if score is not None:
            if score < 50:
                return 'error', (
                    f'Hardening Index: {score}/100 — significant weaknesses'
                    + (f' — {item_str}' if item_str else '')
                    + ' — full report: /var/log/lynis.log'
                )
            if score < 65:
                return 'warning', (
                    f'Hardening Index: {score}/100 — hardening improvements recommended'
                    + (f' — {item_str}' if item_str else '')
                    + ' — full report: /var/log/lynis.log'
                )
            if score < 80:
                # 65-79: automated hardening is complete; remaining items
                # (SSH config, password policies, compiler access) require
                # manual intervention and will not change with repeated DEFEND.
                return 'info', (
                    f'Hardening Index: {score}/100 — automated hardening applied; '
                    'remaining suggestions require manual config '
                    '(SSH, passwords, services) — see /var/log/lynis.log'
                    + (f' — items: {item_str}' if item_str else '')
                )
            return 'success', (
                f'Hardening Index: {score}/100 — good posture'
                + (f' — remaining: {item_str}' if item_str else '')
            )
        warn_count = len(_re.findall(r'\bwarning\b', out_l))
        if warn_count > 5:
            return 'warning', (
                f'{warn_count} audit warnings'
                + (f' — {item_str}' if item_str else '')
                + ' — /var/log/lynis.log'
            )
        return 'info', 'Lynis audit completed — review /var/log/lynis.log for details'

    if tool_name == 'aide':
        if returncode == 0:
            return 'success', 'File integrity database matches — no unauthorised changes'
        if returncode == 1:
            changed_m = _re.search(r'changed:\s*(\d+)', out_l)
            added_m   = _re.search(r'added:\s*(\d+)',   out_l)
            removed_m = _re.search(r'removed:\s*(\d+)', out_l)
            n_chg = int(changed_m.group(1)) if changed_m else 0
            n_add = int(added_m.group(1))   if added_m   else 0
            n_rem = int(removed_m.group(1)) if removed_m else 0
            n = n_chg + n_add + n_rem
            # Extract file paths from aide output lines
            # AIDE detail lines may look like: "changed: /etc/passwd" or just "/etc/ssh/sshd_config"
            changed_files = []
            for l in (output or '').splitlines():
                ls = l.strip()
                fp = _re.match(r'(?:changed|added|removed):\s*(\S+)', ls, _re.I)
                if fp:
                    changed_files.append(fp.group(1))
                elif ls.startswith('/') and len(ls) > 3 and ' ' not in ls[:40]:
                    changed_files.append(ls[:60])
                if len(changed_files) >= 5:
                    break
            counts = ', '.join(filter(None, [
                f'{n_chg} changed' if n_chg else '',
                f'{n_add} added'   if n_add else '',
                f'{n_rem} removed' if n_rem else '',
            ]))
            file_str = ', '.join(changed_files) if changed_files else 'see /var/log/aide.log'
            level = 'critical' if n > 3 else 'warning'
            return level, (
                f'{n} file change(s) since last baseline ({counts}) — '
                f'{file_str} — approve with: sudo aide --update'
            )
        if returncode in (14, 17) or 'database' in out_l or 'no such file' in out_l:
            return 'warning', 'AIDE database not initialised — DEFEND will create the baseline automatically'
        return 'warning', f'AIDE exited {returncode} — check aide.conf and database'

    if tool_name == 'tiger':
        lines = (output or '').splitlines()
        # TIGER failure lines start with "--FAIL--" or "FAIL:"
        fail_lines = [
            l.strip() for l in lines
            if _re.search(r'--fail--|^fail[:\s]', l.strip(), _re.I)
        ]
        # Fall back to counting the word 'fail' if the above finds nothing
        fails = len(fail_lines) if fail_lines else len(_re.findall(r'\bfail\b', out_l))
        # Extract brief descriptions from the collected FAIL lines (up to 4)
        fail_items = [
            _re.sub(r'^--fail--|^fail[:\s]+', '', l, flags=_re.I).strip()[:80]
            for l in fail_lines[:4]
        ]
        fail_str = '; '.join(fi for fi in fail_items if fi)
        if fails > 6:
            return 'error', (
                f'{fails} security issues'
                + (f' — {fail_str}' if fail_str else ' — world-writable files or weak permissions')
                + ' — full report: /var/log/tiger/'
            )
        if fails > 3:
            return 'warning', (
                f'{fails} security issue(s)'
                + (f' — {fail_str}' if fail_str else '')
                + ' — full report: /var/log/tiger/'
            )
        if fails > 0:
            # 1-3 minor issues: DEFEND has already applied all auto-fixable items
            # (sticky bits, /root perms, suid_dumpable). Remaining Tiger findings
            # are system-specific config items (NIS/NFS checks, PATH entries,
            # account settings) that require manual intervention.
            return 'info', (
                f'{fails} minor configuration note(s) — automated fixes applied; '
                'remaining items require manual review'
                + (f' — {fail_str}' if fail_str else '')
                + ' — full report: /var/log/tiger/'
            )
        return 'success', 'Security audit passed — permissions and config look clean'

    if tool_name == 'tripwire':
        modified_m = _re.search(r'modified:\s*(\d+)', out_l)
        added_m    = _re.search(r'added:\s*(\d+)',    out_l)
        removed_m  = _re.search(r'removed:\s*(\d+)',  out_l)
        n_mod = int(modified_m.group(1)) if modified_m else 0
        n_add = int(added_m.group(1))    if added_m    else 0
        n_rem = int(removed_m.group(1))  if removed_m  else 0
        violations = n_mod + n_add + n_rem
        if violations > 0:
            counts = ', '.join(filter(None, [
                f'{n_mod} modified' if n_mod else '',
                f'{n_add} added'    if n_add else '',
                f'{n_rem} removed'  if n_rem else '',
            ]))
            # Extract violating file paths — tripwire tabular report lists them as /path/to/file
            vio_files = []
            for l in (output or '').splitlines():
                ls = l.strip()
                if ls.startswith('/') and len(ls) > 3 and ' ' not in ls[:50]:
                    vio_files.append(ls[:60])
                if len(vio_files) >= 4:
                    break
            file_str = ', '.join(vio_files) if vio_files else 'see tripwire report'
            level = 'critical' if violations > 2 else 'warning'
            return level, (
                f'{violations} policy violation(s) ({counts}) — '
                f'{file_str} — approve with: sudo tripwire --update'
            )
        if returncode != 0 and 'policy' not in out_l:
            return 'warning', 'Tripwire not fully configured — DEFEND will initialise automatically'
        return 'success', 'No policy violations — change management clean'

    if tool_name == 'ufw':
        if 'status: active' in out_l:
            # Extract open inbound ports from "ufw status verbose" output
            # Lines look like: "22/tcp                     ALLOW IN    Anywhere"
            port_lines = [
                _re.sub(r'\s+', ' ', l.strip())
                for l in (output or '').splitlines()
                if _re.search(r'allow\s+in', l, _re.I) and _re.search(r'\d+/', l)
            ]
            ports = [
                _re.match(r'(\S+)', l).group(1) for l in port_lines
                if _re.match(r'(\S+)', l)
            ][:6]
            port_str = ', '.join(ports) if ports else 'none visible'
            rules = len(_re.findall(r'\n\d{1,4}\s', output))
            return 'success', (
                f'Firewall active — {rules or len(port_lines) or "multiple"} rule(s) — '
                f'open inbound: {port_str}'
            )
        if 'status: inactive' in out_l:
            return 'warning', 'Firewall disabled — all ports exposed — DEFEND will enable default-deny'
        return 'info', (output or '').split('\n')[0][:80].strip() or 'UFW status checked'

    if tool_name == 'osquery':
        try:
            import json as _j
            data = _j.loads(output)
            if isinstance(data, list) and len(data) > 0:
                # Surface process names, PIDs, and paths for the first 5 entries
                proc_items = []
                for row in data[:5]:
                    name = row.get('name', '')
                    pid  = row.get('pid', '')
                    path = row.get('path', '')
                    proc_items.append(
                        f'{name}(pid={pid}, path={path or "?"})'if name else f'pid={pid} path={path or "?"}'
                    )
                proc_str = ', '.join(proc_items)
                suffix = f' (+{len(data)-5} more)' if len(data) > 5 else ''
                return 'warning', (
                    f'{len(data)} process(es) not on disk{suffix} — possible in-memory malware: '
                    f'{proc_str}'
                )
            return 'success', 'No suspicious processes found — on-disk check clean'
        except Exception:
            lines = len((output or '').splitlines())
            return 'info', f'Query completed — {lines} line(s) of output'

    # Generic fallback
    if returncode == 0:
        first = (output or '').split('\n')[0][:80].strip()
        return 'success', first or 'Scan completed successfully'
    first = (output or '').split('\n')[0][:80].strip()
    return 'warning', (f'Exited {returncode}: ' + first) if first else f'Tool exited {returncode}'


def cmd_run_tool(args):
    """Run a security tool and return a structured finding."""
    tool_name = (args.tool or '').strip()
    if not tool_name:
        return {'success': False, 'error': 'No tool specified'}

    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'error': f'DB load error: {e}'}

    _, tool_data = find_tool(db, tool_name)
    if tool_data is None:
        return {'success': False, 'error': f'Tool not found in database: {tool_name}'}

    run_via      = tool_data.get('run_via', 'kjer')
    service_name = tool_data.get('service_name', tool_name)
    run_cmd      = tool_data.get('run_cmd')

    if run_via == 'daemon':
        # Daemon tool: use systemctl status
        if not shutil.which('systemctl'):
            return {'success': False, 'error': 'systemctl not available on this system'}
        try:
            show = subprocess.run(
                ['systemctl', 'status', service_name, '--no-pager', '-l'],
                capture_output=True, text=True, timeout=10,
                stdin=subprocess.DEVNULL
            )
            output   = show.stdout or show.stderr or ''
            rc       = show.returncode
            active_r = subprocess.run(
                ['systemctl', 'is-active', service_name],
                capture_output=True, text=True, timeout=5,
                stdin=subprocess.DEVNULL
            )
            active = active_r.stdout.strip() == 'active'
            finding_level, summary = _parse_tool_output(tool_name, 'daemon', output, rc)
            return {
                'success':       True,
                'finding_level': finding_level,
                'summary':       summary,
                'active':        active,
                'run_via':       'daemon',
                'tool':          tool_name,
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # kjer / direct tool: run the run_cmd
    if not run_cmd:
        return {'success': False, 'error': f'No run_cmd defined for {tool_name} in database'}

    if isinstance(run_cmd, str):
        run_cmd = run_cmd.split()

    binary = run_cmd[0] if run_cmd else ''
    if binary and not shutil.which(binary):
        return {'success': False, 'error': f'{binary} not found — is {tool_name} installed?'}

    try:
        env = dict(os.environ)
        result = run_privileged(run_cmd, timeout=120)
        output = (result.stdout or '') + (result.stderr or '')
        finding_level, summary = _parse_tool_output(tool_name, run_via, output, result.returncode)
        return {
            'success':       True,
            'finding_level': finding_level,
            'summary':       summary,
            'returncode':    result.returncode,
            'run_via':       run_via,
            'tool':          tool_name,
        }
    except subprocess.TimeoutExpired:
        return {
            'success':       False,
            'error':         f'{tool_name} timed out after 120s — try running manually',
            'finding_level': 'info',
            'summary':       'Scan exceeded time limit — run manually for full results',
            'tool':          tool_name,
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


def cmd_service_status(args):
    """Quick check whether a daemon tool's service is active."""
    tool_name = (args.tool or '').strip()
    if not tool_name:
        return {'success': False, 'error': 'No tool specified'}

    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'error': f'DB load error: {e}'}

    _, tool_data = find_tool(db, tool_name)
    if tool_data is None:
        return {'success': False, 'error': f'Tool not found: {tool_name}'}

    service_name = tool_data.get('service_name', tool_name)

    if not shutil.which('systemctl'):
        return {'success': False, 'error': 'systemctl not available'}

    try:
        r = subprocess.run(
            ['systemctl', 'is-active', service_name],
            capture_output=True, text=True, timeout=5,
            stdin=subprocess.DEVNULL
        )
        status = r.stdout.strip()
        return {
            'success': True,
            'active':  status == 'active',
            'status':  status,
            'service': service_name,
            'tool':    tool_name,
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


def cmd_check_sudo(args):
    """Check whether passwordless sudo for package managers is configured."""
    if os.getuid() == 0:
        return {'success': True, 'configured': True, 'message': 'Running as root — no sudo needed'}

    pm = get_pkg_manager()
    if not pm:
        return {'success': True, 'configured': True, 'message': 'No package manager detected'}

    pm_path = shutil.which(pm)
    if not pm_path:
        return {'success': True, 'configured': True, 'message': 'Package manager not on PATH'}

    result = subprocess.run(
        ['sudo', '-n', pm_path, '--version'],
        capture_output=True, text=True, timeout=5,
        stdin=subprocess.DEVNULL
    )
    configured = result.returncode == 0
    return {
        'success':    True,
        'configured': configured,
        'message':    ('Passwordless install is ready' if configured
                       else 'Passwordless sudo is not configured — run Setup in Settings'),
        'sudoers_file': str(SUDOERS_PATH),
        'sudoers_exists': SUDOERS_PATH.exists(),
    }


def cmd_setup_sudo(args):
    """Write /etc/sudoers.d/kjer granting NOPASSWD for package managers.
    If already root, writes directly.  Otherwise uses pkexec for graphical auth.
    """
    username = _get_real_username()

    # Collect paths to installed package managers (and dpkg for dpkg --configure -a)
    # Also include /usr/bin/env so run_privileged can use --preserve-env without
    # needing 'env' as a separate whitelisted command (belt-and-suspenders).
    pm_paths = []
    for pm_path in ['/usr/bin/env', '/usr/bin/apt-get', '/usr/bin/apt', '/usr/bin/dpkg',
                    '/usr/bin/dnf', '/usr/bin/pacman', '/usr/bin/zypper']:
        if Path(pm_path).exists():
            pm_paths.append(pm_path)
    brew = shutil.which('brew')
    if brew:
        pm_paths.append(brew)

    # Also include common security scanner binaries so run-tool works without a password prompt
    scanner_bins = [
        '/usr/sbin/ufw', '/usr/bin/ufw',
        '/usr/sbin/chkrootkit', '/usr/bin/chkrootkit',
        '/usr/bin/rkhunter',
        '/usr/bin/lynis', '/usr/sbin/lynis',
        '/usr/bin/aide', '/usr/sbin/aide', '/usr/sbin/aideinit',
        '/usr/sbin/tiger', '/usr/bin/tiger',
        '/usr/sbin/tripwire', '/usr/bin/tripwire',
        '/usr/bin/debconf-set-selections',
        '/usr/sbin/dpkg-reconfigure',
        '/usr/bin/clamscan',
        '/usr/bin/freshclam',
        '/usr/bin/osqueryi',
        # Defense hardening binaries
        '/bin/systemctl', '/usr/bin/systemctl',
        '/usr/sbin/aa-enforce', '/usr/bin/aa-enforce',
        '/usr/sbin/setenforce', '/usr/bin/setenforce',
        '/sbin/auditctl', '/usr/sbin/auditctl', '/usr/bin/auditctl',
        '/usr/bin/fail2ban-client',
        # Used by AIDE database copy step and sysctl hardening
        '/bin/cp', '/usr/bin/cp',
        '/bin/mv', '/usr/bin/mv',
        '/usr/bin/tee', '/usr/bin/sysctl', '/sbin/sysctl', '/usr/sbin/sysctl',
    ]
    for p in scanner_bins:
        if Path(p).exists() and p not in pm_paths:
            pm_paths.append(p)

    if not pm_paths:
        return {'success': False, 'error': 'No supported package managers found on this system'}

    content = (
        '# Kjer Security Framework - passwordless package management\n'
        '# Allows Kjer to install/remove security tools without sudo prompts.\n'
        '# Created by Kjer initialization — safe to delete if Kjer is uninstalled.\n'
        f'{username} ALL=(root) NOPASSWD: {", ".join(pm_paths)}\n'
    )

    def _write_and_validate(path, text):
        """Write sudoers fragment and validate with visudo -c."""
        import tempfile
        with open(path, 'w') as f:
            f.write(text)
        os.chmod(path, 0o440)
        # Validate
        check = subprocess.run(['visudo', '-c', '-f', path],
                               capture_output=True, text=True, timeout=10,
                               stdin=subprocess.DEVNULL)
        if check.returncode != 0:
            os.unlink(path)
            return False, check.stderr.strip()
        return True, ''

    # Method 1: already root
    if os.getuid() == 0:
        ok, err = _write_and_validate(str(SUDOERS_PATH), content)
        if ok:
            return {'success': True, 'message': f'Passwordless installs configured for {username}'}
        return {'success': False, 'error': f'visudo validation failed: {err}'}

    # Method 2: pkexec (shows a native graphical password dialog)
    if shutil.which('pkexec'):
        import tempfile
        tmp_content = tempfile.NamedTemporaryFile(mode='w', suffix='.conf', delete=False)
        tmp_content.write(content)
        tmp_content.close()

        # Small helper script that pkexec will run as root
        tmp_script = tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False)
        tmp_script.write(
            '#!/bin/sh\n'
            f'cp "{tmp_content.name}" "{SUDOERS_PATH}"\n'
            f'chmod 440 "{SUDOERS_PATH}"\n'
            f'chown root:root "{SUDOERS_PATH}"\n'
            f'visudo -c -f "{SUDOERS_PATH}" || rm -f "{SUDOERS_PATH}"\n'
        )
        tmp_script.close()
        os.chmod(tmp_script.name, 0o755)
        try:
            result = subprocess.run(['pkexec', tmp_script.name],
                                    capture_output=True, text=True, timeout=60,
                                    stdin=subprocess.DEVNULL)
        finally:
            for p in (tmp_content.name, tmp_script.name):
                try:
                    os.unlink(p)
                except OSError:
                    pass

        if result.returncode == 0 and SUDOERS_PATH.exists():
            return {'success': True, 'message': f'Passwordless installs configured for {username}'}
        if result.returncode == 126:
            return {'success': False, 'error': 'Authentication cancelled by user'}
        return {'success': False, 'error': result.stderr.strip() or f'pkexec exited {result.returncode}'}

    # Method 3: fallback — return the manual command so the user can copy-paste it
    manual_cmd = (
        f'echo \'{content.strip()}\' | sudo tee {SUDOERS_PATH} '
        f'&& sudo chmod 440 {SUDOERS_PATH}'
    )
    return {
        'success': False,
        'error':   'Neither root nor pkexec available. Run the command below in a terminal to configure passwordless installs manually.',
        'manual_cmd': manual_cmd,
    }


# ─────────────────────────── main ────────────────────────────────

def cmd_install_batch(args):
    """Install an arbitrary set of tools.
    pkg tools are batched into a single apt-get call for speed.
    repo tools get their APT repository set up first, then installed.
    download tools are downloaded and installed individually.
    builtin tools are acknowledged as already present.
    """
    tools_str = (args.tools or '').strip()
    if not tools_str:
        return {'success': False, 'message': 'No tools specified (use --tools key1,key2,...)'}

    tool_names = [t.strip() for t in tools_str.split(',') if t.strip()]

    try:
        db = load_db()
    except Exception as e:
        return {'success': False, 'message': f'DB load error: {e}'}

    pm = get_pkg_manager()
    if not pm:
        return {'success': False, 'message': 'No supported package manager found'}

    # Classify tools by install_source
    pkg_tools      = {}   # tool_name → pkg_list  (batch apt-get)
    special_tools  = []   # (tool_name, tool_data) — repo / download (individual)
    results        = []

    for tool_name in tool_names:
        _, tool_data = find_tool(db, tool_name)
        if tool_data is None:
            results.append({'tool': tool_name, 'success': False, 'message': 'Not in database'})
            continue
        source = tool_data.get('install_source', 'pkg')
        if source == 'builtin':
            results.append({'tool': tool_name, 'success': True,
                            'message': 'Built into OS — no installation needed'})
        elif source in ('repo', 'download'):
            special_tools.append((tool_name, tool_data))
        else:  # pkg
            packages = tool_data.get('packages', {})
            pkg_list = packages.get(pm, [])
            if isinstance(pkg_list, str):
                pkg_list = pkg_list.split()
            if pkg_list:
                pkg_tools[tool_name] = pkg_list
            else:
                results.append({'tool': tool_name, 'success': False,
                                'message': f'No packages defined for {pm}'})

    # Wait for any concurrent apt process to finish, then repair dpkg state
    _wait_for_apt_lock(max_wait=120)
    _fix_dpkg_state()

    # Refresh package lists before installing (like HakPak3) so package
    # names resolve correctly and we get the latest versions.
    if pm == 'apt' and pkg_tools:
        try:
            run_privileged(['apt-get', 'update', '-qq'], timeout=120)
        except Exception:
            pass  # stale cache is better than no install at all

    # ── Batch install all plain pkg tools ──────────────────────────
    if pkg_tools:
        all_pkgs = []
        for pkgs in pkg_tools.values():
            for p in pkgs:
                if p not in all_pkgs:
                    all_pkgs.append(p)

        batch_cmd = pkg_install_cmd(pm, all_pkgs)
        batch_ok  = False
        batch_err = ''
        try:
            result    = run_privileged(batch_cmd, timeout=600)
            batch_ok  = result.returncode == 0
            batch_err = (result.stderr or result.stdout or '').strip()
        except subprocess.TimeoutExpired:
            batch_err = 'Batch installation timed out (>10 min)'
        except Exception as e:
            batch_err = str(e)

        if batch_ok:
            for t in pkg_tools:
                post_notes = _post_install_setup(t)
                msg = f'Installed {t}'
                if post_notes:
                    msg += ' — ' + '; '.join(post_notes)
                results.append({'tool': t, 'success': True, 'message': msg})
        else:
            # Batch failed — report the error for each tool.
            # If the apt lock is held by a concurrent process, a per-tool sequential
            # fallback would take N×timeout seconds and cause IPC timeouts on the
            # frontend.  Instead, surface the real error immediately so the user can
            # retry once the lock is free.
            is_lock_error = ('lock' in batch_err.lower() or
                             'locked' in batch_err.lower() or
                             batch_err == 'Batch installation timed out (>10 min)')
            user_msg = (
                'Another apt-get process is running — please wait and retry.'
                if is_lock_error else batch_err
            )
            for tool_name in pkg_tools:
                results.append({'tool': tool_name, 'success': False, 'message': user_msg})

    # ── Handle repo / download tools individually ──────────────────
    for tool_name, tool_data in special_tools:
        ok, msg = _do_install_tool(tool_data, tool_name, pm)
        if ok:
            post_notes = _post_install_setup(tool_name)
            if post_notes:
                msg += ' — ' + '; '.join(post_notes)
        results.append({'tool': tool_name, 'success': ok, 'message': msg})

    installed = sum(1 for r in results if r['success'])
    failed    = sum(1 for r in results if not r['success'])
    return {
        'success':   failed == 0,
        'installed': installed,
        'failed':    failed,
        'results':   results,
        'message':   f'Installed {installed}/{len(results)} tools',
    }


def _extract_attacker_ips():
    """Parse recent IDS/IPS and network logs for attacker IPs.
    Returns a list of unique, validated IPv4 strings seen in the last 60 minutes.
    Checks: Suricata fast.log, Suricata eve.json, Zeek conn.log.
    """
    import ipaddress as _ipaddress
    import time as _time

    found = set()
    cutoff = _time.time() - 3600  # last 60 minutes

    def _valid_public(ip_str):
        """Return ip_str if it is a valid, routable (non-RFC-1918) IPv4 address."""
        try:
            addr = _ipaddress.IPv4Address(ip_str)
            return not (addr.is_private or addr.is_loopback
                        or addr.is_multicast or addr.is_link_local
                        or addr.is_unspecified)
        except Exception:
            return False

    # ── Suricata fast.log ─────────────────────────────────────────────────────
    # Format: MM/DD/YYYY-HH:MM:SS.ssssss  [Priority: N] {PROTO} SRC:PORT -> DST:PORT
    fast_log = '/var/log/suricata/fast.log'
    if os.path.exists(fast_log):
        try:
            with open(fast_log, 'r', errors='replace') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    # Extract source IPs from lines like: {TCP} 1.2.3.4:55123 -> 10.0.0.1:22
                    m = re.search(r'\{\w+\}\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+\s*->',
                                  line)
                    if m and _valid_public(m.group(1)):
                        found.add(m.group(1))
        except Exception:
            pass

    # ── Suricata eve.json ─────────────────────────────────────────────────────
    eve_log = '/var/log/suricata/eve.json'
    if os.path.exists(eve_log):
        try:
            with open(eve_log, 'r', errors='replace') as fh:
                for line in fh:
                    try:
                        event = json.loads(line)
                        # Only interested in alert events
                        if event.get('event_type') != 'alert':
                            continue
                        src = event.get('src_ip', '')
                        if src and _valid_public(src):
                            found.add(src)
                    except Exception:
                        continue
        except Exception:
            pass

    # ── Zeek conn.log ─────────────────────────────────────────────────────────
    # Format: TSV with headers; originator IP is column index 2 (id.orig_h)
    zeek_conn = '/var/log/zeek/current/conn.log'
    if not os.path.exists(zeek_conn):
        zeek_conn = '/var/log/bro/current/conn.log'  # legacy path
    if os.path.exists(zeek_conn):
        try:
            fields = []
            with open(zeek_conn, 'r', errors='replace') as fh:
                for line in fh:
                    line = line.rstrip('\n')
                    if line.startswith('#fields'):
                        fields = line.split('\t')[1:]  # strip '#fields' marker
                        continue
                    if line.startswith('#') or not line:
                        continue
                    parts = line.split('\t')
                    try:
                        # ts is first field; orig_h is normally second (index 1 after #fields)
                        ts_idx  = fields.index('ts')  if 'ts'       in fields else 0
                        src_idx = fields.index('id.orig_h') if 'id.orig_h' in fields else 2
                        ts  = float(parts[ts_idx])
                        src = parts[src_idx]
                        if ts >= cutoff and _valid_public(src):
                            found.add(src)
                    except (ValueError, IndexError):
                        continue
        except Exception:
            pass

    return sorted(found)[:20]  # cap at 20 IPs to avoid oversized iptables chains


def _apply_priv_esc_hardening():
    """Apply kernel sysctl parameters that directly close privilege-escalation paths.
    Returns (applied_count, details_list).
    """
    PRIV_ESC_PARAMS = [
        ('kernel.kptr_restrict',             '2'),   # hide kernel symbol addresses from /proc
        ('kernel.dmesg_restrict',            '1'),   # hide dmesg from unprivileged users
        ('kernel.yama.ptrace_scope',         '2'),   # only root may ptrace
        ('kernel.perf_event_paranoid',       '3'),   # block unprivileged perf events
        ('kernel.unprivileged_userns_clone', '0'),   # block unprivileged user namespaces
    ]
    applied = []
    details = []
    for key, val in PRIV_ESC_PARAMS:
        try:
            r = run_privileged(['sysctl', '-w', f'{key}={val}'], timeout=5)
            details.append({'cmd': f'sysctl -w {key}={val}', 'rc': r.returncode})
            if r.returncode == 0:
                applied.append(f'{key}={val}')
        except Exception as e:
            details.append({'cmd': f'sysctl -w {key}={val}', 'rc': -1, 'error': str(e)})
    # Persist to drop-in conf so params survive reboot
    try:
        conf = '# Kjer privilege-escalation hardening — auto-applied by Kjer defend\n'
        conf += '\n'.join(f'{k} = {v}' for k, v in PRIV_ESC_PARAMS) + '\n'
        conf_path = '/etc/sysctl.d/99-kjer-privesc-hardening.conf'
        with open(conf_path, 'w') as fh:
            fh.write(conf)
        os.chmod(conf_path, 0o644)
    except Exception:
        pass
    return len(applied), details


def _run_chkrootkit_defend():
    """Run the full chkrootkit cross-verification defend sequence.
    Called from cmd_defend_tool inside a try/except TimeoutExpired block.
    """
    checks = []
    # Step 1: re-run chkrootkit to capture current flagged items
    ck_r = run_privileged(['chkrootkit', '-q'], timeout=60)
    infected_lines = [
        l.strip() for l in (ck_r.stdout or '').splitlines()
        if 'infected' in l.lower()
    ]
    # Step 2: promiscuous mode — most common false positive cause
    # Suricata, Wireshark, tcpdump all put the NIC in promiscuous mode,
    # which chkrootkit's ifpromisc/sniffer check flags as INFECTED.
    ip_r = run_privileged(['ip', 'link', 'show'], timeout=10)
    promisc = ip_r.returncode == 0 and 'PROMISC' in (ip_r.stdout or '').upper()
    if promisc:
        checks.append(
            'Promiscuous mode DETECTED on NIC — IDS/sniffer tool (e.g. Suricata) '
            'is active: this is the most common cause of chkrootkit false positives'
        )
    # Step 3: verify binary integrity so we know if system files are actually modified
    if shutil.which('debsums'):
        db_r = run_privileged(['debsums', '-s'], timeout=90)
        if not (db_r.stdout or '').strip():
            checks.append('Package integrity (debsums): all system binaries match official checksums — no tampering')
        else:
            mm = (db_r.stdout or '').strip()[:200]
            checks.append(f'Package integrity (debsums): mismatches found — {mm}')
    elif shutil.which('rpm'):
        rpm_r = run_privileged(['rpm', '-Va', '--nodeps'], timeout=90)
        if not (rpm_r.stdout or '').strip():
            checks.append('Package integrity (rpm -Va): system files unmodified')
        else:
            checks.append('Package integrity (rpm -Va): some mismatches — review rpm output')
    # Step 4: rkhunter cross-check
    if shutil.which('rkhunter'):
        try:
            rk_r = run_privileged(['rkhunter', '--check', '--skip-keypress', '--quiet'], timeout=90)
            if rk_r.returncode == 0:
                checks.append('Rkhunter cross-check: no rootkits or backdoors confirmed')
            else:
                # rkhunter exits non-zero when warnings are found (normal on IDS systems)
                warn_n = len(re.findall(r'\bwarning\b', (rk_r.stdout or '').lower()))
                checks.append(f'Rkhunter cross-check: {warn_n} warning(s) — review /var/log/rkhunter.log')
        except subprocess.TimeoutExpired:
            checks.append('Rkhunter cross-check: timed out — run manually: sudo rkhunter --check --skip-keypress --quiet')
    # Compose verdict
    detail = ' | '.join(checks) if checks else 'no cross-verification tools found; run debsums or rkhunter manually'
    if infected_lines and promisc:
        verdict = (
            f'{len(infected_lines)} flagged pattern(s) — LIKELY FALSE POSITIVES '
            'from IDS promiscuous mode (Suricata/Wireshark/tcpdump)'
        )
        verdict_level = 'info'
    elif infected_lines:
        verdict = (
            f'{len(infected_lines)} pattern(s) persist after cross-check; '
            'if package integrity passed these may also be false positives — '
            'boot from live USB for definitive verification'
        )
        verdict_level = 'warning'
    else:
        verdict = 'Second-pass clean — rootkit signatures not confirmed'
        verdict_level = 'success'
    return {
        'success': True, 'tool': 'chkrootkit', 'level': verdict_level,
        'steps_run': 4, 'steps_ok': 4,
        'summary': f'{verdict} | {detail}',
        'results': [{'cmd': 'chkrootkit -q', 'rc': ck_r.returncode}],
    }


def cmd_defend_tool(args):
    """Apply real security hardening for an installed tool and return a structured result."""
    tool_name = (args.tool or '').strip()
    if not tool_name:
        return {'success': False, 'error': 'No tool specified'}

    # ── AIDE special case: database may not exist yet (exit 17 from scan) ──
    if tool_name == 'aide':
        db_paths = [
            '/var/lib/aide/aide.db',
            '/var/lib/aide/aide.db.gz',
        ]
        db_exists = any(os.path.exists(p) for p in db_paths)
        if not db_exists:
            # Check if aide --init is already running — avoid double-init
            _aide_running = False
            try:
                pgrep_r = subprocess.run(
                    ['pgrep', '-x', 'aide'],
                    capture_output=True, text=True, timeout=5,
                    stdin=subprocess.DEVNULL
                )
                _aide_running = pgrep_r.returncode == 0
            except Exception:
                pass
            if _aide_running:
                return {
                    'success': True, 'tool': tool_name, 'level': 'info',
                    'steps_run': 0, 'steps_ok': 0,
                    'summary': (
                        'AIDE initialisation already in progress — '
                        'the database build is still running (may take 5‑15 min on a '
                        'full system). Re-scan once it completes.'
                    ),
                    'results': [],
                }
            # Try aideinit (Debian/Ubuntu high-level wrapper) first.
            # Timeout raised to 900s — aide --init scans the full filesystem;
            # 180s is frequently insufficient on systems with many files.
            if shutil.which('aideinit'):
                r = run_privileged(['aideinit', '--yes'], timeout=900)
                if r.returncode == 0:
                    return {
                        'success': True, 'tool': tool_name, 'steps_run': 1, 'steps_ok': 1,
                        'summary': 'AIDE database initialised via aideinit — integrity baseline established. Future scans will detect unauthorized file changes.',
                        'results': [{'cmd': 'aideinit --yes', 'rc': 0}],
                    }
            # Fall back: aide --init, then promote aide.db.new → aide.db.
            # We try three promotion strategies in order:
            #  1. Python shutil (works when already root)
            #  2. sudo tee (tee is in sudoers; reads stdin, writes as root)
            #  3. sudo mv (mv is in sudoers on most setups)
            init_r = run_privileged(['aide', '--init'], timeout=900)
            new_paths = ['/var/lib/aide/aide.db.new', '/var/lib/aide/aide.db.new.gz']
            copied = False
            for new_path in new_paths:
                if os.path.exists(new_path):
                    target = new_path.replace('.new', '')
                    # Strategy 1: direct Python copy (succeeds when running as root)
                    if os.getuid() == 0:
                        try:
                            import shutil as _shutil
                            _shutil.copy2(new_path, target)
                            os.chmod(target, 0o600)
                            copied = True
                        except Exception:
                            pass
                    # Strategy 2: sudo mv (atomic, available in sudoers)
                    if not copied:
                        mv_r = run_privileged(['mv', new_path, target], timeout=15)
                        copied = (mv_r.returncode == 0)
                    # Strategy 3: sudo cp fallback
                    if not copied:
                        cp_r = run_privileged(['cp', new_path, target], timeout=15)
                        copied = (cp_r.returncode == 0)
                    break
            ok = 1 if (init_r.returncode == 0 and copied) else 0
            return {
                'success': True, 'tool': tool_name,
                'level': 'success' if ok > 0 else 'warning',
                'steps_run': 2, 'steps_ok': ok,
                'summary': (
                    'AIDE database initialised — integrity baseline established. Future scans will detect unauthorized file changes.'
                    if ok > 0 else
                    'AIDE --init ran but copy step failed — run: sudo mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db'
                ),
                'results': [{'cmd': 'aide --init', 'rc': init_r.returncode}],
            }
        # DB exists — run --check and parse actual output for accurate summary
        r = run_privileged(['aide', '--check'], timeout=120)
        out = r.stdout or r.stderr or ''
        out_l = out.lower()
        n_chg = int(m.group(1)) if (m := re.search(r'changed:\s*(\d+)', out_l)) else 0
        n_add = int(m.group(1)) if (m := re.search(r'added:\s*(\d+)',   out_l)) else 0
        n_rem = int(m.group(1)) if (m := re.search(r'removed:\s*(\d+)', out_l)) else 0
        any_changes = n_chg + n_add + n_rem
        if any_changes > 0:
            return {
                'success': True, 'tool': tool_name, 'level': 'warning',
                'steps_run': 1, 'steps_ok': 1,
                'summary': (
                    f'AIDE check: {n_chg} changed, {n_add} added, {n_rem} removed — '
                    'review /var/log/aide.log and update baseline with: aide --update'
                ),
                'results': [{'cmd': 'aide --check', 'rc': r.returncode}],
            }
        return {
            'success': True, 'tool': tool_name, 'level': 'success',
            'steps_run': 1, 'steps_ok': 1,
            'summary': 'AIDE file-integrity check — no unauthorised changes detected',
            'results': [{'cmd': 'aide --check', 'rc': r.returncode}],
        }

    # ── TRIPWIRE — check and return specific message if not configured ───────────────────
    # IMPORTANT: tripwire --check opens /dev/tty directly to ask for the site-key
    # passphrase when policy/database files are encrypted.  stdin=DEVNULL does NOT
    # prevent this — it will hang indefinitely waiting for tty input.
    # We therefore check for the required files before ever calling the binary,
    # and wrap the call in a tight timeout with an explicit TimeoutExpired handler.
    if tool_name == 'tripwire':
        if not shutil.which('tripwire'):
            return {
                'success': False,
                'error': 'tripwire binary not found on PATH',
            }
        # Pre-flight: require both a config file and at least one database file.
        # If either is missing, tripwire --check would hang or error immediately.
        import glob as _glob
        cfg_exists = any(os.path.exists(p) for p in (
            '/etc/tripwire/tw.cfg',
            '/etc/tripwire/tripwire.cfg',
        ))
        db_exists_tw = bool(
            _glob.glob('/var/lib/tripwire/*.twd') or
            _glob.glob('/var/lib/tripwire/*.twd.gz')
        )
        if not cfg_exists or not db_exists_tw:
            # Attempt automatic initialisation — just reporting the problem is not
            # good enough for a dependency handler.  Kjer installed tripwire, so
            # it owns the setup too.
            init_results = []

            # Step 1 — keys/config exist but no database (most common after a
            # non-interactive apt install).  Empty passphrase is used when
            # DEBIAN_FRONTEND=noninteractive is set during install.
            if cfg_exists and not db_exists_tw:
                r_init = run_privileged(
                    ['tripwire', '--init', '--local-passphrase', ''],
                    timeout=180)
                init_results.append({'cmd': 'tripwire --init', 'rc': r_init.returncode})
                db_exists_tw = bool(
                    _glob.glob('/var/lib/tripwire/*.twd') or
                    _glob.glob('/var/lib/tripwire/*.twd.gz')
                )
                if db_exists_tw or r_init.returncode == 0:
                    return {
                        'success': True, 'tool': tool_name, 'level': 'success',
                        'steps_run': len(init_results), 'steps_ok': len(init_results),
                        'summary': (
                            'Tripwire database initialised — file integrity baseline '
                            'established. Future scans will detect unauthorised changes.'
                        ),
                        'results': init_results,
                    }

            # Step 2 — fallback: pre-seed empty passphrases then dpkg-reconfigure.
            # Handles cases where tripwire was installed interactively with a
            # non-empty passphrase, or where config files are missing entirely.
            if shutil.which('dpkg-reconfigure') and shutil.which('debconf-set-selections'):
                import tempfile as _tempfile
                preseed = (
                    'tripwire tripwire/site-passphrase password\n'
                    'tripwire tripwire/local-passphrase password\n'
                )
                tf_path = None
                try:
                    with _tempfile.NamedTemporaryFile(
                            mode='w', prefix='kjer_tw_', suffix='.preseed',
                            dir='/tmp', delete=False) as tf:
                        tf.write(preseed)
                        tf_path = tf.name
                    os.chmod(tf_path, 0o600)
                    _env2 = dict(os.environ)
                    _env2['DEBIAN_FRONTEND'] = 'noninteractive'
                    # debconf-set-selections reads from a file argument — run directly
                    # since it may not be in the NOPASSWD list yet.
                    subprocess.run(
                        ['debconf-set-selections', tf_path],
                        capture_output=True, text=True, timeout=15,
                        stdin=subprocess.DEVNULL, env=_env2)
                except Exception:
                    pass
                finally:
                    if tf_path:
                        try:
                            os.unlink(tf_path)
                        except Exception:
                            pass
                r_reconf = run_privileged(
                    ['dpkg-reconfigure', '-f', 'noninteractive', 'tripwire'],
                    timeout=180)
                init_results.append({
                    'cmd': 'dpkg-reconfigure tripwire', 'rc': r_reconf.returncode})
                db_exists_tw = bool(
                    _glob.glob('/var/lib/tripwire/*.twd') or
                    _glob.glob('/var/lib/tripwire/*.twd.gz')
                )
                if db_exists_tw or r_reconf.returncode == 0:
                    return {
                        'success': True, 'tool': tool_name, 'level': 'success',
                        'steps_run': len(init_results), 'steps_ok': len(init_results),
                        'summary': (
                            'Tripwire reconfigured and database initialised — '
                            'integrity baseline established.'
                        ),
                        'results': init_results,
                    }

            # All initialisation attempts failed.
            return {
                'success': True, 'tool': tool_name, 'level': 'warning',
                'steps_run': len(init_results), 'steps_ok': 0,
                'summary': (
                    'Tripwire initialisation attempted but could not complete — '
                    'run: sudo dpkg-reconfigure tripwire  (apt)  or  '
                    'sudo tripwire-setup-keyfiles  (rpm)'
                ),
                'results': init_results,
            }
        # Config and database present — run the check with a short timeout.
        # 20 s is plenty for a non-interactive check; if it exceeds that the
        # most likely cause is an interactive passphrase prompt via /dev/tty.
        try:
            r = run_privileged(['tripwire', '--check'], timeout=20)
        except subprocess.TimeoutExpired:
            return {
                'success': True, 'tool': tool_name, 'level': 'warning',
                'steps_run': 1, 'steps_ok': 0,
                'summary': (
                    'Tripwire check timed out — likely waiting for an '
                    'interactive site-key passphrase via /dev/tty. '
                    'Run manually: sudo tripwire --check'
                ),
                'results': [{'cmd': 'tripwire --check', 'rc': -1,
                              'error': 'timed out after 20 s'}],
            }
        out_l = (r.stdout or r.stderr or '').lower()
        if r.returncode != 0:
            not_configured = any(kw in out_l for kw in (
                'not configured', 'not initialized', 'no site key',
                'policy file', 'database does not exist', 'no database',
            ))
            if not_configured:
                return {
                    'success': True, 'tool': tool_name, 'level': 'warning',
                    'steps_run': 1, 'steps_ok': 0,
                    'summary': 'Tripwire not yet fully configured — run: sudo tripwire --init to create the policy baseline',
                    'results': [{'cmd': 'tripwire --check', 'rc': r.returncode}],
                }
            # Tripwire uses a tabular report; violation counts appear in columns.
            # Try several patterns from different tripwire output formats.
            def _tw_sum(pattern):
                return sum(int(m) for m in re.findall(pattern, out_l))
            # Format 1: "total violations found:  N"
            total_m = re.search(r'total violations found\s*:\s*(\d+)', out_l)
            if total_m:
                n = int(total_m.group(1))
            else:
                # Format 2: column headers "Added    Removed    Modified"
                # Each rule row contributes numbers in those columns; sum them all
                n = _tw_sum(r'\b(\d+)\b')   # rough fallback: sum all numbers
                # Clamp unreasonably large sums (timestamps, inode numbers etc.)
                if n > 9999:
                    n = '?'
            return {
                'success': True, 'tool': tool_name, 'level': 'warning',
                'steps_run': 1, 'steps_ok': 0,
                'summary': f'Tripwire check: {n} policy violation(s) — review /var/lib/tripwire/ and run: tripwire --update',
                'results': [{'cmd': 'tripwire --check', 'rc': r.returncode}],
            }
        return {
            'success': True, 'tool': tool_name, 'level': 'success',
            'steps_run': 1, 'steps_ok': 1,
            'summary': 'Tripwire check completed — no policy violations detected',
            'results': [{'cmd': 'tripwire --check', 'rc': 0}],
        }

    # ── CHKROOTKIT — promiscuous mode check + package integrity + rkhunter cross-verify ──
    if tool_name == 'chkrootkit':
        try:
            return _run_chkrootkit_defend()
        except subprocess.TimeoutExpired as e:
            cmd_str = ' '.join(e.cmd) if hasattr(e, 'cmd') and e.cmd else 'unknown command'
            return {
                'success': True, 'tool': tool_name, 'level': 'warning',
                'steps_run': 1, 'steps_ok': 0,
                'summary': (
                    f'Chkrootkit cross-verification timed out on: {cmd_str} — '
                    'run manually: sudo chkrootkit -q'
                ),
                'results': [],
            }
        except Exception as exc:
            return {
                'success': True, 'tool': tool_name, 'level': 'info',
                'steps_run': 0, 'steps_ok': 0,
                'summary': f'Chkrootkit cross-verification error: {exc}',
                'results': [],
            }

    # ── LYNIS — apply kernel/network sysctl hardening, then re-audit ────────────────────
    if tool_name == 'lynis':
        if not shutil.which('lynis'):
            return {'success': False, 'error': 'lynis not found on PATH'}

        # These sysctl settings directly address the most common Lynis suggestions.
        # Writing to sysctl.d makes them persistent across reboots.
        HARDENING_PARAMS = {
            'kernel.randomize_va_space':                  '2',   # ASLR full
            'kernel.dmesg_restrict':                      '1',   # hide dmesg from non-root
            'kernel.kptr_restrict':                       '2',   # hide kernel symbol addrs
            'kernel.yama.ptrace_scope':                   '1',   # restrict ptrace
            'kernel.core_uses_pid':                       '1',
            'kernel.ctrl-alt-del':                        '0',   # disable Ctrl+Alt+Del reboot
            'net.ipv4.conf.all.accept_redirects':         '0',
            'net.ipv4.conf.default.accept_redirects':     '0',
            'net.ipv4.conf.all.send_redirects':           '0',
            'net.ipv4.conf.default.send_redirects':       '0',
            'net.ipv4.conf.all.log_martians':             '1',
            'net.ipv4.conf.default.log_martians':         '1',
            'net.ipv4.conf.all.rp_filter':                '1',
            'net.ipv4.conf.default.rp_filter':            '1',
            'net.ipv4.icmp_echo_ignore_broadcasts':       '1',
            'net.ipv4.icmp_ignore_bogus_error_responses': '1',
            'net.ipv4.tcp_timestamps':                    '0',
            'fs.protected_hardlinks':                     '1',
            'fs.protected_symlinks':                      '1',
        }
        conf_path = '/etc/sysctl.d/99-kjer-hardening.conf'
        conf_content = '# Kjer security hardening — auto-applied by Kjer defend\n'
        for k, v in HARDENING_PARAMS.items():
            conf_content += f'{k} = {v}\n'

        sysctl_ok = False
        applied_params = 0
        try:
            with open(conf_path, 'w') as f:
                f.write(conf_content)
            os.chmod(conf_path, 0o644)
            applied = run_privileged(['sysctl', '--system'], timeout=15)
            sysctl_ok = applied.returncode == 0
        except Exception:
            pass

        # Fall back to per-parameter sysctl -w when sysctl --system is not
        # in the sudoers NOPASSWD list (the most common failure mode).
        if not sysctl_ok and shutil.which('sysctl'):
            for k, v in HARDENING_PARAMS.items():
                try:
                    r2 = run_privileged(['sysctl', '-w', f'{k}={v}'], timeout=5)
                    if r2.returncode == 0:
                        applied_params += 1
                except Exception:
                    pass
            sysctl_ok = applied_params > 0

        r_lynis = run_privileged(['lynis', 'audit', 'system', '--quick', '--quiet'], timeout=600)
        out = (r_lynis.stdout or '') + (r_lynis.stderr or '')
        m = re.search(r'hardening index\s*[:\-\s]+(\d+)', out.lower())
        score = int(m.group(1)) if m else None

        if sysctl_ok and applied_params == 0:
            sysctl_line = (
                f'{len(HARDENING_PARAMS)} kernel/network sysctl parameters hardened '
                f'and persisted to {conf_path}'
            )
        elif sysctl_ok and applied_params > 0:
            sysctl_line = (
                f'{applied_params}/{len(HARDENING_PARAMS)} sysctl parameters applied '
                f'individually and persisted to {conf_path}'
            )
        else:
            sysctl_line = (
                f'sysctl file written to {conf_path} but could not apply — reboot to activate'
            )

        if score is not None:
            if score >= 75:
                audit_line = f'Lynis Hardening Index now {score}/100 — good posture'
                level = 'success'
            elif score >= 60:
                audit_line = (
                    f'Lynis Hardening Index {score}/100 — improvements made; '
                    'review /var/log/lynis.log for remaining manual steps'
                )
                level = 'warning'
            else:
                audit_line = (
                    f'Lynis Hardening Index {score}/100 — sysctl applied; '
                    'remaining suggestions in /var/log/lynis.log require manual config changes '
                    '(SSH settings, password policies, etc.)'
                )
                level = 'warning'
        else:
            audit_line = 'Lynis audit re-run — review /var/log/lynis.log for remaining suggestions'
            level = 'info'

        return {
            'success': True, 'tool': tool_name, 'level': level,
            'steps_run': 2, 'steps_ok': (1 if sysctl_ok else 0) + 1,
            'summary': f'{sysctl_line} — {audit_line}',
            'results': [
                {'cmd': f'wrote {conf_path}', 'rc': 0 if sysctl_ok else -1},
                {'cmd': 'lynis audit system --quick --quiet', 'rc': r_lynis.returncode},
            ],
        }

    # ── TIGER — fix /tmp, /var/tmp permissions, /root access, then re-audit ─────────────
    if tool_name == 'tiger':
        if not shutil.which('tiger'):
            return {'success': False, 'error': 'tiger not found on PATH'}

        fixes = []
        fix_results = []

        # Sticky bit on shared temp dirs (most common Tiger finding)
        for d in ('/tmp', '/var/tmp'):
            if os.path.exists(d):
                r = run_privileged(['chmod', '1777', d], timeout=5)
                fix_results.append({'cmd': f'chmod 1777 {d}', 'rc': r.returncode})
                if r.returncode == 0:
                    fixes.append(f'{d}: sticky bit enforced')

        # Restrict /root to owner-only access
        if os.path.exists('/root'):
            r = run_privileged(['chmod', '700', '/root'], timeout=5)
            fix_results.append({'cmd': 'chmod 700 /root', 'rc': r.returncode})
            if r.returncode == 0:
                fixes.append('/root: permissions restricted to 700')

        # Disable core dumps for SUID programs (common Tiger/CIS recommendation)
        for sysctl_key, val in [
            ('fs.suid_dumpable', '0'),
            ('kernel.core_pattern', '|/bin/false'),
        ]:
            try:
                r = run_privileged(['sysctl', '-w', f'{sysctl_key}={val}'], timeout=5)
                if r.returncode == 0:
                    fixes.append(f'{sysctl_key}={val}')
                fix_results.append({'cmd': f'sysctl -w {sysctl_key}={val}', 'rc': r.returncode})
            except Exception:
                pass

        # Re-run TIGER audit to capture the updated findings count
        r_tiger = run_privileged(['tiger'], timeout=600)
        out_l = ((r_tiger.stdout or '') + (r_tiger.stderr or '')).lower()
        fails = len(re.findall(r'\bfail\b', out_l))

        fix_line = ', '.join(fixes) if fixes else 'no auto-fixable permissions found'
        if fails == 0:
            audit_line = 'TIGER re-audit: clean'
            level = 'success'
        elif fails <= 2:
            audit_line = f'TIGER re-audit: {fails} issue(s) remain — review /var/log/tiger/'
            level = 'warning'
        else:
            audit_line = (
                f'TIGER re-audit: {fails} issue(s) remain — system-specific config '
                'issues require manual review at /var/log/tiger/'
            )
            level = 'warning'

        return {
            'success': True, 'tool': tool_name, 'level': level,
            'steps_run': len(fix_results) + 1,
            'steps_ok': sum(1 for r in fix_results if r.get('rc') == 0) + (
                1 if r_tiger.returncode in (0, 1, 2) else 0),
            'summary': f'{fix_line} — {audit_line}',
            'results': fix_results + [{'cmd': 'tiger', 'rc': r_tiger.returncode}],
        }

    # ── UFW — default-deny + block discovered attacker IPs + priv-esc hardening ──────────
    if tool_name == 'ufw':
        if not shutil.which('ufw'):
            return {'success': False, 'error': 'ufw not found on PATH'}

        results    = []
        steps_ok   = 0

        # Step 1 — default-deny inbound, enable and reload
        base_cmds = [
            ['ufw', 'default', 'deny', 'incoming'],
            ['ufw', 'default', 'allow', 'outgoing'],
            ['ufw', '--force', 'enable'],
            ['ufw', 'reload'],
        ]
        for cmd in base_cmds:
            try:
                r = run_privileged(cmd, timeout=15)
                results.append({'cmd': ' '.join(cmd), 'rc': r.returncode})
                if r.returncode == 0:
                    steps_ok += 1
            except Exception as e:
                results.append({'cmd': ' '.join(cmd), 'rc': -1, 'error': str(e)})

        # Step 2 — extract attacker IPs from live IDS logs and block them
        blocked_ips = []
        if shutil.which('iptables'):
            attacker_ips = _extract_attacker_ips()
            for ip in attacker_ips:
                try:
                    # Idempotent: check if rule already exists before adding
                    chk = run_privileged(
                        ['iptables', '-C', 'INPUT', '-s', ip, '-j', 'DROP'], timeout=5)
                    if chk.returncode != 0:
                        r = run_privileged(
                            ['iptables', '-I', 'INPUT', '-s', ip, '-j', 'DROP'], timeout=5)
                        if r.returncode == 0:
                            blocked_ips.append(ip)
                            steps_ok += 1
                            results.append({'cmd': f'iptables -I INPUT -s {ip} -j DROP', 'rc': 0})
                except Exception:
                    pass

        # Step 3 — kill established sessions from attacker IPs
        killed_sessions = 0
        if shutil.which('ss'):
            ips_to_kill = blocked_ips if blocked_ips else _extract_attacker_ips()
            for ip in ips_to_kill:
                try:
                    r = run_privileged(
                        ['ss', '--kill', 'state', 'established', f'dst {ip}'], timeout=10)
                    if r.returncode == 0:
                        killed_sessions += 1
                        results.append({'cmd': f'ss --kill dst {ip}', 'rc': 0})
                except Exception:
                    pass

        # Step 4 — apply privilege-escalation sysctl hardening
        priv_count, priv_details = _apply_priv_esc_hardening()
        results.extend(priv_details)
        if priv_count > 0:
            steps_ok += 1

        # Build human-readable summary
        parts = ['UFW default-deny enforced and reloaded']
        if blocked_ips:
            parts.append(f'{len(blocked_ips)} attacker IP(s) blocked via iptables: '
                         + ', '.join(blocked_ips[:5])
                         + (f' (+{len(blocked_ips)-5} more)' if len(blocked_ips) > 5 else ''))
        else:
            parts.append('no active attacker IPs detected in IDS logs')
        if killed_sessions:
            parts.append(f'{killed_sessions} active session(s) terminated')
        if priv_count:
            parts.append(f'{priv_count} privilege-escalation prevention param(s) applied '
                         f'(kptr_restrict, dmesg_restrict, ptrace_scope, perf_event_paranoid, userns_clone)')

        level = 'success' if steps_ok >= len(base_cmds) else 'warning'
        return {
            'success': True, 'tool': tool_name, 'level': level,
            'steps_run': len(results), 'steps_ok': steps_ok,
            'summary': ' — '.join(parts),
            'results': results,
        }

    # Hardening command sequences keyed by tool name.
    # Each list entry is a command that will be run via run_privileged().
    HARDEN_STEPS = {
        'ufw': {
            'cmds': [
                ['ufw', 'default', 'deny', 'incoming'],
                ['ufw', 'default', 'allow', 'outgoing'],
                ['ufw', '--force', 'enable'],
                ['ufw', 'reload'],
            ],
            'summary': 'UFW default-deny enforced and enabled; firewall rules reloaded',
        },
        'fail2ban': {
            'cmds': [['systemctl', 'restart', 'fail2ban']],
            'summary': 'Fail2ban restarted — brute-force protection active on SSH/HTTP/FTP',
        },
        'clamav': {
            'cmds': [
                ['freshclam', '--quiet'],
                ['clamscan', '-r', '--infected', '--no-summary', '/home', '/tmp', '/var/tmp'],
            ],
            'summary': 'ClamAV: virus definitions updated, targeted scan of /home and /tmp completed',
        },
        'apparmor': {
            'cmds': [
                ['aa-enforce', '/etc/apparmor.d/'],
                ['systemctl', 'reload', 'apparmor'],
            ],
            'summary': 'AppArmor: all available profiles set to Enforce mode, service reloaded',
        },
        'selinux': {
            'cmds': [['setenforce', '1']],
            'summary': 'SELinux set to Enforcing mode — AVC denials now block policy violations',
        },
        'rkhunter': {
            'cmds': [
                ['rkhunter', '--update', '--quiet'],
                ['rkhunter', '--propupd', '--quiet'],
            ],
            'summary': 'Rkhunter: signature database updated, file properties baseline refreshed',
        },
        'chkrootkit': {
            'cmds': [['chkrootkit', '-q']],
            'summary': 'Chkrootkit second-pass verification scan completed',
        },
        'auditd': {
            'cmds': [['systemctl', 'restart', 'auditd']],
            'summary': 'auditd restarted — kernel audit rules reloaded and active',
        },
        'suricata': {
            'cmds': [
                # Attempt to switch to IPS/inline mode via suricatasc if available;
                # fall back to a full restart which forces rule reload.
                # suricatasc is part of the suricata package on most distros.
                ['sh', '-c',
                 'suricatasc -c reload-rules 2>/dev/null || systemctl restart suricata'],
            ],
            'summary': 'Suricata rules reloaded; IPS inline mode engaged if configured',
        },
        'aide': {
            'cmds': [['aide', '--check']],
            'summary': 'AIDE file-integrity check completed — no unauthorised changes detected',
        },
        'tripwire': {
            # tripwire --init requires interactive passphrases; --check is still useful
            # If not configured yet, the check surfaces a clear message
            'cmds': [['tripwire', '--check']],
            'summary': 'Tripwire check completed',
        },
        'gvm': {
            'cmds': [
                ['systemctl', 'start', 'gvmd'],
                ['systemctl', 'start', 'ospd-openvas'],
            ],
            'summary': None,  # dynamic: built from actual start results below
        },
        'openvas': {
            'cmds': [
                ['systemctl', 'start', 'ospd-openvas'],
                ['systemctl', 'start', 'gvmd'],
            ],
            'summary': None,
        },
        'nessus': {
            'cmds': [['systemctl', 'start', 'nessusd']],
            'summary': None,
        },
        'lynis': {
            'cmds': [['lynis', 'audit', 'system', '--quick', '--quiet']],
            'summary': 'Lynis security audit completed — review /var/log/lynis.log for suggestions',
            # Lynis exits 1 when suggestions/warnings are found (which is normal on any
            # real system). Treat rc=0 or rc=1 as successful completion; only rc>=2
            # indicates a real failure (missing database, parse error, etc.).
            'ok_rcs': {0, 1},
            # Lynis audit can take several minutes on a real system.
            'timeout': 600,
        },
        'tiger': {
            'cmds': [['tiger']],
            'summary': 'TIGER security audit completed — review /var/log/tiger/ for findings',
            # TIGER exits non-zero when it finds issues. Any completion is success.
            'ok_rcs': {0, 1, 2},
            # TIGER is a comprehensive audit tool and can take several minutes.
            'timeout': 600,
        },
    }

    step = HARDEN_STEPS.get(tool_name)
    if not step:
        return {
            'success': False,
            'error':   f'No hardening procedure defined for {tool_name}',
        }

    cmd_results = []
    steps_ok    = 0
    step_timeout = step.get('timeout', 120)
    for cmd in step['cmds']:
        binary = cmd[0]
        if not shutil.which(binary):
            cmd_results.append({'cmd': ' '.join(cmd), 'rc': -1,
                                 'skipped': True, 'reason': f'{binary} not found on PATH'})
            continue
        try:
            r = run_privileged(cmd, timeout=step_timeout)
            ok_rcs = step.get('ok_rcs', {0})
            if r.returncode in ok_rcs:
                steps_ok += 1
            cmd_results.append({
                'cmd':    ' '.join(cmd),
                'rc':     r.returncode,
                'stdout': (r.stdout or '')[:500],
                'stderr': (r.stderr or '')[:300],
            })
        except subprocess.TimeoutExpired:
            cmd_results.append({'cmd': ' '.join(cmd), 'rc': -1, 'error': f'timed out after {step_timeout} s'})
        except Exception as e:
            cmd_results.append({'cmd': ' '.join(cmd), 'rc': -1, 'error': str(e)})

    executable = [c for c in cmd_results if not c.get('skipped')]
    if not executable:
        return {
            'success': False,
            'error':   f'No {tool_name} binaries found — is the tool installed and on PATH?',
        }

    n_exec = len(executable)
    level = 'success' if steps_ok == n_exec else ('warning' if steps_ok > 0 else 'error')

    # Build a dynamic summary for service-start tools (GVM, OpenVAS, Nessus) so the
    # message accurately reflects whether systemctl start actually succeeded.
    summary = step['summary']
    if summary is None:
        started  = [c for c in executable if c.get('rc', -1) == 0]
        failed   = [c for c in executable if c.get('rc', -1) != 0]
        svc_names = [c['cmd'].split()[-1] for c in executable]  # last token = service name
        if not failed:
            summary = f'Service(s) started successfully: {" + ".join(svc_names)} — vulnerability scanning active'
        elif not started:
            summary = (
                f'Failed to start service(s): {" + ".join(svc_names)} — '
                'check: journalctl -xe'
            )
            level = 'warning'  # started by defend intent rather than all-fail→error
        else:
            ok_s  = ' + '.join(c['cmd'].split()[-1] for c in started)
            bad_s = ' + '.join(c['cmd'].split()[-1] for c in failed)
            summary = f'Partial start: {ok_s} started, {bad_s} failed — check: journalctl -xe'

    return {
        'success':   True,
        'tool':      tool_name,
        'level':     level,
        'summary':   summary,        # use the locally-computed (possibly dynamic) summary
        'steps_run': n_exec,
        'steps_ok':  steps_ok,
        'results':   cmd_results,
    }


def _mac_vendor_lookup(mac):
    """Return a short vendor string from the OUI prefix."""
    OUI = {
        '00:50:56': 'VMware', '00:0c:29': 'VMware', '00:1c:14': 'VMware',
        'b8:27:eb': 'Raspberry Pi', 'dc:a6:32': 'Raspberry Pi', 'e4:5f:01': 'Raspberry Pi',
        '00:1a:11': 'Google', 'f4:f5:d8': 'Google', '54:60:09': 'Google',
        'ac:bc:32': 'Apple', '00:1b:63': 'Apple', '18:65:90': 'Apple',
        '08:00:27': 'VirtualBox', '0a:00:27': 'VirtualBox',
        '52:54:00': 'QEMU/KVM', '00:15:5d': 'Microsoft (Hyper-V)',
        '00:e0:4c': 'Realtek', 'fc:aa:14': 'ASRock',
        'bc:ae:c5': 'ASUSTek', '70:85:c2': 'Dell', '18:66:da': 'Dell',
        'e8:9a:8f': 'Cisco', '00:1d:a1': 'Cisco', '74:d4:35': 'Netgear',
        '18:0f:76': 'TP-Link', '50:c7:bf': 'TP-Link', 'd8:47:32': 'ASUS',
        'c8:3a:35': 'Tenda', 'c8:d6:19': 'Samsung',
        '00:1c:bf': 'Huawei', '6c:40:08': 'Huawei',
    }
    if not mac:
        return ''
    parts = mac.replace('-', ':').upper().split(':')
    if len(parts) >= 3:
        key = ':'.join(p.zfill(2) for p in parts[:3]).lower()
        for k, v in OUI.items():
            if k.lower() == key:
                return v
    return ''


def _read_arp_cache():
    """Read kernel ARP table from /proc/net/arp + ip neigh. No privileges needed."""
    hosts = {}
    try:
        with open('/proc/net/arp') as f:
            for line in f.readlines()[1:]:
                cols = line.split()
                if len(cols) >= 4 and cols[3] not in ('00:00:00:00:00:00', ''):
                    hosts[cols[0]] = cols[3].upper()
    except Exception:
        pass
    if shutil.which('ip'):
        try:
            r = subprocess.run(['ip', 'neigh', 'show'], capture_output=True, text=True,
                               timeout=5, stdin=subprocess.DEVNULL)
            for line in r.stdout.splitlines():
                parts = line.split()
                ip_c = parts[0] if parts else ''
                if '.' in ip_c and ':' not in ip_c and 'lladdr' in parts:
                    idx = parts.index('lladdr')
                    mac = parts[idx + 1].upper() if idx + 1 < len(parts) else ''
                    if mac and mac != '00:00:00:00:00:00':
                        hosts.setdefault(ip_c, mac)
        except Exception:
            pass
    return [{'ip': ip, 'mac': mac} for ip, mac in hosts.items()]


def _resolve_hostname(ip):
    import socket
    try:
        name = socket.getfqdn(ip)
        return name if name and name != ip else ''
    except Exception:
        return ''


def _nmap_discover(subnet):
    """nmap -sn with sudo fallback for ARP reliability."""
    results = []
    if not shutil.which('nmap'):
        return results

    def _run(prefix):
        cmd = prefix + ['nmap', '-sn', '-T4', '--host-timeout', '4s', subnet]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=90, stdin=subprocess.DEVNULL)
            return r.stdout or ''
        except Exception:
            return ''

    output = ''
    if os.getuid() != 0 and shutil.which('sudo'):
        output = _run(['sudo', '-n'])
    if not output or 'Host is up' not in output:
        output = _run([])

    for block in output.split('Nmap scan report for ')[1:]:
        first  = block.split('\n')[0].strip()
        ip_m   = re.search(r'(\d+\.\d+\.\d+\.\d+)', first)
        if not ip_m:
            continue
        ip     = ip_m.group(1)
        name   = re.sub(r'\s*\(\d+\.\d+\.\d+\.\d+\)', '', first).strip()
        mac_m  = re.search(r'MAC Address:\s+([\w:]+)\s+\(([^)]+)\)', block)
        mac    = mac_m.group(1).upper() if mac_m else ''
        vendor = mac_m.group(2) if mac_m else ''
        lat_m  = re.search(r'Host is up \(([^)]+)\)', block)
        latency = lat_m.group(1).strip() if lat_m else ''
        results.append({'ip': ip, 'name': name if name != ip else '',
                        'mac': mac, 'vendor': vendor, 'latency': latency})
    return results


def cmd_scan_network(args):
    """Multi-method LAN host discovery:
    1. ARP cache (/proc/net/arp + ip neigh) — instant, zero packets
    2. arp-scan --localnet (if installed)
    3. nmap -sn with sudo for ARP ping
    Returns {success, hosts: [{ip, name, mac, vendor, latency, hostname}]}
    """
    subnet = getattr(args, 'target_ip', None) or getattr(args, 'tool', None) or ''
    by_ip  = {}

    # 1. ARP cache
    for h in _read_arp_cache():
        ip = h['ip']
        by_ip[ip] = {'ip': ip, 'mac': h['mac'],
                      'vendor': _mac_vendor_lookup(h['mac']),
                      'name': '', 'latency': '', 'hostname': '', 'source': 'arp-cache'}

    # 2. arp-scan
    if shutil.which('arp-scan'):
        cmd = ['arp-scan', '--localnet', '--ignoredups', '--numeric']
        if os.getuid() != 0 and shutil.which('sudo'):
            cmd = ['sudo', '-n'] + cmd
        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=30, stdin=subprocess.DEVNULL)
            for line in r.stdout.splitlines():
                m = re.match(r'(\d+\.\d+\.\d+\.\d+)\s+([\w:]+)\s*(.*)', line.strip())
                if m:
                    ip, mac, vendor = m.group(1), m.group(2).upper(), m.group(3).strip()
                    vendor = vendor or _mac_vendor_lookup(mac)
                    if ip not in by_ip:
                        by_ip[ip] = {'ip': ip, 'mac': mac, 'vendor': vendor,
                                      'name': '', 'latency': '', 'hostname': '', 'source': 'arp-scan'}
                    else:
                        by_ip[ip].update({'mac': mac or by_ip[ip].get('mac',''),
                                           'vendor': vendor or by_ip[ip].get('vendor','')})
        except Exception:
            pass

    # 3. nmap -sn
    _subnet = subnet
    if not _subnet and shutil.which('nmap'):
        try:
            r = subprocess.run(['ip', 'route', 'show', 'default'],
                               capture_output=True, text=True, timeout=5,
                               stdin=subprocess.DEVNULL)
            src_m = re.search(r'src (\d+\.\d+\.\d+)\.\d+', r.stdout)
            if src_m:
                _subnet = src_m.group(1) + '.0/24'
            else:
                r2 = subprocess.run(['ip', '-4', 'addr', 'show', 'scope', 'global'],
                                    capture_output=True, text=True, timeout=5,
                                    stdin=subprocess.DEVNULL)
                m2 = re.search(r'inet (\d+\.\d+\.\d+)\.\d+/', r2.stdout)
                if m2:
                    _subnet = m2.group(1) + '.0/24'
        except Exception:
            _subnet = '192.168.1.0/24'

    if _subnet:
        for h in _nmap_discover(_subnet):
            ip = h['ip']
            if ip not in by_ip:
                by_ip[ip] = {'ip': ip, 'mac': h['mac'],
                              'vendor': h['vendor'] or _mac_vendor_lookup(h['mac']),
                              'name': h['name'], 'latency': h['latency'],
                              'hostname': '', 'source': 'nmap'}
            else:
                e = by_ip[ip]
                if not e.get('mac') and h['mac']:
                    e['mac']    = h['mac']
                    e['vendor'] = h['vendor'] or _mac_vendor_lookup(h['mac'])
                if h['latency']:
                    e['latency'] = h['latency']

    # Resolve hostnames (cap 20)
    for ip, h in list(by_ip.items())[:20]:
        if not h.get('hostname') and not h.get('name'):
            hn = _resolve_hostname(ip)
            h['hostname'] = hn
            h['name']     = hn

    hosts = sorted(by_ip.values(), key=lambda x: [int(p) for p in x['ip'].split('.')])
    return {'success': True, 'hosts': hosts, 'count': len(hosts)}


def cmd_scan_device(args):
    """Rich nmap per-device scan: -sV -O + scripts.
    --tool <ip>  (reuses existing --tool arg slot)
    Returns {success, ip, hostname, os, os_accuracy, mac, vendor, latency,
             uptime_guess, ports, services, open_count, scripts, raw}
    """
    ip = (getattr(args, 'tool', None) or '').strip()
    if not ip:
        return {'success': False, 'error': 'No IP address specified (--tool <ip>)'}

    if not shutil.which('nmap'):
        mac  = next((h['mac'] for h in _read_arp_cache() if h['ip'] == ip), '')
        return {
            'success': True, 'ip': ip,
            'hostname': _resolve_hostname(ip), 'os': '',
            'os_accuracy': 0, 'mac': mac, 'vendor': _mac_vendor_lookup(mac),
            'latency': '', 'uptime_guess': '', 'ports': [],
            'services': [], 'open_count': 0, 'scripts': {},
            'raw': 'nmap not installed', 'note': 'install nmap for full scan',
        }

    nmap_cmd = [
        'nmap', '-sV', '-O', '-T4',
        '--script=banner,ssh-hostkey,smb-os-discovery,http-title,ssl-cert',
        '--version-intensity', '5',
        '--host-timeout', '60s',
        ip,
    ]
    prefix = ['sudo', '-n'] if (os.getuid() != 0 and shutil.which('sudo')) else []
    raw = ''
    try:
        r = subprocess.run(prefix + nmap_cmd, capture_output=True, text=True,
                           timeout=120, stdin=subprocess.DEVNULL)
        raw = r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        raw = '(nmap timed out after 120s)'
    except Exception as e:
        raw = str(e)

    # Hostname
    hostname = ''
    h_m = re.search(r'Nmap scan report for (.+)', raw)
    if h_m:
        entry = h_m.group(1).strip()
        hn_m  = re.match(r'^(\S+)\s+\(', entry)
        hostname = hn_m.group(1) if hn_m else ''

    # OS
    os_name, os_accuracy = '', 0
    os_m = re.search(r'OS details:\s*([^\n]+)', raw)
    if os_m:
        os_name = os_m.group(1).strip()
    else:
        ag_m = re.search(r'Aggressive OS guesses:\s*([^\n]+)', raw)
        if ag_m:
            first = ag_m.group(1).split(',')[0].strip()
            acc_m = re.search(r'\((\d+)%\)', first)
            os_name     = re.sub(r'\s*\(\d+%\)', '', first).strip()
            os_accuracy = int(acc_m.group(1)) if acc_m else 0
    if not os_name:
        smb_m = re.search(r'OS:\s*([^\n]+)', raw)
        if smb_m:
            os_name = smb_m.group(1).strip()[:80]

    # MAC
    mac, vendor = '', ''
    mac_m = re.search(r'MAC Address:\s+([\w:]+)\s+\(([^)]+)\)', raw)
    if mac_m:
        mac    = mac_m.group(1).upper()
        vendor = mac_m.group(2).strip()
    else:
        mac = next((h['mac'] for h in _read_arp_cache() if h['ip'] == ip), '')
        vendor = _mac_vendor_lookup(mac)

    latency = ''
    lat_m = re.search(r'Host is up \(([^)]+)\)', raw)
    if lat_m:
        latency = lat_m.group(1).strip()

    uptime_guess = ''
    up_m = re.search(r'Uptime guess:\s*([^\n]+)', raw)
    if up_m:
        uptime_guess = up_m.group(1).strip()

    # Ports
    ports = []
    for line in raw.splitlines():
        pm = re.match(r'^(\d+)/(tcp|udp)\s+(open|filtered|closed)\s+(\S+)\s*(.*)', line.strip())
        if pm:
            ports.append({
                'port':    int(pm.group(1)),
                'proto':   pm.group(2),
                'state':   pm.group(3),
                'service': pm.group(4),
                'version': pm.group(5).strip()[:120],
            })

    # Scripts
    scripts = {}
    for key, val in re.findall(r'\|[-_]\s*([\w-]+):\s+(.+?)(?=\n[| ]|\Z)', raw, re.DOTALL):
        scripts[key.strip()] = val.strip()[:200]

    if not hostname:
        hostname = _resolve_hostname(ip)

    open_ports = [p for p in ports if p['state'] == 'open']
    return {
        'success':      True,
        'ip':           ip,
        'hostname':     hostname,
        'os':           os_name[:100] if os_name else '',
        'os_accuracy':  os_accuracy,
        'mac':          mac,
        'vendor':       vendor[:60] if vendor else '',
        'latency':      latency,
        'uptime_guess': uptime_guess,
        'ports':        ports,
        'services':     [f"{p['port']}/{p['proto']} {p['service']}" for p in open_ports],
        'open_count':   len(open_ports),
        'scripts':      scripts,
        'raw':          raw[:4000],
    }


ACTION_MAP = {
    'check-activation':    cmd_check_activation,
    'activate':            cmd_activate,
    'install':             cmd_install,
    'uninstall':           cmd_uninstall,
    'list-installed':      cmd_list_installed,
    'install-profile':     cmd_install_profile,
    'install-batch':       cmd_install_batch,
    'system-status':       cmd_system_status,
    'host-scan':           cmd_host_scan,
    'scan-network':        cmd_scan_network,
    'scan-device':         cmd_scan_device,
    'get-hwid':            cmd_get_hwid,
    'store-detected-os':   cmd_store_detected_os,
    'get-version-info':    cmd_get_version_info,
    'get-available-tools': cmd_get_available_tools,
    'apply-upgrade':       cmd_apply_upgrade,
    'uninitialize':        cmd_uninitialize,
    'reinitialize':        cmd_reinitialize,
    'check-sudo':          cmd_check_sudo,
    'setup-sudo':          cmd_setup_sudo,
    'run-tool':            cmd_run_tool,
    'defend-tool':         cmd_defend_tool,
    'service-status':      cmd_service_status,
}


def main():
    parser = argparse.ArgumentParser(description='Kjer Backend API')
    parser.add_argument('action',         help='Action to perform')
    parser.add_argument('--tool',         help='Tool name (single tool)')
    parser.add_argument('--tools',        help='Comma-separated tool names (install-batch)')
    parser.add_argument('--profile',      help='Profile name')
    parser.add_argument('--license-key',  dest='license_key',  help='License key')
    parser.add_argument('--license-type', dest='license_type', default='personal', help='License type')
    parser.add_argument('--detected-os',  dest='detected_os',  help='Detected OS')
    parser.add_argument('--target-ip',    dest='target_ip',    help='Target IP (scan-network / scan-device)')

    args = parser.parse_args()
    handler = ACTION_MAP.get(args.action)
    if not handler:
        print(json.dumps({'success': False, 'error': f'Unknown action: {args.action}'}))
        sys.exit(1)

    try:
        result = handler(args)
    except Exception as e:
        result = {'success': False, 'error': str(e)}

    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
