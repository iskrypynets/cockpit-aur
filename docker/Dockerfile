FROM archlinux:latest

# System update and package installation
RUN pacman -Syu --noconfirm --overwrite '*' \
    cockpit \
    sudo \
    pacman-contrib \
    git \
    binutils \
    fakeroot \
    procps-ng \
    curl \
    diffutils \
    && rm -rf /var/cache/pacman/pkg/*

# Create user gf matching host UID 1000
RUN groupadd -g 1000 gf && \
    useradd -u 1000 -g 1000 -m -s /bin/bash -G wheel gf && \
    echo "gf:cockpit" | chpasswd && \
    echo "gf ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/gf && \
    chmod 0440 /etc/sudoers.d/gf

# Configure PAM for Cockpit to allow easy local authentication
RUN echo -e "#%PAM-1.0\nauth sufficient pam_permit.so\naccount sufficient pam_permit.so\npassword sufficient pam_permit.so\nsession sufficient pam_permit.so\n" > /etc/pam.d/cockpit

# Configure Cockpit WebService
RUN mkdir -p /etc/cockpit && cat << 'EOF' > /etc/cockpit/cockpit.conf
[WebService]
AllowUnencrypted = true
Origins = http://localhost:9090 http://127.0.0.1:9090 http://localhost:9091 http://127.0.0.1:9091
LoginTitle = Cockpit AUR
EOF

# Copy yay binary
COPY docker/yay /usr/bin/yay
RUN chmod +x /usr/bin/yay

# Copy cockpit-aur backend binary
RUN mkdir -p /usr/libexec/cockpit-aur
COPY backend/target/release/cockpit-aur-backend /usr/libexec/cockpit-aur/cockpit-aur-backend
RUN chmod 755 /usr/libexec/cockpit-aur/cockpit-aur-backend

# Copy cockpit-aur frontend package
RUN mkdir -p /usr/share/cockpit/aur
COPY dist/ /usr/share/cockpit/aur/
RUN chmod -R 755 /usr/share/cockpit/aur

# Entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/entrypoint.sh"]
