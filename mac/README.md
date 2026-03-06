# macOS Anchor Advertiser

This folder lets a Mac act as a BLE anchor for your existing Android scanner flow.

It advertises the same format your app expects:
- Service UUID: `00001802-0000-1000-8000-00805f9b34fb`
- Service Data payload: UTF-8 bytes of `BLUEPOINT-XX`

## Files
- `anchor.sh`: launcher script (interactive or CLI).
- `BLEAnchorAdvertiser.swift`: CoreBluetooth advertiser implementation.

## Requirements
- macOS with BLE peripheral advertising support.
- Xcode Command Line Tools (`swiftc`).
- Bluetooth ON.

## First-time setup
From repo root:
```bash
cd mac
chmod +x anchor.sh
./anchor.sh --build-only
```

## Run
Interactive mode:
```bash
./anchor.sh
```

Direct index:
```bash
./anchor.sh --index 1
```

Direct ID:
```bash
./anchor.sh --id BLUEPOINT-01
```

Direct ID with optional meter coordinates:
```bash
./anchor.sh --id BLUEPOINT-01 --x 0 --y 5
```

Run from repo root without changing directory:
```bash
./mac/anchor.sh --id BLUEPOINT-01 --x 0 --y 5
```

Stop advertising:
- Press `Ctrl+C`.

## Notes
- If macOS asks for Bluetooth permission, allow it.
- Some Mac hardware may not support BLE peripheral mode; the tool will report and exit if unsupported.
- If Bluetooth is OFF or permission is denied, the tool prints the reason and exits (no hang).
- For 4 anchors, run on 4 separate devices with unique IDs (`BLUEPOINT-01..04`).
- Coordinate flags are optional metadata for operator setup logs; BLE service data format remains `BLUEPOINT-XX` for scanner compatibility.
