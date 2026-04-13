# Tunnel on Windows — simplest fix (“credential not found”)

Ignore everything else until you have done **these 5 steps on the factory PC** (the same PC that runs AbaYa).

## The only simple path

1. **Start AbaYa** on that PC (`install\START-AbaYa-Server.bat`). Leave it running.

2. Open **[Cloudflare Zero Trust](https://one.dash.cloudflare.com/)** in the browser → **Networks** → **Tunnels**.

3. **Click your tunnel** (the one for `famousabaya.getwaved.ai`).

4. Find **Install connector** (or **Configure** → instructions for **Windows**). Cloudflare shows **one long command** (often starts with `cloudflared.exe` and includes a **token**).  
   - Open **Command Prompt** on that **same** PC.  
   - **Paste the command. Press Enter. Wait until it finishes.**  
   That step creates the missing **credential file** under your user folder (`.cloudflared`).

5. In the same tunnel page, under **Public hostnames** (or **Published application**), set:
   - **Hostname:** `famousabaya.getwaved.ai`
   - **Service / URL:** `http://127.0.0.1:3050`  
   (If you changed `PORT` in `.env`, use that port instead of `3050`.)

Then open **`https://famousabaya.getwaved.ai/kiosk.html`** in a browser.

**That’s it.** “Credential not found” means step **4** never ran successfully on this PC (or ran under a **different Windows user**). Run step 4 again while logged in as the user who will always run the tunnel.

---

## Optional check (after step 4)

In File Explorer, go to:

`C:\Users\<YourWindowsLogin>\.cloudflared\`

You should see a file named like **`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json`**. If that folder is empty, step **4** did not work — repeat it or copy the command from the dashboard again.

From the AbaYa repo folder you can also run:

`powershell -File scripts\check-cloudflared-credentials.ps1`

---

## If it still errors

| Problem | Fix |
|--------|-----|
| **Credential not found** | Step **4** again. Same Windows user as when you start `cloudflared`. |
| **502 / bad gateway** | AbaYa not running, or wrong port in step **5** (must match `.env` `PORT`, default **3050**). |
| **You use a `config.yml`** | Open `C:\Users\<You>\.cloudflared\config.yml`. Line **`credentials-file:`** must point to the **real path** of that **`.json`**. See [config/cloudflared.config.example.yml](../config/cloudflared.config.example.yml). |

---

## More detail (optional)

Full remote access guide: [REMOTE_ACCESS.md](REMOTE_ACCESS.md).
