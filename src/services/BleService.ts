import BleManager, {
    BleScanCallbackType,
    BleScanMatchCount,
    BleScanMatchMode,
    BleScanMode,
} from 'react-native-ble-manager';
import {
    NativeModules,
    NativeEventEmitter,
    Platform,
    PermissionsAndroid,
    type EmitterSubscription,
} from 'react-native';
import { useStore } from '../store/useStore';
import { compensateHeight, Kalman2D, rssiToDistance, OneEuroFilter, solveTrilateration, type Position } from '../utils/PositioningEngine';
import { anchorAdvertiser } from './AnchorAdvertiser';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
const ANCHOR_SERVICE_UUID = '00001802-0000-1000-8000-00805f9b34fb';
type DiscoverySource = 'callback' | 'poll';

export interface BleDebugPeripheral {
    key: string;
    peripheralId: string | null;
    name: string | null;
    localName: string | null;
    parsedAnchorId: string | null;
    rssi: number | null;
    source: DiscoverySource;
    hasRawData: boolean;
    hasServiceData: boolean;
    hasManufacturerData: boolean;
    lastSeenAt: number;
}

export interface BleDebugSnapshot {
    isScanning: boolean;
    scanMode: 'primary' | 'compatibility';
    fallbackScanApplied: boolean;
    parsedAnchorsSinceScanStart: number;
    callbackEvents: number;
    pollEvents: number;
    visiblePeripheralCount: number;
    startedAt: number | null;
    lastScanError: string | null;
    peripherals: BleDebugPeripheral[];
}

class BleService {
    private filters: Map<string, OneEuroFilter> = new Map();
    private positionKalman: Kalman2D = new Kalman2D();
    private wasKalmanEnabled = false;
    private latestRssiByAnchor: Map<string, number> = new Map();
    private discoverySubscription: EmitterSubscription | null = null;
    private discoveredPoller: ReturnType<typeof setInterval> | null = null;
    private scanFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    private parsedAnchorsSinceScanStart = 0;
    private fallbackScanApplied = false;
    private scanMode: 'primary' | 'compatibility' = 'primary';
    private callbackEvents = 0;
    private pollEvents = 0;
    private scanStartedAt: number | null = null;
    private lastScanError: string | null = null;
    private debugPeripherals: Map<string, BleDebugPeripheral> = new Map();
    private initialized = false;
    private hasPermissions = Platform.OS !== 'android';

    async initialize() {
        if (this.initialized) return;
        await BleManager.start({ showAlert: false });
        this.setupListeners();
        this.hasPermissions = await this.requestPermissions();
        this.initialized = true;
    }

    private async requestPermissions(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }

        if (Platform.Version < 23) {
            return true;
        }

        const permissions =
            Platform.Version >= 31
                ? [
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                ]
                : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

        const result = await PermissionsAndroid.requestMultiple(permissions);
        return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
    }

    private setupListeners() {
        this.discoverySubscription?.remove();
        const onDiscover = (data: any) => this.processPeripheralDiscovery(data, 'callback');

        if (typeof (BleManager as any).onDiscoverPeripheral === 'function') {
            this.discoverySubscription = (BleManager as any).onDiscoverPeripheral(onDiscover);
            return;
        }

        // Fallback for legacy event emitter path.
        this.discoverySubscription = bleManagerEmitter.addListener('BleManagerDiscoverPeripheral', onDiscover);
    }

    private processPeripheralDiscovery(data: any, source: DiscoverySource) {
        if (source === 'callback') {
            this.callbackEvents += 1;
        } else {
            this.pollEvents += 1;
        }

        const anchorId = this.parseAnchorIdFromDiscovery(data);
        const rawRssi = typeof data?.rssi === 'number' ? data.rssi : Number(data?.rssi);
        this.recordDebugPeripheral(data, source, anchorId, Number.isFinite(rawRssi) ? rawRssi : null);

        if (!anchorId) return;
        this.parsedAnchorsSinceScanStart += 1;

        if (!Number.isFinite(rawRssi)) return;

        // Android can report 127 when RSSI is unavailable.
        if (rawRssi === 127) return;

        this.handleDiscovery(anchorId, rawRssi);
    }

    private startDiscoveredPeripheralsPolling() {
        this.stopDiscoveredPeripheralsPolling();

        this.discoveredPoller = setInterval(() => {
            void BleManager.getDiscoveredPeripherals()
                .then((peripherals) => {
                    peripherals.forEach((peripheral) => this.processPeripheralDiscovery(peripheral, 'poll'));
                })
                .catch(() => undefined);
        }, 900);
    }

    private stopDiscoveredPeripheralsPolling() {
        if (this.discoveredPoller) {
            clearInterval(this.discoveredPoller);
            this.discoveredPoller = null;
        }
    }

    private stopScanFallbackTimer() {
        if (this.scanFallbackTimer) {
            clearTimeout(this.scanFallbackTimer);
            this.scanFallbackTimer = null;
        }
    }

    private async startScanWithMode(useCompatibilityMode: boolean): Promise<void> {
        this.scanMode = useCompatibilityMode ? 'compatibility' : 'primary';

        if (useCompatibilityMode) {
            await BleManager.scan({
                serviceUUIDs: [],
                seconds: 0,
                allowDuplicates: true,
                // Fallback mode for devices that misbehave with advanced scan settings.
                legacy: true,
            });
            return;
        }

        await BleManager.scan({
            serviceUUIDs: [],
            seconds: 0,
            allowDuplicates: true,
            scanMode: BleScanMode.LowLatency,
            matchMode: BleScanMatchMode.Aggressive,
            numberOfMatches: BleScanMatchCount.MaxAdvertisements,
            callbackType: BleScanCallbackType.AllMatches,
        });
    }

    private scheduleScanFallbackIfNeeded() {
        this.stopScanFallbackTimer();

        this.scanFallbackTimer = setTimeout(() => {
            if (this.fallbackScanApplied) return;
            if (!useStore.getState().isScanning) return;
            if (this.parsedAnchorsSinceScanStart > 0) return;

            this.fallbackScanApplied = true;
            void (async () => {
                try {
                    await BleManager.stopScan();
                } catch {
                    // Ignore stop errors during fallback restart.
                }

                try {
                    await this.startScanWithMode(true);
                } catch {
                    this.lastScanError = 'Fallback scan restart failed.';
                    // Keep primary scan state as-is; UI will still allow manual retry.
                }
            })();
        }, 4500);
    }

    private recordDebugPeripheral(
        data: any,
        source: DiscoverySource,
        parsedAnchorId: string | null,
        rssi: number | null
    ) {
        const now = Date.now();
        const peripheralId = typeof data?.id === 'string' ? data.id : null;
        const name = typeof data?.name === 'string' ? data.name : null;
        const localName =
            (typeof data?.localName === 'string' && data.localName) ||
            (typeof data?.advertising?.localName === 'string' && data.advertising.localName) ||
            (typeof data?.advertising?.kCBAdvDataLocalName === 'string' && data.advertising.kCBAdvDataLocalName) ||
            null;

        const serviceData = data?.advertising?.serviceData;
        const manufacturerData = data?.advertising?.manufacturerData;
        const hasServiceData = Array.isArray(serviceData) || (!!serviceData && typeof serviceData === 'object');
        const hasManufacturerData =
            Array.isArray(manufacturerData) ||
            (!!manufacturerData && typeof manufacturerData === 'object') ||
            !!data?.advertising?.manufacturerRawData;
        const hasRawData = Array.isArray(data?.advertising?.rawData?.bytes) || typeof data?.advertising?.rawData?.data === 'string';

        const key = peripheralId ?? `${name ?? localName ?? 'unknown'}::${parsedAnchorId ?? 'na'}`;

        this.debugPeripherals.set(key, {
            key,
            peripheralId,
            name,
            localName,
            parsedAnchorId,
            rssi,
            source,
            hasRawData,
            hasServiceData,
            hasManufacturerData,
            lastSeenAt: now,
        });

        if (this.debugPeripherals.size > 32) {
            const sortedByOldest = Array.from(this.debugPeripherals.values()).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
            const oldest = sortedByOldest[0];
            if (oldest) {
                this.debugPeripherals.delete(oldest.key);
            }
        }
    }

    getDebugSnapshot(): BleDebugSnapshot {
        const isScanning = useStore.getState().isScanning;
        const peripherals = Array.from(this.debugPeripherals.values())
            .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
            .slice(0, 14);

        return {
            isScanning,
            scanMode: this.scanMode,
            fallbackScanApplied: this.fallbackScanApplied,
            parsedAnchorsSinceScanStart: this.parsedAnchorsSinceScanStart,
            callbackEvents: this.callbackEvents,
            pollEvents: this.pollEvents,
            visiblePeripheralCount: this.debugPeripherals.size,
            startedAt: this.scanStartedAt,
            lastScanError: this.lastScanError,
            peripherals,
        };
    }

    private parseAnchorIdFromDiscovery(data: any): string | null {
        const peripheralId = typeof data?.id === 'string' ? data.id.toUpperCase() : null;
        if (peripheralId) {
            const bound = useStore.getState().anchors.find((anchor) =>
                typeof anchor.peripheralId === 'string' &&
                anchor.peripheralId.toUpperCase() === peripheralId
            );
            if (bound) {
                return bound.id;
            }
        }

        const extractAnchorId = (value: string | null | undefined): string | null => {
            if (typeof value !== 'string') return null;
            const match = value.toUpperCase().match(/BLUEPOINT-(\d{1,2})/);
            if (!match) return null;
            return `BLUEPOINT-${match[1].padStart(2, '0')}`;
        };

        const byteArrayToAnchorId = (bytes: number[] | Uint8Array | null | undefined): string | null => {
            if (!bytes || bytes.length === 0) return null;
            const ascii = Array.from(bytes)
                .filter((b) => Number.isFinite(b) && b >= 32 && b <= 126)
                .map((b) => String.fromCharCode(b))
                .join('');
            return extractAnchorId(ascii);
        };

        const base64ToBytes = (raw: string): number[] | null => {
            const cleaned = raw.replace(/[\r\n\s]/g, '');
            if (!cleaned) return null;

            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            const values: number[] = [];
            for (const ch of cleaned) {
                if (ch === '=') {
                    values.push(-2);
                    continue;
                }
                const idx = alphabet.indexOf(ch);
                if (idx === -1) return null;
                values.push(idx);
            }

            const out: number[] = [];
            for (let i = 0; i < values.length; i += 4) {
                const a = values[i];
                const b = values[i + 1];
                const c = values[i + 2] ?? -2;
                const d = values[i + 3] ?? -2;
                if (a == null || b == null || a < 0 || b < 0) return null;

                out.push((a << 2) | (b >> 4));
                if (c >= 0) {
                    out.push(((b & 0x0f) << 4) | (c >> 2));
                    if (d >= 0) {
                        out.push(((c & 0x03) << 6) | d);
                    }
                }
            }

            return out;
        };

        const hexToBytes = (raw: string): number[] | null => {
            const cleaned = raw.replace(/^0x/i, '').replace(/[^a-fA-F0-9]/g, '');
            if (cleaned.length < 2 || cleaned.length % 2 !== 0) return null;
            const result: number[] = [];
            for (let i = 0; i < cleaned.length; i += 2) {
                const byte = Number.parseInt(cleaned.slice(i, i + 2), 16);
                if (Number.isNaN(byte)) return null;
                result.push(byte);
            }
            return result;
        };

        const payloadToAnchorId = (payload: any): string | null => {
            if (!payload) return null;

            if (Array.isArray(payload)) {
                return byteArrayToAnchorId(payload as number[]);
            }
            if (Array.isArray(payload?.bytes)) {
                return byteArrayToAnchorId(payload.bytes as number[]);
            }
            if (Array.isArray(payload?.data)) {
                return byteArrayToAnchorId(payload.data as number[]);
            }
            if (typeof payload === 'string') {
                return (
                    extractAnchorId(payload) ??
                    byteArrayToAnchorId(base64ToBytes(payload)) ??
                    byteArrayToAnchorId(hexToBytes(payload))
                );
            }
            if (typeof payload?.data === 'string') {
                return (
                    extractAnchorId(payload.data) ??
                    byteArrayToAnchorId(base64ToBytes(payload.data)) ??
                    byteArrayToAnchorId(hexToBytes(payload.data))
                );
            }
            if (payload instanceof Uint8Array) {
                return byteArrayToAnchorId(payload);
            }

            return null;
        };

        const payloadRecordToAnchorId = (record: any): string | null => {
            if (!record || typeof record !== 'object') return null;
            for (const [, value] of Object.entries(record as Record<string, any>)) {
                const anchorId = payloadToAnchorId(value);
                if (anchorId) return anchorId;
            }
            return null;
        };

        const fromName =
            extractAnchorId(data?.name) ??
            extractAnchorId(data?.localName) ??
            extractAnchorId(data?.advertising?.localName) ??
            extractAnchorId(data?.advertising?.kCBAdvDataLocalName);
        if (fromName) {
            return fromName;
        }

        const fromManufacturer =
            payloadRecordToAnchorId(data?.advertising?.manufacturerData) ??
            payloadToAnchorId(data?.advertising?.manufacturerRawData);
        if (fromManufacturer) {
            return fromManufacturer;
        }

        const serviceData = data?.advertising?.serviceData;
        const normalize = (value: string) => value.toLowerCase().replace(/-/g, '');
        const expected = normalize(ANCHOR_SERVICE_UUID);
        const expectedShort = expected.slice(4, 8); // "1802"

        const entries =
            serviceData && typeof serviceData === 'object'
                ? Object.entries(serviceData as Record<string, any>)
                : [];

        // First pass: keys matching expected UUID (full or short)
        for (const [key, payload] of entries) {
            const normalizedKey = normalize(String(key));
            const keyMatches =
                normalizedKey === expected ||
                normalizedKey === expectedShort ||
                normalizedKey.endsWith(expectedShort);
            if (!keyMatches) continue;
            const anchorId = payloadToAnchorId(payload);
            if (anchorId) return anchorId;
        }

        // Second pass: permissive fallback for cross-platform advertiser variants.
        for (const [, payload] of entries) {
            const anchorId = payloadToAnchorId(payload);
            if (anchorId) return anchorId;
        }

        const parseAnchorIdFromRawData = (rawBytes: number[] | undefined): string | null => {
            if (!rawBytes || rawBytes.length < 2) return null;

            let cursor = 0;
            while (cursor < rawBytes.length) {
                const length = rawBytes[cursor];
                if (!Number.isFinite(length) || length <= 0) break;

                const fieldStart = cursor + 1;
                const fieldEnd = fieldStart + length;
                if (fieldEnd > rawBytes.length) break;

                const type = rawBytes[fieldStart];
                const fieldData = rawBytes.slice(fieldStart + 1, fieldEnd);

                // Complete / Shortened Local Name
                if (type === 0x09 || type === 0x08) {
                    const fromNameField = byteArrayToAnchorId(fieldData);
                    if (fromNameField) return fromNameField;
                }

                // Service Data - 16-bit UUID (first 2 bytes are UUID little-endian)
                if (type === 0x16 && fieldData.length > 2) {
                    const servicePayload = fieldData.slice(2);
                    const fromService16 = byteArrayToAnchorId(servicePayload);
                    if (fromService16) return fromService16;
                }

                // Service Data - 128-bit UUID (first 16 bytes are UUID little-endian)
                if (type === 0x21 && fieldData.length > 16) {
                    const servicePayload = fieldData.slice(16);
                    const fromService128 = byteArrayToAnchorId(servicePayload);
                    if (fromService128) return fromService128;
                }

                // Manufacturer specific data
                if (type === 0xff && fieldData.length > 2) {
                    const fromManufacturer = byteArrayToAnchorId(fieldData.slice(2));
                    if (fromManufacturer) return fromManufacturer;
                }

                cursor = fieldEnd;
            }

            return null;
        };

        const rawDataBytes = Array.isArray(data?.advertising?.rawData?.bytes)
            ? (data.advertising.rawData.bytes as number[])
            : undefined;
        const fromRawData = parseAnchorIdFromRawData(rawDataBytes);
        if (fromRawData) return fromRawData;

        return null;
    }

    private async ensureReady(): Promise<void> {
        await this.initialize();
        if (!this.hasPermissions) {
            this.hasPermissions = await this.requestPermissions();
        }
        if (!this.hasPermissions) {
            throw new Error('Bluetooth permissions were denied.');
        }
    }

    private handleDiscovery(anchorId: string, rssi: number) {
        const store = useStore.getState();

        this.latestRssiByAnchor.set(anchorId, rssi);

        // Initialize filter if not exists
        if (!this.filters.has(anchorId)) {
            // 5Hz (200ms) with default One-Euro parameters
            this.filters.set(anchorId, new OneEuroFilter(5, 1.0, 0.01, 1.0));
        }

        const filter = this.filters.get(anchorId)!;
        const smoothedRssi = filter.filter(rssi);

        store.updateAnchorRssi(anchorId, smoothedRssi);
    }

    private calculatePositionFromDistances(distances: { id: string; distance: number }[]) {
        const { anchors, setCurrentPosition, phoneHeightRelative, isKalmanEnabled } = useStore.getState();

        if (distances.length < 3) {
            setCurrentPosition(null);
            return;
        }

        const rawPos = solveTrilateration(anchors, distances);
        if (!rawPos) {
            setCurrentPosition(null);
            return;
        }

        const timestamp = Date.now();
        if (isKalmanEnabled) {
            if (!this.wasKalmanEnabled) {
                this.positionKalman.reset(rawPos.x, rawPos.y, timestamp);
                this.wasKalmanEnabled = true;
                setCurrentPosition(rawPos);
                return;
            }

            const measurementNoise = Math.max(0.08, rawPos.residualError * rawPos.residualError * 0.35);
            const filtered = this.positionKalman.update(rawPos.x, rawPos.y, timestamp, measurementNoise);
            setCurrentPosition({
                ...rawPos,
                x: filtered.x,
                y: filtered.y,
            });
            return;
        }

        if (this.wasKalmanEnabled) {
            this.positionKalman.reset(rawPos.x, rawPos.y, timestamp);
            this.wasKalmanEnabled = false;
        }

        setCurrentPosition(rawPos);
    }

    private async collectRssiSamples(durationMs: number, intervalMs: number) {
        const samples = new Map<string, { sum: number; count: number }>();
        const startAt = Date.now();

        await new Promise<void>((resolve) => {
            const timer = setInterval(() => {
                const now = Date.now();
                this.latestRssiByAnchor.forEach((value, id) => {
                    if (!Number.isFinite(value)) return;
                    const entry = samples.get(id) ?? { sum: 0, count: 0 };
                    entry.sum += value;
                    entry.count += 1;
                    samples.set(id, entry);
                });

                if (now - startAt >= durationMs) {
                    clearInterval(timer);
                    resolve();
                }
            }, intervalMs);
        });

        return samples;
    }

    async capturePositionSample(durationMs: number = 2000, intervalMs: number = 200): Promise<Position | null> {
        await this.ensureReady();

        const store = useStore.getState();
        const wasScanning = store.isScanning;
        if (!wasScanning) {
            await this.startScanWithMode(false).catch(() => undefined);
            store.setIsScanning(true);
            this.startDiscoveredPeripheralsPolling();
            this.scheduleScanFallbackIfNeeded();
        }

        const samples = await this.collectRssiSamples(durationMs, intervalMs);
        const { anchors, phoneHeightRelative } = useStore.getState();

        const distances = anchors
            .map((anchor) => {
                const entry = samples.get(anchor.id);
                if (!entry || entry.count === 0) return null;
                const avgRssi = entry.sum / entry.count;
                return {
                    id: anchor.id,
                    distance: Math.max(
                        0.05,
                        compensateHeight(rssiToDistance(avgRssi, anchor.A), phoneHeightRelative, anchor.h ?? 0)
                    ),
                };
            })
            .filter((item): item is { id: string; distance: number } => item !== null);

        this.calculatePositionFromDistances(distances);

        if (!wasScanning) {
            await this.stopScanning();
        }

        return useStore.getState().currentPosition;
    }

    async startScanning() {
        await this.ensureReady();
        const store = useStore.getState();
        this.parsedAnchorsSinceScanStart = 0;
        this.fallbackScanApplied = false;
        this.scanMode = 'primary';
        this.callbackEvents = 0;
        this.pollEvents = 0;
        this.lastScanError = null;
        this.scanStartedAt = Date.now();
        this.debugPeripherals.clear();
        store.setIsScanning(true);
        try {
            await this.startScanWithMode(false);
            this.startDiscoveredPeripheralsPolling();
            this.scheduleScanFallbackIfNeeded();
        } catch (error) {
            store.setIsScanning(false);
            this.stopDiscoveredPeripheralsPolling();
            this.stopScanFallbackTimer();
            this.lastScanError = error instanceof Error ? error.message : 'Scan start failed.';
            throw error;
        }
    }

    async stopScanning() {
        const store = useStore.getState();
        try {
            await BleManager.stopScan();
        } finally {
            this.stopDiscoveredPeripheralsPolling();
            this.stopScanFallbackTimer();
            store.setIsScanning(false);
        }
    }

    async startAdvertising(anchorId: string) {
        await this.ensureReady();

        if (Platform.OS !== 'android') {
            throw new Error('Anchor advertising is currently supported on Android only.');
        }
        if (!anchorId.startsWith('BLUEPOINT-')) {
            throw new Error('Anchor ID must start with BLUEPOINT-.');
        }

        if (Platform.Version >= 31) {
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE
            );
            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                throw new Error('Bluetooth advertise permission was denied.');
            }
        }

        await anchorAdvertiser.startAdvertising(anchorId);
        useStore.getState().setIsAdvertising(true);
    }

    async stopAdvertising() {
        const store = useStore.getState();
        try {
            await anchorAdvertiser.stopAdvertising();
        } finally {
            store.setIsAdvertising(false);
        }
    }

    cleanup() {
        this.discoverySubscription?.remove();
        this.discoverySubscription = null;
        this.stopDiscoveredPeripheralsPolling();
        this.stopScanFallbackTimer();
        this.filters.clear();
        this.positionKalman = new Kalman2D();
        this.wasKalmanEnabled = false;
        this.latestRssiByAnchor.clear();
        this.scanMode = 'primary';
        this.callbackEvents = 0;
        this.pollEvents = 0;
        this.scanStartedAt = null;
        this.lastScanError = null;
        this.debugPeripherals.clear();
        this.initialized = false;
        this.hasPermissions = Platform.OS !== 'android';

        void BleManager.stopScan().catch(() => undefined);
        void anchorAdvertiser.stopAdvertising().catch(() => undefined);

        const store = useStore.getState();
        store.setIsScanning(false);
        store.setIsAdvertising(false);
    }
}

export const bleService = new BleService();
