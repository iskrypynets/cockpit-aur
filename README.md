# cockpit-aur

A powerful [Cockpit](https://cockpit-project.org/) plugin for Arch Linux package management featuring direct `alpm.rs` integration, official repositories, and complete **AUR** support (with `yay` and `paru`).

Repository: https://git.gfnet.cloudns.be/gf/cockpit-aur.git

---

## Features

- **Full AUR & Helper Integration**:
  - Search packages across both official Arch Linux repositories (`core`, `extra`, `multilib`) and the AUR.
  - Review PKGBUILDs and install scripts with syntax highlighting and diff viewers before building.
  - Real-time build logs with unprivileged `makepkg` execution for maximum security.
  - Automatic detection and support for `yay` and `paru`.
- **System Updates**:
  - Live check for updates with package size, delta calculation, and version comparisons.
  - One-click update application with full polkit/sudo privilege elevation.
  - Arch Linux security advisories and news integration.
- **Package Management**:
  - View installed packages with filtering by install reason (explicit, dependencies, orphans).
  - Inspect detailed package metadata, file lists, and dependency graphs.
- **Repository & Mirror Management**:
  - Test mirror speeds, update `/etc/pacman.d/mirrorlist`, and restore backups.
  - Manage pacman keyring, cache cleanup, and pacsave/pacnew configuration files.

---

## Installation

### Method 1: Native Arch Linux Package (Recommended)

Build and install directly using standard Arch tools:

```bash
git clone https://git.gfnet.cloudns.be/gf/cockpit-aur.git
cd cockpit-aur
makepkg -si
```

Enable and start Cockpit:
```bash
sudo systemctl enable --now cockpit.socket
```

Open your browser at **[https://localhost:9090](https://localhost:9090)**, log in with your system account, and enable administrative access.

---

### Method 2: Rootless Podman Container (User Service)

If you prefer running the Cockpit web service in an isolated user container:

```bash
# Build the container image
./docker/build.sh

# Install and start the systemd user service
cp docker/cockpit-aur.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cockpit-aur.service
```

Access the web interface at **[http://localhost:9090/@localhost/aur](http://localhost:9090/@localhost/aur)** without needing password prompts.

---

### Method 3: From Source

Requirements: Rust toolchain, npm, libalpm, system libcurl, pkgconf, and Node.js >= 22.

```bash
sudo pacman -S --needed rust npm curl pkgconf pacman-contrib

# Build backend and frontend
make build

# System-wide install
sudo make install

# Or development install (links into ~/.local)
make devel-install
```

---

## Security Guarantees

- **Unprivileged AUR builds**: `makepkg` is always executed under an unprivileged user account. Root access is strictly rejected for AUR builds.
- **PKGBUILD Inspection**: Users can inspect and review all PKGBUILD scripts before initiating builds.
- **Integrity**: Standard ALPM and pacman cryptographic signature verification is enforced.

---

## License

GPL-3.0-only
