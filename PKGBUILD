# Maintainer: gf <gf@gfnet.cloudns.be>
pkgname=cockpit-yay
pkgver=0.5.0
pkgrel=1
pkgdesc="Cockpit plugin for Arch Linux package management with yay and AUR integration"
arch=('x86_64')
url="https://git.gfnet.cloudns.be/gf/cockpit-yay"
license=('LGPL-2.1-or-later')
depends=(
    'cockpit>=300'
    'coreutils'
    'glibc'
    'libalpm.so=16-64'
    'libcurl.so=4-64'
    'libgcc_s.so=1-64'
    'pacman'
    'pacman-contrib'
    'pacman-mirrorlist'
    'systemd'
)
optdepends=(
    'yay: for AUR package search, building, and management'
    'paru: alternative AUR helper'
)
provides=('cockpit-pacman')
conflicts=('cockpit-pacman')
options=('!strip')
source=()
sha256sums=()

build() {
    cd "$startdir"
    if [ ! -f "backend/target/release/cockpit-yay-backend" ]; then
        cd backend && cargo build --release --locked && cd ..
    fi
    if [ ! -f "dist/index.js" ]; then
        npm ci
        npm run build
        cp src/manifest.json dist/
        cp src/index.html dist/
    fi
}

package() {
    cd "$startdir"
    node tools/install.mjs system "$pkgdir" "/usr" "/usr/libexec/cockpit-yay" "backend/target/release/cockpit-yay-backend" dist
}
