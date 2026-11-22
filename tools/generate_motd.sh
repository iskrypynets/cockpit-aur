#!/bin/bash
# ==============================================================================
# generate_motd.sh - Clean plain-text Arch Linux MOTD generator (no ANSI codes)
# ==============================================================================

export LC_ALL=C
export LANG=C

motd="/etc/motd"

# Collect information
HOSTNAME=$(uname -n)
KERNEL=$(uname -r)
CPU=$(lscpu | grep 'Model name:' | head -n1 | awk -F: '{print $2}' | sed 's/^[ \t]*//')
CPU_VENDOR=$(lscpu | grep "Vendor ID:" | head -n1 | awk -F: '{print $2}' | sed 's/^[ \t]*//')
CORES=$(nproc 2>/dev/null || lscpu | grep '^CPU(s):' | head -n1 | awk '{print $2}')
ARCH=$(uname -m)
MEMORY1=$(free -m | awk '/Mem:/{print $3" MB"}')
MEMORY2=$(free -m | awk '/Mem:/{print $2" MB"}')
MEMPERCENT=$(free | awk '/Mem:/{printf("%.1f%% (Used)"), $3/$2*100}')

SYSTEM_STATUS=$(systemctl is-system-running 2>/dev/null || true)
if [ -z "$SYSTEM_STATUS" ]; then
  SYSTEM_STATUS="unknown"
fi

SERVICES_RUNNING=$(systemctl | grep -c running || echo 0)
FAILED_SERVICES=$(systemctl --failed --no-legend 2>/dev/null | wc -l)
NET_INTERFACES=($(ip -o link show 2>/dev/null | awk '/state UP/ && !/veth[0-9]/' | sed "s|:||g" | awk '{print $2}'))
IP_ADDRESSES=()
for ni in "${NET_INTERFACES[@]}"; do
  IP_ADDR=$(ip -4 -o address show "$ni" 2>/dev/null | grep inet | sed "s|:||g" | awk '{print $4}')
  if [ -n "$IP_ADDR" ]; then
    IP_ADDRESSES+=("$ni ($IP_ADDR) ")
  fi
done
LOCAL_TIME=$(date +"%a %Y-%m-%d %H:%M:%S")
TIME_ZONE=$(date +"%Z (%z)")
TIME_SYNC_STATUS=$(timedatectl status 2>/dev/null | grep "clock synchronized" | awk '{print $NF}')

if [ "$TIME_SYNC_STATUS" = "yes" ]; then
  SYNC_TEXT="Synchronised"
else
  SYNC_TEXT="NOT Synchronised"
fi

if [ -d /sys/firmware/efi ]; then
  BOOT_TYPE="UEFI"
else
  BOOT_TYPE="BIOS"
fi

# System uptime
uptime_raw=$(cat /proc/uptime 2>/dev/null | cut -f1 -d. || echo 0)
upDays=$((uptime_raw/60/60/24))
upHours=$((uptime_raw/60/60%24))
upMins=$((uptime_raw/60%60))
upSecs=$((uptime_raw%60))

# System load
LOAD1=$(cat /proc/loadavg | awk '{print $1}')
LOAD5=$(cat /proc/loadavg | awk '{print $2}')
LOAD15=$(cat /proc/loadavg | awk '{print $3}')

USERS_COUNT=$(users 2>/dev/null | wc -w || echo 0)

# Write clean plain-text motd without ANSI codes
cat <<EOF > "$motd"

       . 
      /#\\                    _      _ _
     /###\\      __ _ _ __ ___| |__  | (_)_ __  _   ___  __
    /#####\\    / _' | '__/ __| '_ \\ | | | '_ \\| | | \\ \\/ /
   /##.-.##\\  | (_| | | | (__| | | || | | | | | |_| |>  <
  /##(   )##\\  \\__,_|_|  \\___|_| |_||_|_|_| |_|\\__._/_/\\_\\
 /#.--   --.#\\
/'           '\\ > $HOSTNAME
--------------------------------------------------------------------
        KERNEL : $KERNEL $ARCH
    CPU VENDOR : $CPU_VENDOR
           CPU : $CPU
         CORES : $CORES
     BOOT TYPE : $BOOT_TYPE
    IP ADDRESS : ${IP_ADDRESSES[*]}

        MEMORY : $MEMORY1 / $MEMORY2 - $MEMPERCENT
 SYSTEM STATUS : $SYSTEM_STATUS
      SERVICES : $SERVICES_RUNNING running / $FAILED_SERVICES failed
        UPTIME : $upDays days $upHours hours $upMins minutes $upSecs seconds
      LOAD AVG : $LOAD1 | $LOAD5 | $LOAD15
  USERS ACTIVE : $USERS_COUNT users logged in
           NTP : active ($SYNC_TEXT)
   SYSTEM TIME : $LOCAL_TIME $TIME_ZONE
--------------------------------------------------------------------
EOF
