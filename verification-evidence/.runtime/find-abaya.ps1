$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
}
"@
$results = New-Object System.Collections.ArrayList
[W2]::EnumWindows({
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 256
  [void][W2]::GetWindowTextW($h, $sb, 256)
  $pid2 = 0
  [void][W2]::GetWindowThreadProcessId($h, [ref]$pid2)
  $title = $sb.ToString()
  if ($title -match 'AbaYa' -or $title -match 'Control Center') {
    $r = New-Object W2+RECT
    [void][W2]::GetWindowRect($h, [ref]$r)
    $vis = [W2]::IsWindowVisible($h)
    $w = $r.Right - $r.Left
    $hg = $r.Bottom - $r.Top
    Write-Host ("hwnd={0} title='{1}' pid={2} visible={3} rect=[{4},{5},{6},{7}] {8}x{9}" -f $h, $title, $pid2, $vis, $r.Left, $r.Top, $r.Right, $r.Bottom, $w, $hg)
    $results.Add(@{ hwnd=$h; title=$title; visible=$vis; rect=$r }) | Out-Null
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
