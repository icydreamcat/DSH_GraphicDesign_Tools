<#
  psx.ps1 — persistent Photoshop driver.

  WHY THIS EXISTS
  ---------------
  The previous workflow started Photoshop, ran one JSX file, and killed
  Photoshop. Cold start is 40-60 s, so a design that needs 5 iterations cost
  5 minutes of waiting and could never reach the iteration count good design
  needs. Worse, it made the agent avoid Photoshop entirely.

  Photoshop itself is not the slow part: the COM call arrives in ~1-3 s once
  the application is up. So this script separates the two — `-Up` starts
  Photoshop once and leaves it running; every later `-Run` reuses that
  instance.

  WHY A HARD TIMEOUT
  ------------------
  `DoJavaScript` is a blocking out-of-process COM call. If the JSX triggers a
  modal dialog, or Photoshop decides to show one on its own, the call never
  returns and the whole session hangs with no way back — which is exactly what
  happened during capability probing. The earlier approach reported the hang
  only after the fact, because it buffered all output and wrote it at the end.

  Two defences here:
    * `DoJavaScript` runs on a background runspace, so this script can wait
      with a timeout and then kill Photoshop instead of blocking forever.
    * The JSX writes its log line-by-line as it goes (see jsx/ps-probe.jsx),
      so a hang after step 11 still leaves steps 1..11 on disk. A timeout
      report can therefore say WHERE it hung, not merely that it did.

  USAGE
    pwsh -File psx.ps1 -Up                       # start PS, wait for COM
    pwsh -File psx.ps1 -Run script.jsx           # run JSX against live PS
    pwsh -File psx.ps1 -Run script.jsx -Timeout 90
    pwsh -File psx.ps1 -Down                     # close Photoshop
    pwsh -File psx.ps1 -Status
#>
param(
  [switch]$Up,
  [switch]$Down,
  [switch]$Status,
  [string]$Run,
  [int]$Timeout = 120,
  # Defaults to a log beside this script, so it works from any checkout. Pass -Log to
  # redirect it.
  [string]$Log = (Join-Path $PSScriptRoot '.probe\ps.log'),
  # Photoshop's install path, overridable when it lives elsewhere.
  [string]$Exe = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe'
)

$ErrorActionPreference = 'Continue'
$exe = $Exe
$logDir = Split-Path -Parent $Log
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-Log([string]$msg) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss.fff'), $msg)
  Write-Output $line
  Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Get-PhotoshopCom {
  try { return New-Object -ComObject Photoshop.Application } catch { return $null }
}

<#
  Acquire the COM object under a timeout.

  `New-Object -ComObject Photoshop.Application` does NOT fail fast when
  Photoshop is hung: it blocks until the out-of-process server answers, which it
  never will. So a "check whether Photoshop is reachable" call can hang forever
  — measured at over two minutes with no return, which is worse than the failure
  it was meant to detect.

  Running it on a background runspace lets this script wait with a deadline and
  report "not reachable" instead of blocking. This is the same technique `-Run`
  uses for `DoJavaScript`, and for the same reason.
#>
<#
  NOTE ON A TECHNIQUE THAT DOES NOT WORK

  An earlier version of this script carried a `Get-PhotoshopComWithTimeout` that
  ran `New-Object -ComObject Photoshop.Application` on a background runspace and
  waited with a deadline. It is deleted on purpose, not overlooked.

  It does not work. The deadline does fire, but `$ps.Stop()` cannot abort a
  thread that is blocked inside a cross-process COM call, so the wait returns and
  the script then hangs in the cleanup instead — measured at over two minutes,
  worse than the problem it was meant to solve.

  The conclusion drawn from that is the rule this whole bridge now follows:
  THERE IS NO SAFE WAY TO ASK A HUNG PHOTOSHOP ANYTHING. Every decision is made
  from `Get-Process` (instant, always answers), and COM is only touched once the
  process itself reports `Responding = $true`.
#>

# ── -Up ─────────────────────────────────────────────────────────────────────
if ($Up) {
  if (-not (Test-Path $exe)) { Write-Log "FAILED: Photoshop.exe not found at $exe"; exit 1 }

  # ── Decide from the PROCESS LIST alone. Never touch COM here. ─────────────
  #
  # Two failed designs led to this one, and both are worth recording because the
  # reasoning is not obvious.
  #
  # 1. Asking COM whether Photoshop is up hangs indefinitely against a hung
  #    instance: `New-Object -ComObject Photoshop.Application` blocks until the
  #    out-of-process server answers, which it never will.
  #
  # 2. Wrapping that call in a background runspace WITH a timeout does not fix
  #    it either. The deadline fires, but `$ps.Stop()` cannot abort a thread
  #    blocked inside a cross-process COM call, so the wait returns and the
  #    script then hangs on the cleanup instead. Measured: still over two
  #    minutes.
  #
  # The lesson is that there is no safe way to ask a hung Photoshop anything.
  # `Get-Process` answers instantly and is all this needs: if any Photoshop
  # process exists, we must not launch another one — whether it is healthy (it is
  # already running) or hung (a second one makes the leak worse). Only when the
  # list is empty is launching meaningful, and then COM has nothing to block on.
  #
  # This guard exists because of a measured, escalating failure on this machine.
  # When Photoshop cannot finish starting — it hangs on integrated-GPU
  # initialisation here, see HANDOVER.md — it RE-EXECUTES ITSELF repeatedly
  # rather than exiting, and each attempt makes Adobe's licensing subsystem spawn
  # another `adobe_licensing_wf.exe` that never exits, at roughly one every two
  # minutes. Measured after an hour: 33+ leaked helpers holding 300+ MB, still
  # growing.
  $running = @(Get-Process Photoshop -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    $detail = ($running | ForEach-Object {
      $mb = [math]::Round($_.WorkingSet64 / 1MB)
      "PID $($_.Id) (${mb} MB, Responding=$($_.Responding))"
    }) -join '; '
    $anyHung = ($running | Where-Object { -not $_.Responding }).Count -gt 0
    if ($anyHung) {
      Write-Log "REFUSING to launch: a Photoshop process is present and not responding, so it is hung. $detail"
      Write-Log "Launching again would add another instance to a self-restart loop that is already leaking licensing processes."
      Write-Log "Resolve it first: close Photoshop, then check for accumulated 'adobe_licensing_wf' processes."
      exit 4
    }
    Write-Log "REFUSING to launch: Photoshop is already running. $detail"
    Write-Log "Use -Status to inspect it, or -Down to close it first."
    exit 4
  }

  $proc = Start-Process -FilePath $exe -PassThru
  Write-Log ("launched Photoshop PID={0}, waiting for COM..." -f $proc.Id)

  $t0 = Get-Date
  $ok = $null
  for ($i = 1; $i -le 40; $i++) {
    Start-Sleep -Seconds 3
    if (-not $proc.HasExited) {
      # COM can only be trusted once the process reports itself responsive;
      # asking earlier is what hangs.
      $live = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
      if ($null -ne $live -and $live.Responding) {
        $ok = Get-PhotoshopCom
        if ($null -ne $ok) { break }
      }
    } else {
      Write-Log ("Photoshop exited during startup (exit code {0})" -f $proc.ExitCode)
      break
    }
  }
  if ($null -eq $ok) {
    Write-Log ("FAILED: COM unavailable after {0:N0}s" -f ((Get-Date) - $t0).TotalSeconds)
    # Leave nothing behind: a hung Photoshop either gets cleaned up here or it
    # becomes the seed of the self-restart loop described above.
    Get-Process Photoshop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Log "killed the unresponsive instance so it cannot enter the self-restart loop"
    exit 1
  }
  Write-Log ("COM ready in {0:N1}s, version {1}" -f ((Get-Date) - $t0).TotalSeconds, $ok.Version)
  exit 0
}

# ── -Down ───────────────────────────────────────────────────────────────────
if ($Down) {
  Get-Process Photoshop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Write-Log 'Photoshop closed'
  # Report the licensing helpers too. Adobe's licensing subsystem is what
  # accumulates them when Photoshop fails to start, and they are NOT children of
  # Photoshop, so closing Photoshop does not necessarily stop the leak. Naming
  # the count here is how that becomes visible instead of silently growing.
  $lic = @(Get-Process -Name 'adobe_licensing_wf' -ErrorAction SilentlyContinue)
  if ($lic.Count -gt 0) {
    $mb = [math]::Round((($lic | Measure-Object WorkingSet64 -Sum).Sum) / 1MB)
    Write-Log ("note: {0} 'adobe_licensing_wf' processes are still present, holding {1:N0} MB. They are Adobe's own licensing helpers, not Photoshop children." -f $lic.Count, $mb)
  }
  exit 0
}

# ── -Status ─────────────────────────────────────────────────────────────────
if ($Status) {
  $procs = @(Get-Process Photoshop -ErrorAction SilentlyContinue)
  # Report from the process list. COM is deliberately not consulted when a
  # process exists: if it is healthy the process list already says so, and if it
  # is hung, asking COM hangs the status check itself.
  $hung = ($procs | Where-Object { -not $_.Responding }).Count -gt 0
  $lic = @(Get-Process -Name 'adobe_licensing_wf' -ErrorAction SilentlyContinue)
  $licMb = [math]::Round((($lic | Measure-Object WorkingSet64 -Sum).Sum) / 1MB)
  $out = [ordered]@{
    processes   = $procs.Count
    pids        = ($procs | ForEach-Object { $_.Id }) -join ','
    responding  = ($procs | ForEach-Object { $_.Responding }) -join ','
    hung        = $hung
    started     = ($procs | ForEach-Object { try { $_.StartTime.ToString('HH:mm:ss') } catch { '?' } }) -join ','
    memoryMB    = [math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum) / 1MB)
    licensing   = $lic.Count
    licensingMB = $licMb
  }
  $out | ConvertTo-Json -Compress
  exit 0
}

# ── -Run ────────────────────────────────────────────────────────────────────
if ($Run) {
  if (-not (Test-Path $Run)) { Write-Log "FAILED: script not found: $Run"; exit 1 }

  # Refuse to hand JSX to a hung instance: it would block, and the bridge's own
  # timeout would then kill Photoshop mid-operation, which is how a hung instance
  # becomes a self-restart loop.
  $live = @(Get-Process Photoshop -ErrorAction SilentlyContinue)
  if ($live.Count -eq 0) { Write-Log 'FAILED: Photoshop is not running. Use -Up first.'; exit 1 }
  if (($live | Where-Object { -not $_.Responding }).Count -gt 0) {
    Write-Log "FAILED: Photoshop is not responding, so it cannot run a script. Close it first."
    exit 4
  }

  $com = Get-PhotoshopCom
  if ($null -eq $com) {
    Write-Log 'FAILED: Photoshop COM not available despite the process responding.'
    exit 1
  }

  $jsx = [System.IO.File]::ReadAllText($Run)
  Write-Log ("running {0} ({1} chars), timeout {2}s" -f (Split-Path -Leaf $Run), $jsx.Length, $Timeout)

  # DoJavaScript on a background runspace: this is what makes the timeout real.
  # Without it the call blocks this thread and nothing can interrupt it.
  $t0 = Get-Date
  $ps = [PowerShell]::Create()
  $null = $ps.AddScript({
    param($comObj, $src)
    $comObj.DoJavaScript($src)
  }).AddArgument($com).AddArgument($jsx)

  $handle = $ps.BeginInvoke()
  $waited = $handle.AsyncWaitHandle.WaitOne($Timeout * 1000)

  if (-not $waited) {
    Write-Log ("TIMEOUT after {0}s — Photoshop is not returning. Killing it." -f $Timeout)
    try { $ps.Stop() } catch {}
    try { $ps.Dispose() } catch {}
    Get-Process Photoshop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Log 'HINT: inspect the JSX-written log for the last step that completed; that is where it hung.'
    exit 2
  }

  $ret = $null
  try {
    $ret = $ps.EndInvoke($handle)
    Write-Log ("returned in {0:N1}s: {1}" -f ((Get-Date) - $t0).TotalSeconds, ($ret -join ' '))
  } catch {
    Write-Log ('DoJavaScript FAILED: ' + $_.Exception.Message)
    try { $ps.Dispose() } catch {}
    exit 3
  }
  try { $ps.Dispose() } catch {}
  exit 0
}

Write-Log 'nothing to do: pass -Up, -Down, -Status, or -Run <file.jsx>'
exit 1
