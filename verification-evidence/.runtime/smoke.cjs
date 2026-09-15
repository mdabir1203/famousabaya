const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  let bin;
  try {
    bin = chromium.executablePath();
  } catch (e) {
    console.log('NO_BIN: ' + e.message);
    process.exit(1);
  }
  console.log('BIN: ' + bin);
  console.log('EXISTS: ' + fs.existsSync(bin));
  process.exit(0);
})();
