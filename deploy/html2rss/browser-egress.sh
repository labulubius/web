#!/bin/sh
# Host-side, container-specific egress guard. Do not flush shared firewall rules.
set -eu
browser_ip=172.30.0.54
chain=LAB-H2R-BROWSER

print_rules() {
  printf '%s\n' '*filter' ":$chain - [0:0]" "-F $chain"
  printf '%s\n' "-A $chain -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN"
  printf '%s\n' "-A $chain -d 172.30.0.53 -p udp --dport 53 -j RETURN"
  printf '%s\n' "-A $chain -d 172.30.0.53 -p tcp --dport 53 -j RETURN"
  printf '%s\n' "-A $chain -m addrtype --dst-type LOCAL -j REJECT"
  for network in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
    printf '%s\n' "-A $chain -d $network -j REJECT"
  done
  printf '%s\n' "-A $chain -p tcp -m multiport --dports 80,443 -j RETURN"
  printf '%s\n' "-A $chain -j REJECT" COMMIT
}

case "${1:-apply}" in
  --print-rules) print_rules; exit 0 ;;
  apply) ;;
  *) printf '%s\n' 'Usage: browser-egress.sh [apply|--print-rules]' >&2; exit 2 ;;
esac
[ "$(id -u)" -eq 0 ] || { printf '%s\n' 'Run as root' >&2; exit 1; }
# Populate the dedicated chain in one atomic transaction, including on reload.
print_rules | iptables-restore --noflush
iptables -S DOCKER-USER >/dev/null 2>&1 || iptables -N DOCKER-USER
iptables -C DOCKER-USER -s "$browser_ip" -j "$chain" 2>/dev/null || iptables -I DOCKER-USER 1 -s "$browser_ip" -j "$chain"
iptables -C INPUT -s "$browser_ip" -j "$chain" 2>/dev/null || iptables -I INPUT 1 -s "$browser_ip" -j "$chain"
