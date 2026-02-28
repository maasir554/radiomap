import {
    NativeEventEmitter,
    NativeModules,
    PermissionsAndroid,
    Platform,
    type EmitterSubscription,
} from 'react-native';

type Point = { x: number; y: number };

type MotionUpdate = {
    position: Point;
    headingRad: number;
    steps: number;
    stepLengthMeters: number;
    timestamp: number;
};

type MotionListener = (update: MotionUpdate) => void;
type ErrorListener = (message: string) => void;

type SensorSubscription = { remove: () => void };

type LocalMotionNativeUpdate = {
    headingRad?: number;
    steps?: number;
    stepLengthMeters?: number;
    timestamp?: number;
    hasStep?: boolean;
};

type LocalMotionNativeModule = {
    isAvailable?: () => Promise<boolean> | boolean;
    startTracking: () => Promise<boolean> | boolean;
    stopTracking?: () => Promise<boolean> | boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type Vector3 = { x: number; y: number; z: number };

const normalizeAngle = (angle: number): number => {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
};

const magnitude = (v: Vector3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

const normalizeVector = (v: Vector3): Vector3 | null => {
    const norm = magnitude(v);
    if (!Number.isFinite(norm) || norm < 1e-6) return null;
    return { x: v.x / norm, y: v.y / norm, z: v.z / norm };
};

const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;

class LocalMotionService {
    private subscriptions: SensorSubscription[] = [];
    private nativeSubscription: EmitterSubscription | null = null;
    private running = false;
    private usingNativeAndroidModule = false;

    private position: Point = { x: 0, y: 0 };
    private headingRad = 0;
    private magnetHeadingRad = 0;
    private hasMagHeading = false;
    private lastGyroTimestampMs: number | null = null;
    private smoothedYawRate = 0;

    private gravity = { x: 0, y: 0, z: 1 };
    private filteredMagnet = { x: 0, y: 1, z: 0 };
    private dynamicAcc = 0;
    private prevDynamicAcc = 0;
    private prevSlope = 0;
    private lastStepTimeMs = 0;
    private steps = 0;
    private lastStepLength = 0.65;
    private lastHeadingOnlyEmitMs = 0;

    private listener: MotionListener | null = null;
    private errorListener: ErrorListener | null = null;

    async start(listener: MotionListener, onError?: ErrorListener): Promise<void> {
        this.stop();
        this.listener = listener;
        this.errorListener = onError ?? null;
        this.resetState();

        if (await this.tryStartNativeAndroidTracking()) {
            this.running = true;
            this.emitUpdate(Date.now());
            return;
        }

        try {
            const sensors = await import('expo-sensors');
            const { Accelerometer, Gyroscope, Magnetometer } = sensors;

            Accelerometer.setUpdateInterval(20);
            Gyroscope.setUpdateInterval(16);
            Magnetometer.setUpdateInterval(60);

            this.subscriptions.push(
                Accelerometer.addListener((sample) => this.onAccelerometer(sample)),
                Gyroscope.addListener((sample) => this.onGyroscope(sample)),
                Magnetometer.addListener((sample) => this.onMagnetometer(sample))
            );

            this.running = true;
            this.emitUpdate(Date.now());
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Unable to initialize sensors. Install expo-sensors and rebuild.';
            this.errorListener?.(message);
            this.stop();
        }
    }

    stop(): void {
        if (this.usingNativeAndroidModule) {
            const nativeModule = this.getNativeAndroidModule();
            if (nativeModule?.stopTracking) {
                void Promise.resolve(nativeModule.stopTracking()).catch(() => undefined);
            }
        }

        this.nativeSubscription?.remove();
        this.nativeSubscription = null;
        this.usingNativeAndroidModule = false;

        this.subscriptions.forEach((sub) => {
            try {
                sub.remove();
            } catch {
                // ignore individual unsubscribe failures
            }
        });
        this.subscriptions = [];
        this.running = false;
        this.lastGyroTimestampMs = null;
    }

    resetState(): void {
        this.position = { x: 0, y: 0 };
        this.headingRad = 0;
        this.magnetHeadingRad = 0;
        this.hasMagHeading = false;
        this.gravity = { x: 0, y: 0, z: 1 };
        this.filteredMagnet = { x: 0, y: 1, z: 0 };
        this.smoothedYawRate = 0;
        this.dynamicAcc = 0;
        this.prevDynamicAcc = 0;
        this.prevSlope = 0;
        this.lastStepTimeMs = 0;
        this.steps = 0;
        this.lastStepLength = 0.65;
        this.lastHeadingOnlyEmitMs = 0;
    }

    private getNativeAndroidModule(): LocalMotionNativeModule | null {
        if (Platform.OS !== 'android') return null;
        const moduleCandidate = NativeModules.LocalMotionModule as LocalMotionNativeModule | undefined;
        if (!moduleCandidate || typeof moduleCandidate.startTracking !== 'function') return null;
        return moduleCandidate;
    }

    private async ensureActivityRecognitionPermission(): Promise<void> {
        if (Platform.OS !== 'android') return;
        if ((Platform.Version as number) < 29) return;

        const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
        const alreadyGranted = await PermissionsAndroid.check(permission);
        if (alreadyGranted) return;
        await PermissionsAndroid.request(permission);
    }

    private async tryStartNativeAndroidTracking(): Promise<boolean> {
        const nativeModule = this.getNativeAndroidModule();
        if (!nativeModule) return false;

        try {
            await this.ensureActivityRecognitionPermission();

            if (nativeModule.isAvailable) {
                const available = await Promise.resolve(nativeModule.isAvailable());
                if (!available) return false;
            }

            const emitter = new NativeEventEmitter(NativeModules.LocalMotionModule);
            this.nativeSubscription?.remove();
            this.nativeSubscription = emitter.addListener('LocalMotionUpdate', (payload: LocalMotionNativeUpdate) => {
                this.handleNativeMotionUpdate(payload);
            });

            this.usingNativeAndroidModule = true;
            await Promise.resolve(nativeModule.startTracking());
            return true;
        } catch {
            this.nativeSubscription?.remove();
            this.nativeSubscription = null;
            this.usingNativeAndroidModule = false;
            return false;
        }
    }

    private handleNativeMotionUpdate(payload: LocalMotionNativeUpdate) {
        if (!this.running && !this.usingNativeAndroidModule) return;

        const heading = Number(payload.headingRad);
        if (Number.isFinite(heading)) {
            this.headingRad = normalizeAngle(heading);
        }

        const timestampMs = this.resolveTimestampMs(payload.timestamp);
        const reportedSteps = Number(payload.steps);
        if (Number.isFinite(reportedSteps) && reportedSteps >= 0) {
            this.steps = Math.max(this.steps, Math.round(reportedSteps));
        }

        const hasStep = Boolean(payload.hasStep);
        if (!hasStep) {
            if (timestampMs - this.lastHeadingOnlyEmitMs > 110) {
                this.lastHeadingOnlyEmitMs = timestampMs;
                this.emitUpdate(timestampMs);
            }
            return;
        }

        const nativeStepLength = Number(payload.stepLengthMeters);
        const stepLength = Number.isFinite(nativeStepLength) && nativeStepLength > 0
            ? nativeStepLength
            : this.lastStepLength;
        this.lastStepLength = stepLength;

        this.position = {
            x: this.position.x + stepLength * Math.cos(this.headingRad),
            y: this.position.y + stepLength * Math.sin(this.headingRad),
        };
        this.lastStepTimeMs = timestampMs;
        this.emitUpdate(timestampMs);
    }

    private onGyroscope(sample: { x: number; y: number; z: number; timestamp?: number }) {
        if (!this.running) return;

        const timestampMs = this.resolveTimestampMs(sample.timestamp);
        if (this.lastGyroTimestampMs === null) {
            this.lastGyroTimestampMs = timestampMs;
            return;
        }

        const dt = clamp((timestampMs - this.lastGyroTimestampMs) / 1000, 0.005, 0.08);
        this.lastGyroTimestampMs = timestampMs;

        const gx = Number.isFinite(sample.x) ? sample.x : 0;
        const gy = Number.isFinite(sample.y) ? sample.y : 0;
        const gz = Number.isFinite(sample.z) ? sample.z : 0;
        const gravityUnit = normalizeVector(this.gravity);
        const projectedYawRate = gravityUnit ? dot({ x: gx, y: gy, z: gz }, gravityUnit) : gz;

        this.smoothedYawRate = this.smoothedYawRate * 0.68 + projectedYawRate * 0.32;
        this.headingRad = normalizeAngle(this.headingRad + this.smoothedYawRate * dt);

        if (this.hasMagHeading) {
            // Weak correction to limit long-term gyro drift while preserving turn responsiveness.
            const error = normalizeAngle(this.magnetHeadingRad - this.headingRad);
            if (Math.abs(error) < Math.PI * 0.65) {
                const correctionGain = clamp(0.18 * dt, 0.0015, 0.014);
                this.headingRad = normalizeAngle(this.headingRad + error * correctionGain);
            }
        }
    }

    private onMagnetometer(sample: { x: number; y: number; z: number }) {
        if (!this.running) return;

        const mx = Number.isFinite(sample.x) ? sample.x : 0;
        const my = Number.isFinite(sample.y) ? sample.y : 0;
        const mz = Number.isFinite(sample.z) ? sample.z : 0;
        if (mx === 0 && my === 0 && mz === 0) return;

        const alpha = 0.84;
        this.filteredMagnet.x = alpha * this.filteredMagnet.x + (1 - alpha) * mx;
        this.filteredMagnet.y = alpha * this.filteredMagnet.y + (1 - alpha) * my;
        this.filteredMagnet.z = alpha * this.filteredMagnet.z + (1 - alpha) * mz;

        const gravityUnit = normalizeVector(this.gravity);
        if (!gravityUnit) return;

        // Remove vertical component so magnetic heading remains stable even when phone tilts.
        const projection = dot(this.filteredMagnet, gravityUnit);
        const horizontal = {
            x: this.filteredMagnet.x - projection * gravityUnit.x,
            y: this.filteredMagnet.y - projection * gravityUnit.y,
            z: this.filteredMagnet.z - projection * gravityUnit.z,
        };
        const horizontalUnit = normalizeVector(horizontal);
        if (!horizontalUnit) return;

        // Convert magnetic axis vector to approximate device-forward heading.
        const candidateHeading = normalizeAngle(Math.atan2(horizontalUnit.y, horizontalUnit.x) - Math.PI / 2);

        if (!this.hasMagHeading) {
            this.magnetHeadingRad = candidateHeading;
            this.headingRad = candidateHeading;
            this.hasMagHeading = true;
            return;
        }

        // Reject implausible jumps caused by indoor magnetic distortion.
        const delta = normalizeAngle(candidateHeading - this.magnetHeadingRad);
        if (Math.abs(delta) > Math.PI * 0.55) return;

        this.magnetHeadingRad = normalizeAngle(this.magnetHeadingRad + delta * 0.22);
    }

    private onAccelerometer(sample: { x: number; y: number; z: number; timestamp?: number }) {
        if (!this.running) return;

        const timestampMs = this.resolveTimestampMs(sample.timestamp);
        const ax = Number.isFinite(sample.x) ? sample.x : 0;
        const ay = Number.isFinite(sample.y) ? sample.y : 0;
        const az = Number.isFinite(sample.z) ? sample.z : 0;

        const alpha = 0.9;
        this.gravity.x = alpha * this.gravity.x + (1 - alpha) * ax;
        this.gravity.y = alpha * this.gravity.y + (1 - alpha) * ay;
        this.gravity.z = alpha * this.gravity.z + (1 - alpha) * az;

        const lx = ax - this.gravity.x;
        const ly = ay - this.gravity.y;
        const lz = az - this.gravity.z;
        const linearMagnitude = Math.sqrt(lx * lx + ly * ly + lz * lz);

        this.dynamicAcc = this.dynamicAcc * 0.72 + linearMagnitude * 0.28;
        const slope = this.dynamicAcc - this.prevDynamicAcc;

        const threshold = 0.115;
        const refractoryMs = 280;
        const isPeak = this.prevSlope > 0 && slope <= 0 && this.dynamicAcc > threshold;
        const enoughGap = (timestampMs - this.lastStepTimeMs) > refractoryMs;

        if (isPeak && enoughGap) {
            const intensity = clamp((this.dynamicAcc - threshold) / 0.35, 0, 1);
            const stepLength = 0.52 + intensity * 0.42;
            this.lastStepLength = stepLength;
            this.steps += 1;
            this.lastStepTimeMs = timestampMs;

            this.position = {
                x: this.position.x + stepLength * Math.cos(this.headingRad),
                y: this.position.y + stepLength * Math.sin(this.headingRad),
            };
            this.emitUpdate(timestampMs);
        }

        this.prevSlope = slope;
        this.prevDynamicAcc = this.dynamicAcc;
    }

    private emitUpdate(timestampMs: number) {
        this.listener?.({
            position: this.position,
            headingRad: this.headingRad,
            steps: this.steps,
            stepLengthMeters: this.lastStepLength,
            timestamp: timestampMs,
        });
    }

    private resolveTimestampMs(timestamp?: number): number {
        if (!Number.isFinite(timestamp)) return Date.now();
        const t = timestamp as number;
        // Expo sensors usually emit seconds (float), but handle ms as fallback.
        return t < 1e6 ? t * 1000 : t;
    }
}

export const localMotionService = new LocalMotionService();
export type { MotionUpdate };
