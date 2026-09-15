'use strict';
const fs = require('fs');
const p = 'C:/Users/mabba/Desktop/AbaYa-Track-v1.0.2/tests/dashboard-live-tick.test.mjs';
let src = fs.readFileSync(p, 'utf8');

// The append script lost its double-backslashes on \s and \* — fix them.
src = src.replace(/const ZOMBIE_MAX_AGE_SECs\*=s\*8s\*\*s\*3600s\*;/g,
                   'const ZOMBIE_MAX_AGE_SEC\\s*=\\s*8\\s*\\*\\s*3600\\s*;');
src = src.replace(/function isZombieActive\\s\*\(/g,
                   'function isZombieActive\\s*\\(');
src = src.replace(/function liveActiveIds\\s\*\(/g,
                   'function liveActiveIds\\s*\\(');
fs.writeFileSync(p, src, 'utf8');
console.log('OK wrote', src.length, 'bytes');
