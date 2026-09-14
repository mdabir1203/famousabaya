'use strict';
const fs = require('fs');
const p = 'C:/Users/mabba/Desktop/AbaYa-Track-v1.0.2/tests/dashboard-live-tick.test.mjs';
let src = fs.readFileSync(p, 'utf8');
src = src.replace(/function isZombieActives\*\(/g,
                   'function isZombieActive\\s*\\(');
src = src.replace(/function liveActiveIdss\*\(/g,
                   'function liveActiveIds\\s*\\(');
fs.writeFileSync(p, src, 'utf8');
console.log('OK wrote', src.length, 'bytes');
