# Windows Anchor Advertiser

This folder lets a Windows machine broadcast `BLUEPOINT-*` as a BLE anchor.

It uses:
- PowerShell launcher: `anchor.ps1`
- .NET C# BLE advertiser: `AnchorAdvertiser/Program.cs`

## Broadcast format
- Local Name: `BLUEPOINT-XX`
- Service UUID: `00001802-0000-1000-8000-00805f9b34fb`
- Service Data section (128-bit): UUID + UTF-8 payload `BLUEPOINT-XX`

Your Android scanner can discover it by name (`BLUEPOINT-*`) and BLE metadata.

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

Options:

```powershell
.\anchor.ps1 -Index 1
.\anchor.ps1 -Id BLUEPOINT-01
.\anchor.ps1 -BuildOnly
```

Or from Command Prompt:

```cmd
anchor.cmd -Index 2
```

Stop advertising with `Ctrl+C`.

## Notes
- If advertising aborts, your Bluetooth adapter/driver may not support peripheral advertising.
- Keep one unique ID per anchor device (`BLUEPOINT-01` to `BLUEPOINT-04`).
