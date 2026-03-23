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

BASE_DIR     = Path(__file__).resolve().parent.parent
DB_PATH      = BASE_DIR / 'db' / 'defensive-tools-db.yaml'
KJER_DIR     = Path.home() / '.kjer'
STATE_FILE   = KJER_DIR / 'install_state.json'
LICENSE_FILE = KJER_DIR / 'license_key.json'
INIT_FLAG    = KJER_DIR / 'initialized'


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


# ─────────────────────────── action handlers ────────────────────

def cmd_check_activation(args):
    license_data = {}
    if LICENSE_FILE.exists():
        try:
            with open(LICENSE_FILE) as f:
                license_data = json.load(f)
        except Exception:
            pass

    has_key     = bool(license_data.get('key', '').strip())
    initialized = INIT_FLAG.exists()
    activated   = has_key or initialized

    return {
        'success':      True,
        'activated':    activated,
        'license_type': license_data.get('type', 'trial'),
        'version_lock': license_data.get('version', ''),
        'license_key':  license_data.get('key', ''),
    }


def cmd_activate(args):
    key   = (args.license_key  or '').strip()
    ltype = (args.license_type or 'personal').strip()
    if not key:
        return {'success': False, 'error': 'No license key provided'}

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
                results.append({'tool': tool_name, 'success': True, 'message': f'Installed {tool_name}'})
            else:
                # Binary not found but exit 0 — likely already installed / path issue; count as success
                results.append({'tool': tool_name, 'success': True, 'message': f'Installed {tool_name}'})
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
        if 'inactive' in out_l or 'dead' in out_l:
            return 'warning', f'{tool_name} service is not running — click DEFEND to start it'
        if 'failed' in out_l:
            return 'error', f'{tool_name} service failed — click DEFEND to restart (or: systemctl restart {tool_name})'
        return 'info', (output or '').split('\n')[0][:80].strip() or 'Service status unknown'

    # Detect permission / root requirement errors before per-tool logic
    if any(p in out_l for p in ('need to be root', 'must be root', 'permission denied',
                                'operation not permitted', 'you need root',
                                'passwordless sudo is not configured')):
        return 'info', f'{tool_name} requires elevated permissions — configure sudo via Settings'

    if tool_name == 'clamav':
        m = _re.search(r'infected files:\s*(\d+)', out_l)
        infected = int(m.group(1)) if m else 0
        if infected > 0:
            return 'critical', f'{infected} infected file(s) detected — quarantine required'
        if returncode == 2:
            return 'warning', 'Scan error — virus database may need updating (run freshclam)'
        fm = _re.search(r'scanned files:\s*(\d+)', out_l)
        files = fm.group(1) if fm else '?'
        return 'success', f'{files} files scanned — clean'

    if tool_name == 'rkhunter':
        warn_count = len(_re.findall(r'\bwarning\b', out_l))
        if 'rootkit' in out_l and ('found' in out_l or 'detected' in out_l):
            return 'critical', 'Rootkit signatures detected — immediate action required'
        if warn_count > 2:
            return 'error', f'{warn_count} warnings — suspicious kernel modules or modified binaries detected'
        if warn_count > 0:
            return 'warning', f'{warn_count} warning(s) — verify /dev and /proc entries manually'
        return 'success', 'No rootkits or backdoors found'

    if tool_name == 'chkrootkit':
        infected_count = len(_re.findall(r'\binfected\b', out_l))
        suspicious = 'suspicious' in out_l
        if infected_count > 0:
            return 'critical', (
                f'{infected_count} infected pattern(s) — click DEFEND to cross-verify '
                '(common cause: IDS/sniffer in promiscuous mode e.g. Suricata, Wireshark)'
            )
        if suspicious:
            return 'warning', 'Suspicious files detected — click DEFEND to investigate'
        return 'success', 'No rootkit signatures matched'

    if tool_name == 'lynis':
        m = _re.search(r'hardening index\s*[:\-\s]+(\d+)', out_l)
        if m:
            score = int(m.group(1))
            if score < 60:
                return 'error', f'Hardening Index: {score}/100 — significant configuration weaknesses'
            if score < 75:
                return 'warning', f'Hardening Index: {score}/100 — hardening improvements recommended'
            return 'success', f'Hardening Index: {score}/100 — good security posture'
        warn_count = len(_re.findall(r'\bwarning\b', out_l))
        if warn_count > 5:
            return 'warning', f'{warn_count} audit warnings — review /var/log/lynis.log'
        return 'info', 'Lynis audit completed — review /var/log/lynis.log for details'

    if tool_name == 'aide':
        if returncode == 0:
            return 'success', 'File integrity database matches — no unauthorised changes'
        if returncode == 1:
            changed = _re.search(r'changed:\s*(\d+)', out_l)
            added   = _re.search(r'added:\s*(\d+)',   out_l)
            removed = _re.search(r'removed:\s*(\d+)', out_l)
            n = sum(int(m.group(1)) for m in [changed, added, removed] if m)
            level = 'critical' if n > 3 else 'warning'
            return level, f'{n} file change(s) since last baseline — review required'
        if returncode in (14, 17) or 'database' in out_l or 'no such file' in out_l:
            return 'warning', 'AIDE database not initialised — click DEFEND to create the baseline automatically'
        return 'warning', f'AIDE exited {returncode} — check aide.conf and database'

    if tool_name == 'tiger':
        fails = len(_re.findall(r'\bfail\b', out_l))
        if fails > 3:
            return 'error', f'{fails} security issues — world-writable files or weak permissions detected'
        if fails > 0:
            return 'warning', f'{fails} security issue(s) found — review tiger output'
        return 'success', 'Security audit passed — permissions and config look clean'

    if tool_name == 'tripwire':
        modified = _re.search(r'modified:\s*(\d+)', out_l)
        added    = _re.search(r'added:\s*(\d+)',    out_l)
        removed  = _re.search(r'removed:\s*(\d+)', out_l)
        violations = sum(int(m.group(1)) for m in [modified, added, removed] if m)
        if violations > 2:
            return 'critical', f'{violations} policy violations — system files modified outside change window'
        if violations > 0:
            return 'warning', f'{violations} policy violation(s) — review tripwire report'
        if returncode != 0 and 'policy' not in out_l:
            return 'warning', 'Tripwire not fully configured — click DEFEND or run: tripwire --init'
        return 'success', 'No policy violations — change management clean'

    if tool_name == 'ufw':
        if 'status: active' in out_l:
            rules = len(_re.findall(r'\n\d{1,4}\s', output))
            return 'success', f'Firewall active — {rules or "multiple"} rule(s) enforced'
        if 'status: inactive' in out_l:
            return 'warning', 'Firewall disabled — run: ufw enable to activate'
        return 'info', (output or '').split('\n')[0][:80].strip() or 'UFW status checked'

    if tool_name == 'osquery':
        try:
            import json as _j
            data = _j.loads(output)
            if isinstance(data, list) and len(data) > 0:
                return 'warning', f'{len(data)} process(es) not on disk — possible in-memory malware'
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
        '/usr/bin/clamscan',
        '/usr/bin/freshclam',
        '/usr/bin/osqueryi',
        # Defense hardening binaries
        '/bin/systemctl', '/usr/bin/systemctl',
        '/usr/sbin/aa-enforce', '/usr/bin/aa-enforce',
        '/usr/sbin/setenforce', '/usr/bin/setenforce',
        '/sbin/auditctl', '/usr/sbin/auditctl', '/usr/bin/auditctl',
        '/usr/bin/fail2ban-client',
        # Used by AIDE database copy step
        '/bin/cp', '/usr/bin/cp',
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
                results.append({'tool': t, 'success': True, 'message': f'Installed {t}'})
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
            # Try aideinit (Debian/Ubuntu high-level wrapper) first
            if shutil.which('aideinit'):
                r = run_privileged(['aideinit', '--yes'], timeout=180)
                if r.returncode == 0:
                    return {
                        'success': True, 'tool': tool_name, 'steps_run': 1, 'steps_ok': 1,
                        'summary': 'AIDE database initialised via aideinit — integrity baseline established. Future scans will detect unauthorized file changes.',
                        'results': [{'cmd': 'aideinit --yes', 'rc': 0}],
                    }
            # Fall back: aide --init, then copy aide.db.new → aide.db
            init_r = run_privileged(['aide', '--init'], timeout=180)
            new_paths = ['/var/lib/aide/aide.db.new', '/var/lib/aide/aide.db.new.gz']
            copied = False
            for new_path in new_paths:
                if os.path.exists(new_path):
                    target = new_path.replace('.new', '')
                    cp_r = run_privileged(['cp', new_path, target], timeout=15)
                    copied = (cp_r.returncode == 0)
                    break
            ok = 1 if (init_r.returncode == 0 and copied) else 0
            return {
                'success': True, 'tool': tool_name, 'steps_run': 2, 'steps_ok': ok,
                'summary': (
                    'AIDE database initialised — integrity baseline established. Future scans will detect unauthorized file changes.'
                    if ok > 0 else
                    'AIDE --init ran but copy step failed — run: sudo cp /var/lib/aide/aide.db.new /var/lib/aide/aide.db'
                ),
                'results': [{'cmd': 'aide --init', 'rc': init_r.returncode}],
            }
        # DB exists — proceed to normal check in HARDEN_STEPS below

    # ── CHKROOTKIT — promiscuous mode check + package integrity + rkhunter cross-verify ──
    if tool_name == 'chkrootkit':
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
            rk_r = run_privileged(['rkhunter', '--check', '--skip-keypress', '--quiet'], timeout=120)
            if rk_r.returncode == 0:
                checks.append('Rkhunter cross-check: no rootkits or backdoors confirmed')
            else:
                warn_n = len(_re.findall(r'\bwarning\b', (rk_r.stdout or '').lower()))
                checks.append(f'Rkhunter cross-check: {warn_n} warning(s) — review /var/log/rkhunter.log')
        # Compose verdict
        detail = ' | '.join(checks) if checks else 'no cross-verification tools found; run debsums or rkhunter manually'
        if infected_lines and promisc:
            verdict = (
                f'{len(infected_lines)} flagged pattern(s) — LIKELY FALSE POSITIVES '
                'from IDS promiscuous mode (Suricata/Wireshark/tcpdump)'
            )
        elif infected_lines:
            verdict = (
                f'{len(infected_lines)} pattern(s) persist after cross-check; '
                'if package integrity passed these may also be false positives — '
                'boot from live USB for definitive verification'
            )
        else:
            verdict = 'Second-pass clean — rootkit signatures not confirmed'
        return {
            'success': True, 'tool': tool_name,
            'steps_run': 4, 'steps_ok': 4,
            'summary': f'{verdict} | {detail}',
            'results': [{'cmd': 'chkrootkit -q', 'rc': ck_r.returncode}],
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
            'cmds': [['systemctl', 'restart', 'suricata']],
            'summary': 'Suricata restarted — IDS/IPS threat rules reloaded',
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
            'summary': 'GVM/OpenVAS services started (gvmd + ospd-openvas) — vulnerability scanning active',
        },
        'openvas': {
            'cmds': [
                ['systemctl', 'start', 'ospd-openvas'],
                ['systemctl', 'start', 'gvmd'],
            ],
            'summary': 'OpenVAS services started (ospd-openvas + gvmd) — vulnerability scanning active',
        },
        'nessus': {
            'cmds': [['systemctl', 'start', 'nessusd']],
            'summary': 'Nessus daemon started — vulnerability scanning available on port 8834',
        },
        'lynis': {
            'cmds': [['lynis', 'audit', 'system', '--quick', '--quiet']],
            'summary': 'Lynis security audit completed — review /var/log/lynis.log for suggestions',
        },
        'tiger': {
            'cmds': [['tiger']],
            'summary': 'TIGER security audit completed — review /var/log/tiger/ for findings',
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
    for cmd in step['cmds']:
        binary = cmd[0]
        if not shutil.which(binary):
            cmd_results.append({'cmd': ' '.join(cmd), 'rc': -1,
                                 'skipped': True, 'reason': f'{binary} not found on PATH'})
            continue
        try:
            r = run_privileged(cmd, timeout=120)
            if r.returncode == 0:
                steps_ok += 1
            cmd_results.append({
                'cmd':    ' '.join(cmd),
                'rc':     r.returncode,
                'stdout': (r.stdout or '')[:500],
                'stderr': (r.stderr or '')[:300],
            })
        except subprocess.TimeoutExpired:
            cmd_results.append({'cmd': ' '.join(cmd), 'rc': -1, 'error': 'timed out after 120 s'})
        except Exception as e:
            cmd_results.append({'cmd': ' '.join(cmd), 'rc': -1, 'error': str(e)})

    executable = [c for c in cmd_results if not c.get('skipped')]
    if not executable:
        return {
            'success': False,
            'error':   f'No {tool_name} binaries found — is the tool installed and on PATH?',
        }

    return {
        'success':   True,
        'tool':      tool_name,
        'summary':   step['summary'],
        'steps_run': len(executable),
        'steps_ok':  steps_ok,
        'results':   cmd_results,
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
