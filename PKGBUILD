# Maintainer: gf <green_forest@ukr.net>
pkgname=cockpit-aur
pkgver=0.5.3
pkgrel=10
pkgdesc="Cockpit plugin for Arch Linux package management with AUR and yay/paru support"
arch=('x86_64')
url="https://github.com/iskrypynets/cockpit-aur"
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
provides=('cockpit-pacman' 'cockpit-yay')
conflicts=('cockpit-pacman' 'cockpit-yay')
options=('!strip')
source=()
sha256sums=()

build() {
    cd "$startdir"
    if [ ! -f "backend/target/release/cockpit-aur-backend" ]; then
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
    node tools/install.mjs system "$pkgdir" "/usr" "/usr/libexec/cockpit-aur" "backend/target/release/cockpit-aur-backend" dist
}
