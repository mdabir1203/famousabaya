'use strict';
// One-off screenshot tool for verification-evidence. Launched via:
//   electron . --capture-screenshot=PATH [--auto-open=support|rollback]
// Saves a PNG of the launcher window directly via webContents.capturePage()
// (bypasses the OS-level focus / Z-order issues that block PrintScreen).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

let outPath = null;
let autoOpen = '';
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (typeof a === 'string') {
    if (a.indexOf('--capture-screenshot=') === 0) {
      outPath = a.split('=').slice(1).join('=');
    } else if (a.indexOf('--auto-open=') === 0) {
      autoOpen = a.split('=')[1];
    }
  }
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#1f1633',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'), autoOpen ? { hash: autoOpen } : undefined);
  win.webContents.once('did-finish-load', () => {
    // Wait a beat for fonts + initial paint
    setTimeout(async () => {
      try {
        const hash = await win.webContents.executeJavaScript('window.location.hash');
        const isSupportHidden = await win.webContents.executeJavaScript('document.getElementById("supportMount") && document.getElementById("supportMount").hasAttribute("hidden")');
        const isRollbackHidden = await win.webContents.executeJavaScript('document.getElementById("rollbackMount") && document.getElementById("rollbackMount").hasAttribute("hidden")');
        console.log('hash=' + JSON.stringify(hash) + ' supportHidden=' + isSupportHidden + ' rollbackHidden=' + isRollbackHidden);
        // Force-open if needed (auto-open hash didn't trigger)
        if (autoOpen === 'support' && isSupportHidden) {
          // Same approach as rollback: click the button so setSupportOpen runs
          // through the renderer's normal code path.
          await win.webContents.executeJavaScript(`
            (function(){
              var btn = document.getElementById('btnToggleSupport');
              if (btn) btn.click();
            })();
          `);
        }
        if (autoOpen === 'rollback' && isRollbackHidden) {
          // Programmatically click the rollback button so the renderer's
          // setRollbackOpen + renderRollback flow runs (otherwise the panel
          // would be empty since renderRollback only fires on toggle).
          await win.webContents.executeJavaScript(`
            (function(){
              var btn = document.getElementById('btnToggleRollback');
              if (btn) btn.click();
            })();
          `);
        }
        await new Promise(r => setTimeout(r, 1500));
        const dims = await win.webContents.executeJavaScript(`
          ({
            shellH: document.querySelector('.shell').getBoundingClientRect().height,
            mountH: document.getElementById('supportMount').getBoundingClientRect().height,
            mountHidden: document.getElementById('supportMount').hasAttribute('hidden'),
            rollH: document.getElementById('rollbackMount').getBoundingClientRect().height,
            rollHidden: document.getElementById('rollbackMount').hasAttribute('hidden'),
            rollShell: document.querySelector('.rollback-shell') ? document.querySelector('.rollback-shell').getBoundingClientRect().height : null,
            gridH: document.querySelector('.support-grid') ? document.querySelector('.support-grid').getBoundingClientRect().height : null,
            cards: document.querySelectorAll('.support-card').length,
            mainH: document.querySelector('main').getBoundingClientRect().height,
          })
        `);
        console.log('dims=' + JSON.stringify(dims));
        const img = await win.webContents.capturePage();
        if (!outPath) { console.error('no --capture-screenshot= path'); app.quit(); return; }
        fs.writeFileSync(outPath, img.toPNG());
        console.log('saved ' + outPath);
      } catch (err) {
        console.error('capture failed: ' + err.message);
      }
      app.quit();
    }, 1500);
  });
});
