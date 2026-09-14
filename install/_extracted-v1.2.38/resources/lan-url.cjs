'use strict';

/**
 * LAN URL helpers for factory server + tablet rollout.
 * Filters virtual/VPN interfaces so setup QR codes use the real Wi‑Fi/Ethernet IP.
 */

const VIRTUAL_IFACE_RE =
  /^(lo|loopback|vEthernet|vethernet|wsl|hyper-v|vmware|virtualbox|virtual|docker|tailscale|npcap|hamachi|zerotier|bluetooth)/i;

const TAILSCALE_IPV4_RE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/** WSL2 NAT address — not reachable from factory Wi‑Fi tablets. */
const WSL_NAT_IPV4_RE = /^172\.31\.\d{1,3}\.\d{1,3}$/;

function isPrivateLanIPv4(address) {
  const p = String(address || '')
    .trim()
    .split('.')
    .map((x) => parseInt(x, 10));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  if (p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  return false;
}

function isUsableFactoryLanIPv4(address, ifaceName) {
  const addr = String(address || '').trim();
  const name = String(ifaceName || '').trim();
  if (!addr || !isPrivateLanIPv4(addr)) return false;
  if (addr.startsWith('169.254.')) return false;
  if (TAILSCALE_IPV4_RE.test(addr)) return false;
  if (VIRTUAL_IFACE_RE.test(name)) return false;
  return true;
}

/** @param {import('os').NetworkInterfaces} ifaces */
function collectLanIPv4(ifaces) {
  const out = [];
  for (const name of Object.keys(ifaces || {})) {
    for (const iface of ifaces[name] || []) {
      if (!iface || iface.family !== 'IPv4' || iface.internal) continue;
      if (!isUsableFactoryLanIPv4(iface.address, name)) continue;
      out.push({
        name,
        address: iface.address,
        priority: lanIfacePriority(name, iface.address),
      });
    }
  }
  out.sort((a, b) => a.priority - b.priority || a.address.localeCompare(b.address));
  let mapped = out.map(({ name, address }) => ({ name, address }));
  const withoutWslNat = mapped.filter((i) => !WSL_NAT_IPV4_RE.test(i.address));
  if (withoutWslNat.length) mapped = withoutWslNat;
  return mapped;
}

function lanIfacePriority(name, address) {
  const n = String(name || '').toLowerCase();
  if (/^wi-?fi|wlan|wireless/i.test(n)) return 0;
  if (/^eth|ethernet|en\d/i.test(n)) return 1;
  if (String(address || '').startsWith('192.168.')) return 2;
  if (String(address || '').startsWith('10.')) return 3;
  return 4;
}

/**
 * Normalize user input like `192.168.0.101:3111` → `http://192.168.0.101:3111`
 * @param {string} raw
 * @param {number|string} defaultPort
 */
function normalizeLanBaseUrl(raw, defaultPort) {
  var s = String(raw || '').trim();
  if (!s) return '';
  var port = String(defaultPort != null && defaultPort !== '' ? defaultPort : '3000');
  if (!/^https?:\/\//i.test(s)) {
    if (/^[\d.]+$/.test(s)) s = 'http://' + s + ':' + port;
    else if (/^[\d.]+:\d+$/.test(s)) s = 'http://' + s;
    else if (/^[\w.-]+(:\d+)?$/.test(s)) s = 'http://' + s;
  }
  try {
    var u = new URL(s);
    if (!u.port && u.protocol === 'http:') u.port = port;
    return u.origin.replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function buildKioskUrl(baseOrigin, queryParams) {
  const base = String(baseOrigin || '').replace(/\/$/, '');
  const qs = new URLSearchParams(queryParams || {}).toString();
  return base + '/kiosk.html' + (qs ? '?' + qs : '');
}

function buildLanCheckUrl(baseOrigin) {
  return String(baseOrigin || '').replace(/\/$/, '') + '/lan-check.html';
}

function connectionRefusedHints(port) {
  const p = String(port != null ? port : '3000');
  return [
    'Server must be running on this PC (check Task Manager for node.exe / run install\\LAUNCH-ALL.bat).',
    'Tablet URL must include the port, e.g. http://192.168.0.101:' + p + '/kiosk.html',
    'Windows Firewall must allow inbound TCP ' + p + ' (run install\\ENSURE-LAN-FIREWALL.ps1 as Administrator once).',
    'Tablet and PC must be on the same Wi‑Fi — not guest/isolated VLAN (router “AP isolation” blocks tablets).',
    'Confirm the PC IP with ipconfig on the factory PC; static DHCP must reserve the same MAC address.',
    'If you use the HTTPS kiosk PWA, LAN http:// IPs are blocked — use https://api… tunnel URL instead.',
  ];
}

/** @deprecated alias */
const normalizeFactoryBaseUrl = normalizeLanBaseUrl;

module.exports = {
  isPrivateLanIPv4,
  isUsableFactoryLanIPv4,
  collectLanIPv4,
  normalizeLanBaseUrl,
  normalizeFactoryBaseUrl,
  buildKioskUrl,
  buildLanCheckUrl,
  connectionRefusedHints,
  VIRTUAL_IFACE_RE,
};
