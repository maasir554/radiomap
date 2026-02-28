import BleManager from 'react-native-ble-manager';
import {
    NativeModules,
    NativeEventEmitter,
    Platform,
    PermissionsAndroid,
    type EmitterSubscription,
} from 'react-native';
import { useStore } from '../store/useStore';
import { compensateHeight, Kalman2D, rssiToDistance, OneEuroFilter, solveTrilateration } from '../utils/PositioningEngine';
import { anchorAdvertiser } from './AnchorAdvertiser';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
const ANCHOR_SERVICE_UUID = '00001802-0000-1000-8000-00805f9b34fb';

class BleService {
    private filters: Map<string, OneEuroFilter> = new Map();
    private positionKalman: Kalman2D = new Kalman2D();
    private wasKalmanEnabled = false;
    private discoverySubscription: EmitterSubscription | null = null;
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
        this.discoverySubscription = bleManagerEmitter.addListener('BleManagerDiscoverPeripheral', (data) => {
            const anchorId = this.parseAnchorIdFromDiscovery(data);
            if (anchorId && typeof data?.rssi === 'number') {
                this.handleDiscovery(anchorId, data.rssi);
            }
        });
    }

    private parseAnchorIdFromDiscovery(data: any): string | null {
        if (typeof data?.name === 'string' && data.name.startsWith('BLUEPOINT-')) {
            return data.name;
        }

        const serviceData = data?.advertising?.serviceData;
        if (!serviceData || typeof serviceData !== 'object') return null;

        const normalize = (value: string) => value.toLowerCase().replace(/-/g, '');
        const expected = normalize(ANCHOR_SERVICE_UUID);

        for (const [key, payload] of Object.entries(serviceData as Record<string, any>)) {
            if (normalize(key) !== expected) continue;
            const bytes = Array.isArray((payload as any)?.bytes) ? (payload as any).bytes : null;
            if (!bytes || bytes.length === 0) continue;
            const anchorId = String.fromCharCode(...bytes);
            if (anchorId.startsWith('BLUEPOINT-')) {
                return anchorId;
            }
        }

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

        // Initialize filter if not exists
        if (!this.filters.has(anchorId)) {
            // 5Hz (200ms) with default One-Euro parameters
            this.filters.set(anchorId, new OneEuroFilter(5, 1.0, 0.01, 1.0));
        }

        const filter = this.filters.get(anchorId)!;
        const smoothedRssi = filter.filter(rssi);

        store.updateAnchorRssi(anchorId, smoothedRssi);

        // Trigger positioning update
        this.calculatePosition();
    }

    private calculatePosition() {
        const { anchors, setCurrentPosition, phoneHeightRelative, isKalmanEnabled } = useStore.getState();

        const validAnchors = anchors.filter(a => a.currentRssi !== undefined);
        if (validAnchors.length >= 3) {
            const distances = validAnchors.map(a => ({
                id: a.id,
                distance: Math.max(
                    0.05,
                    compensateHeight(rssiToDistance(a.currentRssi!, a.A), phoneHeightRelative, a.h ?? 0)
                )
            }));

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
    }

    async startScanning() {
        await this.ensureReady();
        const store = useStore.getState();
        // react-native-ble-manager v12+ expects an options map, not positional args.
        await BleManager.scan({
            serviceUUIDs: [],
            seconds: 0,
            allowDuplicates: true,
        });
        store.setIsScanning(true);
    }

    async stopScanning() {
        const store = useStore.getState();
        try {
            await BleManager.stopScan();
        } finally {
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
        this.filters.clear();
        this.positionKalman = new Kalman2D();
        this.wasKalmanEnabled = false;
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
