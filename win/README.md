# Windows Anchor Advertiser

This folder lets a Windows machine broadcast `BLUEPOINT-*` as a BLE anchor.

It uses:
- PowerShell launcher: `anchor.ps1`
- .NET C# BLE advertiser: `AnchorAdvertiser/Program.cs`

## Broadcast format
- Service Data section (16-bit, AD type `0x16`): UUID `0x1802` + UTF-8 payload `BLUEPOINT-XX`
- Full UUID used by scanner: `00001802-0000-1000-8000-00805f9b34fb`

Your Android scanner discovers anchors from BLE service/manufacturer payloads.  
Windows may not always expose `LocalName` consistently in scan callbacks.

## Requirements
- Windows 10/11 with BLE adapter that supports advertising/peripheral mode.
- .NET 8 SDK installed (`dotnet --version`).
- Bluetooth ON.

## Run
Open PowerShell in this folder:

```powershell
cd C:\path\to\radiomap\win
.\anchor.ps1
```

If PowerShell blocks script execution, run one of these first:

```powershell
# current terminal session only (recommended)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# then run
.\anchor.ps1
```

or run through Command Prompt (already bypasses policy for this script):

```cmd
anchor.cmd -Index 2
```

Options:

```powershell
.\anchor.ps1 -Index 1
.\anchor.ps1 -Id BLUEPOINT-01
.\anchor.ps1 -BuildOnly
```

Stop advertising with `Ctrl+C`.

## Notes
- If you saw `Failed: Value does not fall within expected range`, update to latest code.  
  This flow now uses a compact BLE payload compatible with Windows advertiser size limits.
- If advertising aborts, your Bluetooth adapter/driver may not support peripheral advertising.
- Keep one unique ID per anchor device (`BLUEPOINT-01` to `BLUEPOINT-04`).
