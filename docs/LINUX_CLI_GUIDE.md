# Kjer - Linux Security Framework CLI

## Overview

Kjer is a professional security framework that intelligently manages and deploys multiple security tools on Linux systems. The CLI provides command-line access to Kjer's security management capabilities, allowing you to quickly deploy security profiles and manage individual tools.

## Installation

### Prerequisites
- Linux operating system (Ubuntu, Debian, CentOS, Fedora, etc.)
- Python 3.6 or higher
- Root/sudo access for tool installation

### Quick Start (Recommended)

```bash
# 1. Run the cross-platform initializer (auto-detects Linux)
cd installer
sudo bash init-kjer.sh

# 2. Use the CLI from anywhere
kjer --help
kjer info
kjer list-tools
```

> The CLI is only set up if Linux is detected. On Windows, a PowerShell CLI is installed instead.

### Manual CLI Usage (Advanced)

```bash
# Make the CLI executable
chmod +x scripts/kjer-cli.py

# Run directly (from project directory)
./scripts/kjer-cli.py --help
```

## Commands

### View Available Tools & Profiles

#### List all tools
```bash
./scripts/kjer-cli.py list-tools
```
Displays all available security tools organized by category.

#### List tools by category
```bash
./scripts/kjer-cli.py list-tools-category defense
```
Available categories: `defense`, `hardening`, `edr`, `monitoring`

#### List installation profiles
```bash
./scripts/kjer-cli.py list-profiles
```

### Installation

#### Install a security profile (recommended)
```bash
# Minimal defense (3 tools)
sudo ./scripts/kjer-cli.py install-profile minimal

# Standard security (7 tools)
sudo ./scripts/kjer-cli.py install-profile standard

# Enterprise security (11 tools)
sudo ./scripts/kjer-cli.py install-profile enterprise

# Incident response (6 tools)
sudo ./scripts/kjer-cli.py install-profile incident-response
```

#### Install individual tool
```bash
sudo ./scripts/kjer-cli.py install-tool fail2ban
```

### System Status & Monitoring

#### Check security status
```bash
./scripts/kjer-cli.py status
```
Shows installed and available security tools.

#### Display system information
```bash
./scripts/kjer-cli.py info
```
Shows OS, kernel, architecture, and security modules.

#### Run security audit
```bash
sudo ./scripts/kjer-cli.py audit
```
Runs comprehensive Lynis security audit (requires Lynis installed).

#### Update security definitions
```bash
sudo ./scripts/kjer-cli.py update-definitions
```
Updates ClamAV and Rkhunter databases.

## Security Tools Reference

### Defense Tools
- **Fail2ban** - Intrusion prevention, blocks brute-force attacks
- **Chkrootkit** - Rootkit detection
- **Rkhunter** - Rootkit and malware scanner
- **AppArmor** - Application security module
- **UFW** - Uncomplicated Firewall

### Hardening Tools
- **Lynis** - Comprehensive security auditing
- **AIDE** - File integrity monitoring
- **TIGER** - System security checks
- **Tripwire** - File integrity and change management
- **Auditd** - Linux audit framework

### EDR Tools
- **ClamAV** - Open-source antivirus

### Monitoring Tools
- **OSQuery** - Operating system instrumentation
- **Auditd** - System audit framework

## Installation Profiles

### Minimal Profile
Best for: Lightweight systems, development environments
Tools: Fail2ban, UFW, ClamAV
Typical time: 5-10 minutes

### Standard Profile
Best for: General-purpose servers, workstations
Tools: Fail2ban, UFW, ClamAV, Lynis, AIDE, Auditd, AppArmor
Typical time: 15-25 minutes

### Enterprise Profile
Best for: Production servers, high-security environments
Tools: All standard tools + Chkrootkit, Rkhunter, TIGER, OSQuery
Typical time: 30-45 minutes

### Incident Response Profile
Best for: Security investigations, threat hunting
Tools: Auditd, Chkrootkit, Rkhunter, OSQuery, Lynis, AIDE
Typical time: 20-30 minutes

## Usage Examples

### Setup a new Linux server
```bash
# Check system compatibility
./scripts/kjer-cli.py info

# Install standard security profile
sudo ./scripts/kjer-cli.py install-profile standard

# Run initial audit
sudo ./scripts/kjer-cli.py audit

# Check status
./scripts/kjer-cli.py status
```

### Respond to security incident
```bash
# Install incident response tools
sudo ./scripts/kjer-cli.py install-profile incident-response

# Run security audit
sudo ./scripts/kjer-cli.py audit

# Check system status
./scripts/kjer-cli.py status
```

### Add specific tool to existing setup
```bash
# Install additional rootkit detection
sudo ./scripts/kjer-cli.py install-tool rkhunter

# Update rootkit definitions
sudo ./scripts/kjer-cli.py update-definitions
```

## Integration with GUI

Kjer also provides a web-based GUI for those who prefer graphical management:

```bash
# Start the web interface
cd Kjer_GUI/gui
python3 -m http.server 8000
```

Then navigate to `http://localhost:8000` in your browser.

## Tool Compatibility

All tools are tested for Linux compatibility. Tools marked with a pink "Linux" badge are Linux-specific and provide optimal performance on Linux systems.

### System Detection
- Automatic detection of your Linux distribution
- Compatibility scoring for recommended tools
- OS-appropriate installation commands

## Security Best Practices

1. **Always audit before deploying** - Run Lynis before installing tools
2. **Use appropriate profiles** - Start with minimal, upgrade as needed
3. **Keep definitions updated** - Run `update-definitions` regularly
4. **Monitor logs** - Use Auditd to track system changes
5. **File integrity** - Use AIDE to detect unauthorized modifications

## Troubleshooting

### Permission denied error
```bash
# Ensure proper permissions
sudo ./scripts/kjer-cli.py install-profile standard
```

### Tool installation fails
```bash
# Update package manager
sudo apt-get update
sudo apt-get upgrade

# Retry installation
sudo ./scripts/kjer-cli.py install-tool lynis
```

### Check if tool is installed
```bash
./scripts/kjer-cli.py status
```

## Support & Documentation

For more information on individual tools:
- **Fail2ban**: https://www.fail2ban.org
- **Lynis**: https://cisofy.com/lynis
- **AIDE**: https://aide.github.io
- **Auditd**: https://access.redhat.com/documentation
- **ClamAV**: https://www.clamav.net

## License

Kjer is provided as-is for security research and system hardening purposes.

## Contributing

To add new tools or improve the framework, please submit changes through the appropriate channels.

---

**Version**: 1.0.0  
**Last Updated**: January 2026  
**Compatibility**: Linux (All major distributions)
