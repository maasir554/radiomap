import CoreBluetooth
import Dispatch
import Foundation

private let serviceUUIDString = "00001802-0000-1000-8000-00805f9b34fb"

private func usageAndExit(code: Int32 = 2) -> Never {
    print(
        """
        Usage:
          ble-anchor BLUEPOINT-XX
          ble-anchor --id BLUEPOINT-XX [--x <meters> --y <meters>]
        """
    )
    exit(code)
}

private func validateAnchorId(_ value: String) -> Bool {
    let pattern = #"^BLUEPOINT-\d{2}$"#
    return value.range(of: pattern, options: .regularExpression) != nil
}

struct ParsedOptions {
    let anchorId: String
    let coordinates: (x: Double, y: Double)?
}

private func parseDouble(_ raw: String, flag: String) -> Double {
    guard let value = Double(raw) else {
        print("Invalid value for \(flag): \(raw)")
        usageAndExit()
    }
    return value
}

private func parseOptions(from arguments: [String]) -> ParsedOptions {
    var index = 0
    var idFromFlag: String?
    var xCoordinate: Double?
    var yCoordinate: Double?
    var positional: [String] = []

    while index < arguments.count {
        let argument = arguments[index]
        switch argument {
        case "-h", "--help":
            usageAndExit(code: 0)
        case "--id":
            let next = index + 1
            guard next < arguments.count else {
                print("Missing value for --id")
                usageAndExit()
            }
            idFromFlag = arguments[next]
            index += 2
        case "--x":
            let next = index + 1
            guard next < arguments.count else {
                print("Missing value for --x")
                usageAndExit()
            }
            xCoordinate = parseDouble(arguments[next], flag: "--x")
            index += 2
        case "--y":
            let next = index + 1
            guard next < arguments.count else {
                print("Missing value for --y")
                usageAndExit()
            }
            yCoordinate = parseDouble(arguments[next], flag: "--y")
            index += 2
        default:
            if argument.hasPrefix("--") {
                print("Unknown option: \(argument)")
                usageAndExit()
            }
            positional.append(argument)
            index += 1
        }
    }

    if idFromFlag != nil, !positional.isEmpty {
        print("Provide anchor ID either positionally or via --id, not both.")
        usageAndExit()
    }

    guard let rawAnchorId = idFromFlag ?? (positional.count == 1 ? positional.first : nil) else {
        print("Missing anchor ID.")
        usageAndExit()
    }

    let anchorId = rawAnchorId.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard validateAnchorId(anchorId) else {
        print("Invalid anchor ID: \(anchorId)")
        print("Expected format: BLUEPOINT-01")
        usageAndExit()
    }

    let coordinates: (x: Double, y: Double)?
    switch (xCoordinate, yCoordinate) {
    case (.none, .none):
        coordinates = nil
    case let (.some(x), .some(y)):
        coordinates = (x: x, y: y)
    default:
        print("Both --x and --y must be provided together.")
        usageAndExit()
    }

    return ParsedOptions(anchorId: anchorId, coordinates: coordinates)
}

final class AnchorAdvertiser: NSObject, CBPeripheralManagerDelegate {
    private let anchorId: String
    private let coordinates: (x: Double, y: Double)?
    private let serviceUUID = CBUUID(string: serviceUUIDString)
    private var manager: CBPeripheralManager!
    private var started = false
    private var hasTerminated = false

    init(anchorId: String, coordinates: (x: Double, y: Double)?) {
        self.anchorId = anchorId
        self.coordinates = coordinates
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
            shutdownAndExit(code: 1)
        case .unauthorized:
            print("Bluetooth permission denied. Allow terminal access in macOS settings and rerun.")
            shutdownAndExit(code: 1)
        case .unsupported:
            print("This Mac does not support BLE peripheral advertising.")
            shutdownAndExit(code: 1)
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
        if let coordinates {
            print(
                String(
                    format: "Anchor coordinates (meters): x=%.2f, y=%.2f",
                    coordinates.x,
                    coordinates.y
                )
            )
        }
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

        // Keep the payload under legacy 31-byte advertising limits.
        // We prioritize serviceData + localName (anchor ID) and omit serviceUUID list,
        // otherwise macOS may drop one or both identity fields and scanners only see MAC.
        let advertisement: [String: Any] = [
            // CoreBluetooth's XPC bridge expects NSString keys for nested dictionaries.
            CBAdvertisementDataServiceDataKey: [serviceUUID.uuidString: payload],
            CBAdvertisementDataLocalNameKey: anchorId,
        ]

        manager.startAdvertising(advertisement)
    }

    func shutdownAndExit(code: Int32 = 0) {
        if hasTerminated {
            return
        }
        hasTerminated = true
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

let parsed = parseOptions(from: Array(CommandLine.arguments.dropFirst()))
let advertiser = AnchorAdvertiser(anchorId: parsed.anchorId, coordinates: parsed.coordinates)
// Keep this alive for the full process lifetime so SIGINT/SIGTERM handlers remain active.
let signalTrap = SignalTrap {
    advertiser.shutdownAndExit(code: 130)
}

_ = signalTrap
RunLoop.main.run()
