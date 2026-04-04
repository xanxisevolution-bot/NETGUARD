// ============================================================
//  NetGuard Monitor v2.0 — Backend Server
//  Real network diagnostics: LAN, ISP, Router
//  + Telegram Notifications
// ============================================================

const express = require('express');
const { exec } = require('child_process');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard
app.use(express.static(__dirname));

// ── Config ──
const CONFIG = {
  ROUTER_IP: '192.168.1.1',       // ZTE F6600 default gateway
  DNS_PRIMARY: '8.8.8.8',          // Google DNS
  DNS_SECONDARY: '1.1.1.1',        // Cloudflare DNS
  ISP_CHECK_HOST: 'www.google.com', // HTTP check
  PING_TIMEOUT: 3,                  // seconds
  PING_COUNT: 2,                    // number of pings
};

// ── Telegram Config (saved to file) ──
const TELEGRAM_CONFIG_PATH = path.join(__dirname, 'telegram-config.json');
let TELEGRAM = {
  enabled: false,
  botToken: '',      // from @BotFather
  chatId: '',        // from @userinfobot or @getidsbot
  notifyDown: true,
  notifyRestore: true,
  cooldownMinutes: 2,  // minimum minutes between repeat alerts
};
loadTelegramConfig();

function loadTelegramConfig() {
  try {
    if (fs.existsSync(TELEGRAM_CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(TELEGRAM_CONFIG_PATH, 'utf-8'));
      Object.assign(TELEGRAM, saved);
      console.log('[Telegram] Config loaded - ' + (TELEGRAM.enabled ? 'ENABLED' : 'disabled'));
    }
  } catch (e) {
    console.log('[Telegram] No config found, using defaults');
  }
}

function saveTelegramConfig() {
  try {
    fs.writeFileSync(TELEGRAM_CONFIG_PATH, JSON.stringify(TELEGRAM, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Telegram] Failed to save config:', e.message);
  }
}

// ── Telegram Cooldown Tracking ──
let lastTelegramAlert = 0;  // timestamp of last sent alert

// ============================================================
//  TELEGRAM: Send Message
// ============================================================
function sendTelegram(message) {
  if (!TELEGRAM.enabled || !TELEGRAM.botToken || !TELEGRAM.chatId) {
    return Promise.resolve(false);
  }

  // Cooldown check
  const now = Date.now();
  if (now - lastTelegramAlert < TELEGRAM.cooldownMinutes * 60 * 1000) {
    console.log('[Telegram] Cooldown active, skipping');
    return Promise.resolve(false);
  }
  lastTelegramAlert = now;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: TELEGRAM.chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            console.log('[Telegram] Message sent successfully');
            resolve(true);
          } else {
            console.error('[Telegram] API error:', result.description);
            resolve(false);
          }
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[Telegram] Network error:', e.message);
      resolve(false);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

// ============================================================
//  TELEGRAM: Format Alert Messages
// ============================================================
function formatDownAlert(type, diagnosis) {
  const time = new Date().toLocaleString('th-TH', { hour12: false });
  return `🔴 <b>NetGuard Alert — ${type} DOWN</b>\n` +
         `━━━━━━━━━━━━━━━━━━━━\n` +
         `⏰ Time: ${time}\n` +
         `🔍 Issue: ${type}\n` +
         `📋 Detail: ${diagnosis}\n` +
         `━━━━━━━━━━━━━━━━━━━━\n` +
         `⚠️ Please check immediately!`;
}

function formatResolvedAlert(type, downtime) {
  const time = new Date().toLocaleString('th-TH', { hour12: false });
  return `🟢 <b>NetGuard — ${type} RESTORED</b>\n` +
         `━━━━━━━━━━━━━━━━━━━━\n` +
         `⏰ Time: ${time}\n` +
         `✅ Status: Back online\n` +
         `⏱ Downtime: ${downtime}\n` +
         `━━━━━━━━━━━━━━━━━━━━\n` +
         `System is operational.`;
}

// ============================================================
//  API: Telegram Config
// ============================================================
app.get('/api/telegram', (req, res) => {
  res.json({
    enabled: TELEGRAM.enabled,
    botToken: TELEGRAM.botToken ? '***' + TELEGRAM.botToken.slice(-6) : '',
    chatId: TELEGRAM.chatId,
    notifyDown: TELEGRAM.notifyDown,
    notifyRestore: TELEGRAM.notifyRestore,
    cooldownMinutes: TELEGRAM.cooldownMinutes,
  });
});

app.post('/api/telegram', (req, res) => {
  const { enabled, botToken, chatId, notifyDown, notifyRestore, cooldownMinutes } = req.body;
  if (typeof enabled === 'boolean') TELEGRAM.enabled = enabled;
  if (botToken && botToken !== '') TELEGRAM.botToken = botToken;
  if (chatId) TELEGRAM.chatId = String(chatId);
  if (typeof notifyDown === 'boolean') TELEGRAM.notifyDown = notifyDown;
  if (typeof notifyRestore === 'boolean') TELEGRAM.notifyRestore = notifyRestore;
  if (cooldownMinutes) TELEGRAM.cooldownMinutes = parseInt(cooldownMinutes) || 2;
  saveTelegramConfig();
  res.json({ ok: true, message: 'Telegram config saved' });
});

app.post('/api/telegram/test', async (req, res) => {
  const time = new Date().toLocaleString('th-TH', { hour12: false });
  const msg = `🧪 <b>NetGuard — Test Message</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `⏰ Time: ${time}\n` +
              `✅ Telegram notifications are working!\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `This is a test from NetGuard Monitor.`;
  
  lastTelegramAlert = 0; // bypass cooldown for test
  const sent = await sendTelegram(msg);
  res.json({ ok: sent, message: sent ? 'Test message sent!' : 'Failed to send. Check token & chat ID.' });
});

// ── History ──
let diagnosticHistory = [];
let totalChecks = 0;
let totalIssues = 0;

// ============================================================
//  LOGGING SYSTEM — save incidents & all scans to file
// ============================================================
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Track incident state (for duration tracking)
let currentIncident = null;  // { startTime, type, diagnosis }

function getLogFilePath(type) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `${type}_${today}.json`);
}

function readLogFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) { /* corrupted file, start fresh */ }
  return [];
}

function appendLog(type, entry) {
  const filePath = getLogFilePath(type);
  const data = readLogFile(filePath);
  data.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Save every scan result
function logScan(result) {
  appendLog('scans', {
    time: result.timestamp,
    overall: result.overall,
    lan: result.lan.status,
    router: result.router.status,
    isp: result.isp.status,
    latency: result.isp.latency || null,
    diagnosis: result.diagnosis,
    duration_ms: result.duration,
  });
}

// Track incidents (problem start → problem end)
function trackIncident(result) {
  const isDown = result.overall !== 'online';

  if (isDown && !currentIncident) {
    // NEW incident starts
    currentIncident = {
      startTime: result.timestamp,
      type: result.lan.status === 'offline' ? 'LAN' :
            result.router.status === 'offline' ? 'Router' :
            result.isp.status === 'offline' ? 'ISP' :
            result.isp.status === 'warning' ? 'ISP-Unstable' : 'Unknown',
      diagnosis: result.diagnosis,
    };
    // Log incident start
    appendLog('incidents', {
      event: 'DOWN',
      time: currentIncident.startTime,
      type: currentIncident.type,
      diagnosis: currentIncident.diagnosis,
      resolved: false,
      endTime: null,
      downtime: null,
    });
    console.log(`[INCIDENT] DOWN at ${currentIncident.startTime}: ${currentIncident.type}`);

    // ── TELEGRAM: Send DOWN alert ──
    if (TELEGRAM.notifyDown) {
      sendTelegram(formatDownAlert(currentIncident.type, currentIncident.diagnosis));
    }

  } else if (!isDown && currentIncident) {
    // Incident RESOLVED
    const endTime = result.timestamp;
    const startMs = new Date(currentIncident.startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const downtimeSec = Math.round((endMs - startMs) / 1000);

    appendLog('incidents', {
      event: 'RESOLVED',
      time: endTime,
      type: currentIncident.type,
      diagnosis: currentIncident.diagnosis,
      resolved: true,
      startTime: currentIncident.startTime,
      endTime: endTime,
      downtime: formatDuration(downtimeSec),
      downtime_seconds: downtimeSec,
    });
    console.log(`[INCIDENT] RESOLVED after ${formatDuration(downtimeSec)}: ${currentIncident.type}`);

    // ── TELEGRAM: Send RESOLVED alert ──
    if (TELEGRAM.notifyRestore) {
      sendTelegram(formatResolvedAlert(currentIncident.type, formatDuration(downtimeSec)));
    }

    currentIncident = null;
  }
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m ${s}s`;
}

// ============================================================
//  API: GET /api/config — return current config
// ============================================================
app.get('/api/config', (req, res) => {
  res.json(CONFIG);
});

// ============================================================
//  API: POST /api/config — update config
// ============================================================
app.post('/api/config', (req, res) => {
  const { routerIp, dnsPrimary, dnsSecondary } = req.body;
  if (routerIp) CONFIG.ROUTER_IP = routerIp;
  if (dnsPrimary) CONFIG.DNS_PRIMARY = dnsPrimary;
  if (dnsSecondary) CONFIG.DNS_SECONDARY = dnsSecondary;
  res.json({ ok: true, config: CONFIG });
});

// ============================================================
//  API: GET /api/diagnose — run full diagnostic (sequential)
// ============================================================
app.get('/api/diagnose', async (req, res) => {
  const startTime = Date.now();
  const result = {
    timestamp: new Date().toISOString(),
    lan: null,
    router: null,
    isp: null,
    overall: 'online',
    duration: 0,
    diagnosis: '',
  };

  try {
    // ── Step 1: Check LAN Interface ──
    result.lan = checkLANInterface();

    // ── Step 2: Ping Router ──
    if (result.lan.status === 'online') {
      result.router = await pingHost(CONFIG.ROUTER_IP, 'Router');
    } else {
      result.router = {
        status: 'offline',
        host: CONFIG.ROUTER_IP,
        latency: null,
        message: 'Cannot check - LAN is disconnected',
      };
    }

    // ── Step 3: Check ISP (Ping external DNS) ──
    if (result.router.status === 'online') {
      result.isp = await checkISP();
    } else {
      result.isp = {
        status: 'offline',
        latency: null,
        dns: null,
        message: 'Cannot check - Router is unreachable',
      };
    }

    // ── Determine overall status and diagnosis ──
    if (result.lan.status === 'offline') {
      result.overall = 'offline';
      result.diagnosis = 'LAN cable is disconnected or network adapter is down';
    } else if (result.router.status === 'offline') {
      result.overall = 'offline';
      result.diagnosis = 'Router is not responding - may be powered off or crashed';
    } else if (result.isp.status === 'offline') {
      result.overall = 'offline';
      result.diagnosis = 'ISP connection is down - router works but no internet';
    } else if (result.isp.status === 'warning') {
      result.overall = 'warning';
      result.diagnosis = 'ISP connection is unstable - high latency or packet loss';
    } else {
      result.overall = 'online';
      result.diagnosis = 'All systems operational';
    }

    result.duration = Date.now() - startTime;

    // Track in-memory history
    totalChecks++;
    if (result.overall !== 'online') totalIssues++;
    diagnosticHistory.unshift({
      time: result.timestamp,
      overall: result.overall,
      diagnosis: result.diagnosis,
    });
    if (diagnosticHistory.length > 100) diagnosticHistory.pop();

    // ── SAVE TO FILE ──
    logScan(result);
    trackIncident(result);

  } catch (err) {
    result.overall = 'offline';
    result.diagnosis = 'Diagnostic error: ' + err.message;
  }

  res.json(result);
});

// ============================================================
//  API: GET /api/check/lan — check only LAN
// ============================================================
app.get('/api/check/lan', (req, res) => {
  res.json(checkLANInterface());
});

// ============================================================
//  API: GET /api/check/router — ping router only
// ============================================================
app.get('/api/check/router', async (req, res) => {
  const result = await pingHost(CONFIG.ROUTER_IP, 'Router');
  res.json(result);
});

// ============================================================
//  API: GET /api/check/isp — check ISP only
// ============================================================
app.get('/api/check/isp', async (req, res) => {
  const result = await checkISP();
  res.json(result);
});

// ============================================================
//  API: GET /api/stats — get statistics
// ============================================================
app.get('/api/stats', (req, res) => {
  res.json({
    totalChecks,
    totalIssues,
    uptime: totalChecks > 0 ? ((1 - totalIssues / totalChecks) * 100).toFixed(1) : '100.0',
    history: diagnosticHistory.slice(0, 20),
    currentIncident: currentIncident || null,
  });
});

// ============================================================
//  API: GET /api/incidents — get incident log
//  ?date=YYYY-MM-DD (optional, default=today)
//  ?days=7 (optional, get last N days)
// ============================================================
app.get('/api/incidents', (req, res) => {
  const days = parseInt(req.query.days) || 1;
  const incidents = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = path.join(LOG_DIR, `incidents_${dateStr}.json`);
    const data = readLogFile(filePath);
    incidents.push(...data.map(e => ({ ...e, date: dateStr })));
  }

  // Sort newest first
  incidents.sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json({ incidents, days, count: incidents.length });
});

// ============================================================
//  API: GET /api/scans — get scan history
//  ?date=YYYY-MM-DD (optional)
//  ?days=1 (optional)
// ============================================================
app.get('/api/scans', (req, res) => {
  const days = parseInt(req.query.days) || 1;
  const scans = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = path.join(LOG_DIR, `scans_${dateStr}.json`);
    const data = readLogFile(filePath);
    scans.push(...data.map(e => ({ ...e, date: dateStr })));
  }

  scans.sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json({ scans: scans.slice(0, 500), days, count: scans.length });
});

// ============================================================
//  API: GET /api/report — daily summary report
//  ?days=7 (optional)
// ============================================================
app.get('/api/report', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const report = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    // Read scans for this date
    const scansPath = path.join(LOG_DIR, `scans_${dateStr}.json`);
    const scans = readLogFile(scansPath);

    // Read incidents for this date
    const incPath = path.join(LOG_DIR, `incidents_${dateStr}.json`);
    const incidents = readLogFile(incPath);

    const totalScans = scans.length;
    const onlineScans = scans.filter(s => s.overall === 'online').length;
    const offlineScans = scans.filter(s => s.overall === 'offline').length;
    const warningScans = scans.filter(s => s.overall === 'warning').length;
    const uptimePct = totalScans > 0 ? ((onlineScans / totalScans) * 100).toFixed(1) : '--';

    // Calculate total downtime from resolved incidents
    const resolvedIncidents = incidents.filter(e => e.event === 'RESOLVED');
    const totalDowntimeSec = resolvedIncidents.reduce((sum, e) => sum + (e.downtime_seconds || 0), 0);

    // Group incidents by type
    const downEvents = incidents.filter(e => e.event === 'DOWN');
    const byType = {};
    downEvents.forEach(e => {
      byType[e.type] = (byType[e.type] || 0) + 1;
    });

    report.push({
      date: dateStr,
      totalScans,
      onlineScans,
      offlineScans,
      warningScans,
      uptimePercent: uptimePct,
      incidentCount: downEvents.length,
      totalDowntime: formatDuration(totalDowntimeSec),
      totalDowntimeSeconds: totalDowntimeSec,
      incidentsByType: byType,
    });
  }

  res.json({ report, days });
});

// ============================================================
//  API: GET /api/logs/files — list all log files
// ============================================================
app.get('/api/logs/files', (req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    res.json({ files, logDir: LOG_DIR });
  } catch (e) {
    res.json({ files: [], logDir: LOG_DIR });
  }
});

// ============================================================
//  CHECK: LAN Interface
// ============================================================
function checkLANInterface() {
  const interfaces = os.networkInterfaces();
  const result = {
    status: 'offline',
    interfaces: [],
    activeCount: 0,
    message: '',
  };

  for (const [name, addrs] of Object.entries(interfaces)) {
    // Skip loopback
    if (name.toLowerCase().includes('loopback') || name === 'lo') continue;

    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const iface = {
          name: name,
          ip: addr.address,
          mac: addr.mac,
          netmask: addr.netmask,
        };
        result.interfaces.push(iface);
        result.activeCount++;
      }
    }
  }

  if (result.activeCount > 0) {
    result.status = 'online';
    result.message = `${result.activeCount} active interface(s) found`;
  } else {
    result.status = 'offline';
    result.message = 'No active network interface - LAN cable may be disconnected';
  }

  return result;
}

// ============================================================
//  CHECK: Ping a host
// ============================================================
function pingHost(host, label) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `ping -n ${CONFIG.PING_COUNT} -w ${CONFIG.PING_TIMEOUT * 1000} ${host}`
      : `ping -c ${CONFIG.PING_COUNT} -W ${CONFIG.PING_TIMEOUT} ${host}`;

    const startTime = Date.now();

    exec(cmd, { timeout: (CONFIG.PING_TIMEOUT + 2) * 1000 }, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;

      if (error) {
        resolve({
          status: 'offline',
          host,
          label,
          latency: null,
          packetLoss: '100%',
          message: `${label || host} is not responding`,
          raw: stdout || stderr,
        });
        return;
      }

      // Parse latency from ping output
      let latency = null;
      let packetLoss = '0%';

      if (isWin) {
        // Windows: "Average = 5ms"
        const avgMatch = stdout.match(/Average\s*=\s*(\d+)ms/i) 
                      || stdout.match(/Media\s*=\s*(\d+)ms/i);
        if (avgMatch) latency = parseInt(avgMatch[1]);

        const lossMatch = stdout.match(/(\d+)%\s*(loss|perdidos)/i);
        if (lossMatch) packetLoss = lossMatch[1] + '%';
      } else {
        // Linux: "rtt min/avg/max/mdev = 1.234/5.678/..."
        const rttMatch = stdout.match(/rtt.*=\s*[\d.]+\/([\d.]+)/);
        if (rttMatch) latency = parseFloat(rttMatch[1]);

        const lossMatch = stdout.match(/(\d+)%\s*packet loss/);
        if (lossMatch) packetLoss = lossMatch[1] + '%';
      }

      const lossNum = parseInt(packetLoss);
      let status = 'online';
      if (lossNum >= 100) status = 'offline';
      else if (lossNum > 20 || (latency && latency > 200)) status = 'warning';

      resolve({
        status,
        host,
        label,
        latency: latency ? latency + ' ms' : null,
        packetLoss,
        message: `${label || host}: ${latency ? latency + 'ms' : 'N/A'}, Loss: ${packetLoss}`,
        raw: stdout,
      });
    });
  });
}

// ============================================================
//  CHECK: ISP (ping multiple external targets)
// ============================================================
async function checkISP() {
  // Ping primary DNS
  const primary = await pingHost(CONFIG.DNS_PRIMARY, 'DNS Primary');
  
  // If primary fails, try secondary
  if (primary.status === 'offline') {
    const secondary = await pingHost(CONFIG.DNS_SECONDARY, 'DNS Secondary');
    
    if (secondary.status === 'offline') {
      return {
        status: 'offline',
        latency: null,
        dns: { primary: primary.status, secondary: secondary.status },
        packetLoss: '100%',
        message: 'ISP is down - cannot reach any external DNS',
      };
    }

    return {
      status: 'warning',
      latency: secondary.latency,
      dns: { primary: primary.status, secondary: secondary.status },
      packetLoss: secondary.packetLoss,
      message: 'Primary DNS unreachable, secondary OK - possible ISP issue',
    };
  }

  return {
    status: primary.status,
    latency: primary.latency,
    dns: { primary: primary.status, secondary: 'not_checked' },
    packetLoss: primary.packetLoss,
    message: primary.status === 'online'
      ? `ISP OK: ${primary.latency}, Loss: ${primary.packetLoss}`
      : `ISP unstable: ${primary.latency}, Loss: ${primary.packetLoss}`,
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ============================================================
//  AUTO-UPDATE SYSTEM — via GitHub Releases
// ============================================================
const UPDATE_CONFIG_PATH = path.join(__dirname, 'update-config.json');
const CURRENT_VERSION = require('./package.json').version;

let UPDATE_CONFIG = {
  githubOwner: '',   // e.g. 'myusername'
  githubRepo: '',    // e.g. 'netguard-monitor'
  autoCheck: false,
  checkIntervalHours: 6,
};
loadUpdateConfig();

function loadUpdateConfig() {
  try {
    if (fs.existsSync(UPDATE_CONFIG_PATH)) {
      Object.assign(UPDATE_CONFIG, JSON.parse(fs.readFileSync(UPDATE_CONFIG_PATH, 'utf-8')));
    }
  } catch (e) {}
}

function saveUpdateConfig() {
  fs.writeFileSync(UPDATE_CONFIG_PATH, JSON.stringify(UPDATE_CONFIG, null, 2), 'utf-8');
}

// GET /api/update/config
app.get('/api/update/config', (req, res) => {
  res.json({ ...UPDATE_CONFIG, currentVersion: CURRENT_VERSION });
});

// POST /api/update/config
app.post('/api/update/config', (req, res) => {
  const { githubOwner, githubRepo, autoCheck } = req.body;
  if (githubOwner) UPDATE_CONFIG.githubOwner = githubOwner.trim();
  if (githubRepo) UPDATE_CONFIG.githubRepo = githubRepo.trim();
  if (typeof autoCheck === 'boolean') UPDATE_CONFIG.autoCheck = autoCheck;
  saveUpdateConfig();
  res.json({ ok: true });
});

// GET /api/update/check — check GitHub for new version
app.get('/api/update/check', (req, res) => {
  if (!UPDATE_CONFIG.githubOwner || !UPDATE_CONFIG.githubRepo) {
    return res.json({ error: 'GitHub owner/repo not configured' });
  }

  const options = {
    hostname: 'api.github.com',
    path: `/repos/${UPDATE_CONFIG.githubOwner}/${UPDATE_CONFIG.githubRepo}/releases/latest`,
    headers: { 'User-Agent': 'NetGuard-Monitor' },
  };

  https.get(options, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      try {
        const release = JSON.parse(data);
        if (release.message) {
          return res.json({ error: release.message });
        }

        const latestVersion = (release.tag_name || '').replace(/^v/, '');
        const hasUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;

        // Find ZIP asset
        let downloadUrl = null;
        if (release.assets && release.assets.length > 0) {
          const zipAsset = release.assets.find(a => a.name.endsWith('.zip'));
          if (zipAsset) downloadUrl = zipAsset.browser_download_url;
        }
        // Fallback to source ZIP
        if (!downloadUrl) {
          downloadUrl = release.zipball_url;
        }

        res.json({
          currentVersion: CURRENT_VERSION,
          latestVersion,
          hasUpdate,
          releaseName: release.name || release.tag_name,
          releaseNotes: (release.body || '').slice(0, 500),
          publishedAt: release.published_at,
          downloadUrl,
        });
      } catch (e) {
        res.json({ error: 'Failed to parse GitHub response' });
      }
    });
  }).on('error', (e) => {
    res.json({ error: 'Cannot reach GitHub: ' + e.message });
  });
});

// POST /api/update/install — download and install update
app.post('/api/update/install', (req, res) => {
  const { downloadUrl } = req.body;
  if (!downloadUrl) {
    return res.json({ ok: false, error: 'No download URL' });
  }

  res.json({ ok: true, message: 'Downloading update...' });

  // Download and install in background
  const tmpZip = path.join(os.tmpdir(), 'netguard-update.zip');
  const tmpDir = path.join(os.tmpdir(), 'netguard-update-extract');

  downloadFile(downloadUrl, tmpZip)
    .then(() => {
      console.log('[UPDATE] Download complete, extracting...');
      return extractAndInstall(tmpZip, tmpDir);
    })
    .then(() => {
      console.log('[UPDATE] Install complete, restarting...');
      // Send Telegram notification
      if (TELEGRAM.enabled) {
        const time = new Date().toLocaleString('th-TH', { hour12: false });
        sendTelegram(
          `🔄 <b>NetGuard — Updated</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `⏰ Time: ${time}\n` +
          `📦 Auto-update installed\n` +
          `🔃 Restarting...\n` +
          `━━━━━━━━━━━━━━━━━━━━`
        );
      }
      // Restart after short delay
      setTimeout(() => {
        process.exit(0); // Electron will restart if configured
      }, 2000);
    })
    .catch((err) => {
      console.error('[UPDATE] Failed:', err.message);
    });
});

// GET /api/version
app.get('/api/version', (req, res) => {
  res.json({ version: CURRENT_VERSION });
});

// ── Download file following redirects ──
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl) => {
      const mod = reqUrl.startsWith('https') ? https : require('http');
      mod.get(reqUrl, { headers: { 'User-Agent': 'NetGuard-Monitor' } }, (response) => {
        // Follow redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return doRequest(response.headers.location);
        }
        if (response.statusCode !== 200) {
          return reject(new Error('Download failed: HTTP ' + response.statusCode));
        }
        const file = fs.createWriteStream(destPath);
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    doRequest(url);
  });
}

// ── Extract ZIP and copy files ──
function extractAndInstall(zipPath, extractDir) {
  return new Promise((resolve, reject) => {
    // Clean extract dir
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`
      : `unzip -o "${zipPath}" -d "${extractDir}"`;

    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error('Extract failed: ' + (stderr || error.message)));

      try {
        // Find the actual folder inside (GitHub ZIPs have a subfolder)
        let sourceDir = extractDir;
        const entries = fs.readdirSync(extractDir);
        if (entries.length === 1) {
          const sub = path.join(extractDir, entries[0]);
          if (fs.statSync(sub).isDirectory()) {
            sourceDir = sub;
          }
        }

        // Copy update files (skip config/logs)
        const skipFiles = ['telegram-config.json', 'update-config.json', 'node_modules', 'logs'];
        const files = fs.readdirSync(sourceDir);

        files.forEach((file) => {
          if (skipFiles.includes(file)) return;
          const src = path.join(sourceDir, file);
          const dest = path.join(__dirname, file);
          
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dest);
            console.log('[UPDATE] Updated: ' + file);
          }
        });

        // Cleanup
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);

        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ── Version comparison: returns 1 if a > b, -1 if a < b, 0 if equal ──
function compareVersions(a, b) {
  if (!a || !b) return 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ============================================================
//  Start Server
// ============================================================
const PORT = process.env.PORT || 3847;

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`NetGuard Server running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

// If run directly (not from Electron)
if (require.main === module) {
  startServer();
}

module.exports = { startServer, PORT };
