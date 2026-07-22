import { execFile } from 'node:child_process';

// ─── Windows Hello (fingerprint / face / device PIN) ─────────
//
// Electron has no built-in Windows Hello API, so we drive the WinRT
// `UserConsentVerifier` through PowerShell. This is the same secure OS
// prompt used across Windows for biometric consent — whatever the user
// has enrolled (fingerprint reader, face, or device PIN) is offered.
//
// Everything here is best-effort: any failure resolves to `false` so the
// password path always remains as a fallback.

const PS_PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $t) { $m = $asTaskGeneric.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
`;

function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // -EncodedCommand takes UTF-16LE base64, which sidesteps all shell quoting.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr && stderr.trim()) || err.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * Is Windows Hello set up and usable on this machine right now?
 * Returns true only when the OS reports `Available` (a verifier device is
 * present and the user has enrolled a credential).
 */
export async function checkBiometricAvailability(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const script = PS_PRELUDE + `
$avail = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
Write-Output "$avail"
`;
    const out = await runPowerShell(script, 10000);
    return out === 'Available';
  } catch {
    return false;
  }
}

/**
 * Show the Windows Hello prompt and resolve true only if the user is
 * successfully verified (fingerprint/face/PIN). Any cancel/error → false.
 */
export async function verifyBiometric(reason = 'Unlock your journal'): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    // Strip characters that could break out of the PowerShell string literal.
    const safeReason = reason.replace(/["`$\r\n]/g, '').slice(0, 120) || 'Unlock your journal';
    // The consent dialog attaches to the foreground window of the *calling*
    // process. Our PowerShell host is hidden, so we spin up an invisible,
    // top-most window and force it foreground first — that makes the Windows
    // Hello prompt appear on top instead of behind (no alt-tab needed).
    const script = PS_PRELUDE + `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace JNative -Name U32 -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.Width = 1; $form.Height = 1
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Show()
$form.Activate()
[void][JNative.U32]::SetForegroundWindow($form.Handle)
[System.Windows.Forms.Application]::DoEvents()
$res = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync("${safeReason}")) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
$form.Close()
if ($res -eq [Windows.Security.Credentials.UI.UserConsentVerificationResult]::Verified) { Write-Output 'VERIFIED' } else { Write-Output "DENIED:$res" }
`;
    // Generous timeout — the user has to physically authenticate.
    const out = await runPowerShell(script, 60000);
    return out === 'VERIFIED';
  } catch {
    return false;
  }
}
