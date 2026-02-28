declare module 'expo-sensors' {
    export interface SensorSubscription {
        remove: () => void;
    }

    export interface AccelerometerMeasurement {
        x: number;
        y: number;
        z: number;
        timestamp?: number;
    }

    export interface GyroscopeMeasurement {
        x: number;
        y: number;
        z: number;
        timestamp?: number;
    }

    export interface MagnetometerMeasurement {
        x: number;
        y: number;
        z: number;
        timestamp?: number;
    }

    export class Accelerometer {
        static setUpdateInterval(intervalMs: number): void;
        static addListener(listener: (measurement: AccelerometerMeasurement) => void): SensorSubscription;
    }

    export class Gyroscope {
        static setUpdateInterval(intervalMs: number): void;
        static addListener(listener: (measurement: GyroscopeMeasurement) => void): SensorSubscription;
    }

    export class Magnetometer {
        static setUpdateInterval(intervalMs: number): void;
        static addListener(listener: (measurement: MagnetometerMeasurement) => void): SensorSubscription;
    }
}
