import CoreBluetooth
import Dispatch
import Foundation

private let serviceUUIDString = "00001802-0000-1000-8000-00805f9b34fb"

private func usageAndExit() -> Never {
    print("Usage: ble-anchor BLUEPOINT-XX")
    exit(2)
}

private func validateAnchorId(_ value: String) -> Bool {
    let pattern = #"^BLUEPOINT-\d{2}$"#
    return value.range(of: pattern, options: .regularExpression) != nil
}

final class AnchorAdvertiser: NSObject, CBPeripheralManagerDelegate {
    private let anchorId: String
    private let serviceUUID = CBUUID(string: serviceUUIDString)
    private var manager: CBPeripheralManager!
    private var started = false

    init(anchorId: String) {
        self.anchorId = anchorId
        super.init()
        manager = CBPeripheralManager(
            delegate: self,
            queue: nil,
            options: [CBPeripheralManagerOptionShowPowerAlertKey: true]
        )
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            startAdvertisingIfNeeded()
        case .poweredOff:
            print("Bluetooth is OFF. Turn it ON and rerun.")
        case .unauthorized:
            print("Bluetooth permission denied. Allow terminal access in macOS settings and rerun.")
        case .unsupported:
            print("This Mac does not support BLE peripheral advertising.")
        case .resetting:
            print("Bluetooth is resetting. Waiting...")
        case .unknown:
            print("Bluetooth state unknown. Waiting...")
        @unknown default:
            print("Unknown Bluetooth state.")
        }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error {
            print("Failed to start advertising: \(error.localizedDescription)")
            shutdownAndExit(code: 1)
            return
        }

        print("Advertising started.")
        print("Anchor ID: \(anchorId)")
        print("Service UUID: \(serviceUUIDString)")
        print("Payload bytes: \(anchorId.utf8.count)")
        print("Press Ctrl+C to stop.")
    }

    func startAdvertisingIfNeeded() {
        if started || manager.state != .poweredOn {
            return
        }
        started = true

        guard let payload = anchorId.data(using: .utf8) else {
            print("Failed to encode anchor ID payload.")
            shutdownAndExit(code: 1)
            return
        }

        // Matches Android advertiser format:
        // - Service UUID advertised
        // - Service Data = UTF-8 bytes of BLUEPOINT-XX
        let advertisement: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataServiceDataKey: [serviceUUID: payload],
        ]

        manager.startAdvertising(advertisement)
    }

    func shutdownAndExit(code: Int32 = 0) {
        if manager.isAdvertising {
            manager.stopAdvertising()
            print("Advertising stopped.")
        }
        CFRunLoopStop(CFRunLoopGetMain())
        if code != 0 {
            exit(code)
        }
    }
}

final class SignalTrap {
    private var sources: [DispatchSourceSignal] = []

    init(onTerminate: @escaping () -> Void) {
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)

        for signalValue in [SIGINT, SIGTERM] {
            let source = DispatchSource.makeSignalSource(signal: signalValue, queue: .main)
            source.setEventHandler(handler: onTerminate)
            source.resume()
            sources.append(source)
        }
    }
}

guard CommandLine.arguments.count == 2 else {
    usageAndExit()
}

let anchorId = CommandLine.arguments[1].trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
guard validateAnchorId(anchorId) else {
    print("Invalid anchor ID: \(anchorId)")
    print("Expected format: BLUEPOINT-01")
    usageAndExit()
}

let advertiser = AnchorAdvertiser(anchorId: anchorId)
let _ = SignalTrap {
    advertiser.shutdownAndExit()
}

RunLoop.main.run()
