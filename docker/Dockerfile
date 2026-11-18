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
LoginTitle = Cockpit Yay Test
EOF

# Copy yay binary
COPY docker/yay /usr/bin/yay
RUN chmod +x /usr/bin/yay

# Copy cockpit-yay backend binary
RUN mkdir -p /usr/libexec/cockpit-yay
COPY backend/target/release/cockpit-yay-backend /usr/libexec/cockpit-yay/cockpit-yay-backend
RUN chmod 755 /usr/libexec/cockpit-yay/cockpit-yay-backend

# Copy cockpit-yay frontend package
RUN mkdir -p /usr/share/cockpit/yay
COPY dist/ /usr/share/cockpit/yay/
RUN chmod -R 755 /usr/share/cockpit/yay

# Entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/entrypoint.sh"]
