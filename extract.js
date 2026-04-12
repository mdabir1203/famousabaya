const fs = require('fs');
const src = fs.readFileSync('C:\\Users\\mabba\\Downloads\\abaya_biometric_barcode_system_v3.html', 'utf8');
const style = src.match(/<style>[\s\S]*?<\/style>/)[0];
const kiosk = src.split('<!-- ===== TABLET SECTION ===== -->')[1].split('<!-- ===== CEO DASHBOARD ===== -->')[0];
let dash = src.split('<!-- ===== CEO DASHBOARD ===== -->')[1].split('<!-- ===== REPORT DISPATCH MODAL ===== -->')[0];
// Ensure dashboard doesn't have display:none
dash = dash.replace('id="sec-dash" style="display:none"', 'id="sec-dash" style="display:block"');

const modal = src.split('<!-- ===== REPORT DISPATCH MODAL ===== -->')[1].split('<!-- ===== TOAST ===== -->')[0];
const toast = src.split('<!-- ===== TOAST ===== -->')[1].split('<script>')[0];

const baseHead = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>AbaYa Track</title>
${style}
<script src="/data.js"></script>
<script src="/socket.io/socket.io.js"></script>
</head>
<body>
<div class="app">`;

const tbTemplate = (title, sub) => `
<div class="topbar">
  <div class="tb-brand">
    <div class="tb-logo">&#129525;</div>
    <div>
      <div class="tb-name">AbaYa Track</div>
      <div class="tb-sub">${title} | ${sub}</div>
    </div>
  </div>
</div>`;

const endHtml = `</div><script src="/js/app.js"></script></body></html>`;

fs.writeFileSync('C:\\Users\\mabba\\Downloads\\abaya-server\\public\\kiosk.html', baseHead + tbTemplate('Floor Kiosk', 'Worker Mode') + kiosk + toast + '<script src="kiosk.js"></script></div></body></html>');
fs.writeFileSync('C:\\Users\\mabba\\Downloads\\abaya-server\\public\\dashboard.html', baseHead + tbTemplate('Dashboard', 'Real-time View') + dash + modal + toast + '<script src="dashboard.js"></script></div></body></html>');
console.log('Split files created!');
