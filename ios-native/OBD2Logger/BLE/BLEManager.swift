import CoreBluetooth
import Foundation
import Observation

/// Wraps `CBCentralManager` + `CBPeripheral` delegates with an Observable
/// state machine + async/await on top.
///
/// Responsibilities:
///   - track Bluetooth power state
///   - scan for devices advertising any `KnownServices.serviceUUIDs`
///   - connect to a chosen peripheral, discover services + characteristics,
///     pick the (tx, rx) pair following the same priority/fallback rules as
///     the web app's `BleTransport`
///   - expose an `AsyncStream<Data>` of inbound notifications
///   - expose a `send(_:)` that chunks writes to fit the MTU
///
/// Single shared instance: `BLEManager.shared`.
@MainActor
@Observable
final class BLEManager: NSObject {

    // MARK: - State

    enum PowerState {
        case unknown
        case poweredOff
        case unauthorized
        case poweredOn
        case unsupported
    }

    enum ConnectionState: Equatable {
        case idle
        case scanning
        case connecting(name: String)
        case discovering(name: String)
        case connected(name: String, picked: PickedDescription)
        case error(String)
    }

    struct PickedDescription: Equatable {
        let serviceUUID: String
        let txUUID: String
        let rxUUID: String
        let source: PickSource
    }

    enum PickSource: String {
        case known    // matched an entry in KnownServices.serviceUUIDs
        case fallback // probed all services for any tx/rx pair
    }

    struct DiscoveredDevice: Identifiable, Equatable {
        let id: UUID                    // CBPeripheral.identifier
        let name: String
        let rssi: Int
        let advertisedServices: [String]

        nonisolated static func == (lhs: DiscoveredDevice, rhs: DiscoveredDevice) -> Bool {
            lhs.id == rhs.id
        }
    }

    // MARK: - Observable state

    private(set) var powerState: PowerState = .unknown
    private(set) var connectionState: ConnectionState = .idle
    private(set) var discovered: [DiscoveredDevice] = []

    // MARK: - Inbound notification stream

    /// Yields raw byte chunks as the rx characteristic notifies. Subscribers
    /// (the ELM327 layer, in Phase 2) line-buffer these into responses.
    let inboundStream: AsyncStream<Data>
    private let inboundContinuation: AsyncStream<Data>.Continuation

    // MARK: - Internals

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var picked: (service: CBService, tx: CBCharacteristic, rx: CBCharacteristic)?

    /// Continuation woken when `centralManagerDidUpdateState` fires.
    private var powerStateContinuations: [CheckedContinuation<PowerState, Never>] = []
    /// Continuation woken when `didConnect` fires for the in-flight peripheral.
    private var connectContinuation: CheckedContinuation<Void, Error>?
    /// Continuation woken when service+characteristic discovery completes.
    private var discoverContinuation: CheckedContinuation<PickedDescription, Error>?
    /// Tracks which characteristics still need their characteristics discovered
    /// before we can pick.
    private var pendingServiceDiscovery: Int = 0

    static let shared = BLEManager()

    override init() {
        let stream = AsyncStream<Data>.makeStream(bufferingPolicy: .unbounded)
        self.inboundStream = stream.stream
        self.inboundContinuation = stream.continuation
        super.init()
        // Nil queue → delegate callbacks come on the main queue, which matches
        // our @MainActor isolation. Power-on may take a moment; we wait via
        // `awaitPoweredOn()` before scanning.
        self.central = CBCentralManager(delegate: self, queue: nil, options: nil)
    }

    // MARK: - Public API

    /// Awaits Bluetooth power-on. Returns the eventual `PowerState`.
    /// If already powered on / off / unauthorized, returns immediately.
    func awaitPowerStateSettled() async -> PowerState {
        if powerState != .unknown { return powerState }
        return await withCheckedContinuation { continuation in
            powerStateContinuations.append(continuation)
        }
    }

    /// Begin scanning for nearby BLE peripherals advertising any of the
    /// `KnownServices.serviceUUIDs`. Updates `discovered` as devices are seen.
    func startScan() {
        guard central.state == .poweredOn else { return }
        discovered.removeAll()
        connectionState = .scanning
        central.scanForPeripherals(
            withServices: KnownServices.serviceUUIDs,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
    }

    func stopScan() {
        central.stopScan()
        if case .scanning = connectionState {
            connectionState = .idle
        }
    }

    /// Connect to a previously-discovered device, discover its OBD2 service +
    /// tx/rx characteristics, and subscribe for notifications. Resolves once
    /// the transport is ready for `send(_:)`.
    func connect(_ device: DiscoveredDevice) async throws -> PickedDescription {
        stopScan()
        guard let cbPeripheral = central.retrievePeripherals(withIdentifiers: [device.id]).first else {
            throw BLEError.deviceNotFound
        }
        cbPeripheral.delegate = self
        self.peripheral = cbPeripheral
        connectionState = .connecting(name: device.name)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.connectContinuation = continuation
            self.central.connect(cbPeripheral, options: nil)
        }

        connectionState = .discovering(name: device.name)
        let picked = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PickedDescription, Error>) in
            self.discoverContinuation = continuation
            cbPeripheral.discoverServices(KnownServices.serviceUUIDs)
        }
        connectionState = .connected(name: device.name, picked: picked)
        return picked
    }

    /// Disconnect cleanly and reset connection state.
    func disconnect() {
        if let p = peripheral {
            central.cancelPeripheralConnection(p)
        }
        peripheral = nil
        picked = nil
        connectionState = .idle
    }

    /// Write bytes to the tx characteristic, chunked to 20 bytes (typical
    /// MTU floor for un-negotiated BLE links).
    func send(_ data: Data) async throws {
        guard let peripheral, let picked else { throw BLEError.notConnected }
        let chunkSize = 20
        let preferNoResponse = picked.tx.properties.contains(.writeWithoutResponse)
        let writeType: CBCharacteristicWriteType = preferNoResponse ? .withoutResponse : .withResponse

        var index = 0
        while index < data.count {
            let end = min(index + chunkSize, data.count)
            let chunk = data.subdata(in: index..<end)
            peripheral.writeValue(chunk, for: picked.tx, type: writeType)
            index = end
            // For .withResponse, CB blocks until the peer acks; for
            // .withoutResponse, give the radio a moment so we don't flood.
            if !preferNoResponse {
                try await Task.sleep(nanoseconds: 5_000_000) // 5ms
            }
        }
    }

    // MARK: - Power state plumbing

    private func resolvePowerStateContinuations(_ state: PowerState) {
        let pending = powerStateContinuations
        powerStateContinuations.removeAll()
        for continuation in pending {
            continuation.resume(returning: state)
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension BLEManager: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let next: PowerState = switch central.state {
        case .poweredOn: .poweredOn
        case .poweredOff: .poweredOff
        case .unauthorized: .unauthorized
        case .unsupported: .unsupported
        case .resetting, .unknown: .unknown
        @unknown default: .unknown
        }
        Task { @MainActor in
            self.powerState = next
            if next != .unknown {
                self.resolvePowerStateContinuations(next)
            }
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let id = peripheral.identifier
        let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? "(unnamed)"
        let rssi = RSSI.intValue
        let advertisedServices = ((advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []).map { $0.uuidString }
        let device = DiscoveredDevice(id: id, name: name, rssi: rssi, advertisedServices: advertisedServices)

        Task { @MainActor in
            if let existing = self.discovered.firstIndex(where: { $0.id == id }) {
                self.discovered[existing] = device
            } else {
                self.discovered.append(device)
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Task { @MainActor in
            self.connectContinuation?.resume()
            self.connectContinuation = nil
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        let message = error?.localizedDescription ?? "Connection failed."
        Task { @MainActor in
            self.connectContinuation?.resume(throwing: BLEError.connectFailed(message))
            self.connectContinuation = nil
            self.connectionState = .error(message)
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        Task { @MainActor in
            self.peripheral = nil
            self.picked = nil
            if let error = error {
                self.connectionState = .error("Disconnected: \(error.localizedDescription)")
            } else {
                self.connectionState = .idle
            }
        }
    }
}

// MARK: - CBPeripheralDelegate

extension BLEManager: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            Task { @MainActor in
                self.discoverContinuation?.resume(throwing: BLEError.serviceDiscoveryFailed(error.localizedDescription))
                self.discoverContinuation = nil
            }
            return
        }
        // For each advertised service, request its characteristics.
        let services = peripheral.services ?? []
        Task { @MainActor in
            self.pendingServiceDiscovery = services.count
        }
        for service in services {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    nonisolated func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        Task { @MainActor in
            self.pendingServiceDiscovery -= 1
            if self.pendingServiceDiscovery > 0 { return }

            // All services have reported their characteristics. Pick a tx/rx
            // pair using the same priority/fallback logic as the web app.
            guard let services = peripheral.services else {
                self.discoverContinuation?.resume(throwing: BLEError.noUsableService)
                self.discoverContinuation = nil
                return
            }

            if let pickResult = self.pickTxRx(from: services) {
                self.picked = (pickResult.service, pickResult.tx, pickResult.rx)
                peripheral.setNotifyValue(true, for: pickResult.rx)
                let description = PickedDescription(
                    serviceUUID: pickResult.service.uuid.uuidString,
                    txUUID: pickResult.tx.uuid.uuidString,
                    rxUUID: pickResult.rx.uuid.uuidString,
                    source: pickResult.source
                )
                self.discoverContinuation?.resume(returning: description)
                self.discoverContinuation = nil
            } else {
                self.discoverContinuation?.resume(throwing: BLEError.noUsableService)
                self.discoverContinuation = nil
            }
        }
    }

    nonisolated func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard let value = characteristic.value else { return }
        // Forward bytes to the inbound stream regardless of which characteristic
        // they came from — only one rx is subscribed at a time.
        inboundContinuation.yield(value)
    }
}

// MARK: - Service / characteristic picking

private extension BLEManager {
    struct PickResult {
        let service: CBService
        let tx: CBCharacteristic
        let rx: CBCharacteristic
        let source: PickSource
    }

    func pickTxRx(from services: [CBService]) -> PickResult? {
        // 1) Priority: try known service UUIDs in order.
        for wanted in KnownServices.serviceUUIDs {
            if let svc = services.first(where: { $0.uuid == wanted }),
               let chars = svc.characteristics,
               let pair = pickFromCharacteristics(chars) {
                return PickResult(service: svc, tx: pair.tx, rx: pair.rx, source: .known)
            }
        }
        // 2) Fallback: probe every service for a writable + notifiable pair.
        for svc in services {
            guard let chars = svc.characteristics else { continue }
            if let pair = pickFromCharacteristics(chars) {
                return PickResult(service: svc, tx: pair.tx, rx: pair.rx, source: .fallback)
            }
        }
        return nil
    }

    func pickFromCharacteristics(_ chars: [CBCharacteristic]) -> (tx: CBCharacteristic, rx: CBCharacteristic)? {
        let writable = chars.filter { $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse) }
        let notifiable = chars.filter { $0.properties.contains(.notify) || $0.properties.contains(.indicate) }
        guard !writable.isEmpty, !notifiable.isEmpty else { return nil }

        // Prefer a write-only characteristic for tx and notify-only for rx so
        // we don't accidentally choose the same characteristic for both paths
        // when distinct ones exist.
        let txOnly = writable.first { c in
            !c.properties.contains(.notify) && !c.properties.contains(.indicate)
        }
        let rxOnly = notifiable.first { c in
            !c.properties.contains(.write) && !c.properties.contains(.writeWithoutResponse)
        }
        let tx = txOnly ?? writable[0]
        let rx = rxOnly ?? notifiable.first(where: { $0.uuid != tx.uuid }) ?? notifiable[0]
        return (tx, rx)
    }
}

// MARK: - Errors

enum BLEError: LocalizedError {
    case deviceNotFound
    case connectFailed(String)
    case serviceDiscoveryFailed(String)
    case noUsableService
    case notConnected

    var errorDescription: String? {
        switch self {
        case .deviceNotFound:
            return "Could not find that device. Try scanning again."
        case .connectFailed(let msg):
            return "Connect failed: \(msg)"
        case .serviceDiscoveryFailed(let msg):
            return "Service discovery failed: \(msg)"
        case .noUsableService:
            return "This adapter doesn't expose a writable + notifiable characteristic pair. Check the manual or try a different adapter."
        case .notConnected:
            return "Transport not connected."
        }
    }
}
