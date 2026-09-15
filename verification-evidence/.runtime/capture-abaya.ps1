$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W4 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
}
"@
$targetHwnd = [IntPtr]::Zero
[W4]::EnumWindows({
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 256
  [void][W4]::GetWindowTextW($h, $sb, 256)
  $pid2 = 0
  [void][W4]::GetWindowThreadProcessId($h, [ref]$pid2)
  $title = $sb.ToString()
  $cn = New-Object System.Text.StringBuilder 256
  [void][W4]::GetClassNameW($h, $cn, 256)
  $class = $cn.ToString()
  if ($title -match 'AbaYa Track') {
    $r = New-Object W4+RECT
    [void][W4]::GetWindowRect($h, [ref]$r)
    if ($script:targetHwnd -eq [IntPtr]::Zero -and $r.Right -gt $r.Left -and $r.Bottom -gt $r.Top) {
      $script:targetHwnd = $h
      Write-Host ("Found hwnd={0} class='{1}' title='{2}' pid={3} rect=[{4},{5},{6},{7}]" -f $h, $class, $title, $pid2, $r.Left, $r.Top, $r.Right, $r.Bottom)
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($targetHwnd -eq [IntPtr]::Zero) { Write-Host "[FAIL] no launcher"; exit 1 }

# Check foreground
$fg = [W4]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][W4]::GetWindowTextW($fg, $sb, 256)
Write-Host ("FG window: hwnd={0} title='{1}'" -f $fg, $sb.ToString())

# Move to known location and bring to top
[W4]::MoveWindow($targetHwnd, 50, 30, 1280, 800, $true) | Out-Null
Start-Sleep -Milliseconds 300
[W4]::ShowWindow($targetHwnd, 9) | Out-Null  # SW_RESTORE
[W4]::BringWindowToTop($targetHwnd) | Out-Null
[W4]::SetForegroundWindow($targetHwnd) | Out-Null
Start-Sleep -Seconds 2

# Re-check
$fg = [W4]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][W4]::GetWindowTextW($fg, $sb, 256)
Write-Host ("After bring-to-top, FG: hwnd={0} title='{1}'" -f $fg, $sb.ToString())

# Print all top-level windows in z-order (first one is topmost)
Write-Host "`nAll top-level visible windows:"
[W4]::EnumWindows({
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 256
  [void][W4]::GetWindowTextW($h, $sb, 256)
  $pid2 = 0
  [void][W4]::GetWindowThreadProcessId($h, [ref]$pid2)
  $title = $sb.ToString()
  $vis = [W4]::IsWindowVisible($h)
  $cn = New-Object System.Text.StringBuilder 256
  [void][W4]::GetClassNameW($h, $cn, 256)
  $class = $cn.ToString()
  if ($vis -and $title.Length -gt 0) {
    $r = New-Object W4+RECT
    [void][W4]::GetWindowRect($h, [ref]$r)
    Write-Host ("  hwnd={0} pid={1} class='{2}' title='{3}' [{4},{5} {6}x{7}]" -f $h, $pid2, $class, $title, $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
