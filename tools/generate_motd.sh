#!/bin/bash
# ==============================================================================
# generate_motd.sh - Modern, vibrant Arch Linux MOTD generator
# ==============================================================================

export LC_ALL=C
export LANG=C

# Colour CONSTANTS
W="\033[0m"
B="\033[01;36m"
R="\033[01;31m"
G="\033[01;32m"
Y="\033[01;33m"
M="\033[01;35m"
N="\033[0m"

# Define output file
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
BOOT_TYPE=""

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
  SYNC_COLOR="$G"
else
  SYNC_TEXT="NOT Synchronised"
  SYNC_COLOR="$R"
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

# Status colors
if [ "$SYSTEM_STATUS" = "running" ]; then
  STATUS_COLOR="$G"
else
  STATUS_COLOR="$R"
fi

if [ "$FAILED_SERVICES" -eq 0 ]; then
  FAILED_COLOR="$G"
else
  FAILED_COLOR="$R"
fi

USERS_COUNT=$(users 2>/dev/null | wc -w || echo 0)

# Write motd
echo -e "
       $B. $W
      $B/#\\                    _      _ _
     /###\\      __ _ _ __ ___| |__  | (_)_ __  _   ___  __
    /#####\\    / _' | '__/ __| '_ \\ | | | '_ \\| | | \\ \\/ /
   /##.-.##\\  | (_| | | | (__| | | || | | | | | |_| |>  <
  /##(   )##\\  \\__,_|_|  \\___|_| |_||_|_|_| |_|\\__._/_/\\_\\
 /#.--   --.#\\
/'           '\\ $W> $G$HOSTNAME $W
$G--------------------------------------------------------------------$W
$B        KERNEL $G:$Y $KERNEL $ARCH$W
$B    CPU VENDOR $G:$Y $CPU_VENDOR$W
$B           CPU $G:$Y $CPU$W
$B         CORES $G:$Y $CORES$W
$B     BOOT TYPE $G:$Y $BOOT_TYPE$W
$B    IP ADDRESS $G:$Y ${IP_ADDRESSES[*]}$W
$N
$B        MEMORY $G:$Y $MEMORY1 $W/ $Y$MEMORY2 $W- $G$MEMPERCENT$W
$B SYSTEM STATUS $G:$STATUS_COLOR $SYSTEM_STATUS$W
$B      SERVICES $G:$G $SERVICES_RUNNING running $W/ $FAILED_COLOR$FAILED_SERVICES failed$W
$B        UPTIME $G:$Y $upDays days $upHours hours $upMins minutes $upSecs seconds$W
$B      LOAD AVG $G:$Y $LOAD1 $W| $Y$LOAD5 $W| $Y$LOAD15$W
$B  USERS ACTIVE $G:$Y $USERS_COUNT users logged in$W
$B           NTP $G:$SYNC_COLOR active ($SYNC_TEXT)$W
$B   SYSTEM TIME $G:$Y $LOCAL_TIME $TIME_ZONE$W
$G--------------------------------------------------------------------$W
$N" > "$motd"
