import * as math from 'mathjs';

export interface Anchor {
    id: string;
    x: number;
    y: number;
}

export interface DistanceResult {
    id: string;
    distance: number;
}

export interface Position {
    x: number;
    y: number;
    residualError: number;
}

/**
 * Layer A: Signal Processing (Log-Distance Path Loss)
 * d = 10^((A - RSSI) / (10 * n))
 */
export const rssiToDistance = (rssi: number, A: number, n: number = 2.2): number => {
    return Math.pow(10, (A - rssi) / (10 * n));
};

/**
 * Layer B: Temporal Filtering (One-Euro Filter)
 */
class LowPassFilter {
    private alpha: number = 0;
    private s: number | null = null;
    public y: number | null = null;

    constructor(alpha: number) {
        this.setAlpha(alpha);
    }

    setAlpha(alpha: number): void {
        if (alpha <= 0 || alpha > 1.0) throw new Error("Alpha must be in (0, 1.0]");
        this.alpha = alpha;
    }

    filter(value: number): number {
        let result: number;
        if (this.s === null) {
            result = value;
        } else {
            result = this.alpha * value + (1.0 - this.alpha) * this.s;
        }
        this.s = result;
        this.y = value;
        return result;
    }
}

export class OneEuroFilter {
    private freq: number;
    private mincutoff: number;
    private beta: number;
    private dcutoff: number;
    private x: LowPassFilter;
    private dx: LowPassFilter;
    private lastTime: number | null = null;

    constructor(freq: number, mincutoff: number = 1.0, beta: number = 0.0, dcutoff: number = 1.0) {
        this.freq = freq;
        this.mincutoff = mincutoff;
        this.beta = beta;
        this.dcutoff = dcutoff;
        this.x = new LowPassFilter(this.calculateAlpha(mincutoff));
        this.dx = new LowPassFilter(this.calculateAlpha(dcutoff));
    }

    private calculateAlpha(cutoff: number): number {
        const te = 1.0 / this.freq;
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / te);
    }

    filter(value: number, timestamp: number | null = null): number {
        const now = timestamp || Date.now() / 1000;
        if (this.lastTime !== null && timestamp !== null) {
            this.freq = 1.0 / (now - this.lastTime);
        }
        this.lastTime = now;

        const dvalue = this.x.y === null ? 0 : (value - this.x.y) * this.freq;
        const edvalue = this.dx.filter(dvalue);
        const cutoff = this.mincutoff + this.beta * Math.abs(edvalue);

        this.x.setAlpha(this.calculateAlpha(cutoff));
        return this.x.filter(value);
    }
}

/**
 * 2D Constant-Velocity Kalman filter for position smoothing.
 * State per axis: [position, velocity]
 */
export class Kalman2D {
    private x = [0, 0];
    private y = [0, 0];
    private px = [
        [1, 0],
        [0, 1],
    ];
    private py = [
        [1, 0],
        [0, 1],
    ];
    private lastTimestampMs: number | null = null;
    private readonly processNoise: number;
    private readonly measurementNoiseFloor: number;
    private initialized = false;

    constructor(processNoise: number = 0.4, measurementNoiseFloor: number = 0.12) {
        this.processNoise = processNoise;
        this.measurementNoiseFloor = measurementNoiseFloor;
    }

    reset(x: number, y: number, timestampMs: number = Date.now()) {
        this.x = [x, 0];
        this.y = [y, 0];
        this.px = [
            [1, 0],
            [0, 1],
        ];
        this.py = [
            [1, 0],
            [0, 1],
        ];
        this.lastTimestampMs = timestampMs;
        this.initialized = true;
    }

    update(
        measuredX: number,
        measuredY: number,
        timestampMs: number = Date.now(),
        measurementNoise?: number
    ): { x: number; y: number } {
        if (!this.initialized || this.lastTimestampMs === null) {
            this.reset(measuredX, measuredY, timestampMs);
            return { x: measuredX, y: measuredY };
        }

        const dtMs = Math.max(16, Math.min(250, timestampMs - this.lastTimestampMs));
        const dt = dtMs / 1000;
        this.lastTimestampMs = timestampMs;

        const r = Math.max(
            this.measurementNoiseFloor,
            Number.isFinite(measurementNoise) ? (measurementNoise as number) : this.measurementNoiseFloor
        );

        this.stepAxis(this.x, this.px, measuredX, dt, r);
        this.stepAxis(this.y, this.py, measuredY, dt, r);

        return { x: this.x[0], y: this.y[0] };
    }

    private stepAxis(state: number[], p: number[][], z: number, dt: number, r: number) {
        // Predict with A = [[1, dt], [0, 1]]
        const predPos = state[0] + dt * state[1];
        const predVel = state[1];

        const p00 = p[0][0] + dt * (p[1][0] + p[0][1]) + dt * dt * p[1][1];
        const p01 = p[0][1] + dt * p[1][1];
        const p10 = p[1][0] + dt * p[1][1];
        const p11 = p[1][1];

        // Process noise from white acceleration model
        const q = this.processNoise;
        const q00 = (dt ** 4) / 4 * q;
        const q01 = (dt ** 3) / 2 * q;
        const q11 = (dt ** 2) * q;

        const pp00 = p00 + q00;
        const pp01 = p01 + q01;
        const pp10 = p10 + q01;
        const pp11 = p11 + q11;

        // Update with H = [1, 0]
        const innovation = z - predPos;
        const s = pp00 + r;
        const k0 = pp00 / s;
        const k1 = pp10 / s;

        state[0] = predPos + k0 * innovation;
        state[1] = predVel + k1 * innovation;

        p[0][0] = (1 - k0) * pp00;
        p[0][1] = (1 - k0) * pp01;
        p[1][0] = pp10 - k1 * pp00;
        p[1][1] = pp11 - k1 * pp01;
    }
}

/**
 * Layer C: Weighted Linear Least Squares (WLLS)
 */
export const solveTrilateration = (anchors: Anchor[], distances: DistanceResult[]): Position | null => {
    if (anchors.length < 3) return null;

    const data = anchors.map(a => {
        const d = distances.find(dist => dist.id === a.id);
        return { ...a, r: d ? d.distance : null };
    }).filter((a): a is Anchor & { r: number } => a.r !== null);

    if (data.length < 3) return null;

    const n = data.length;
    const pivot = data[0];
    if (!pivot) return null;
    const others = data.slice(1);

    const A_rows: number[][] = [];
    const B_rows: number[][] = [];
    const weights: number[] = [];

    others.forEach(anchor => {
        A_rows.push([
            2 * (anchor.x - pivot.x),
            2 * (anchor.y - pivot.y)
        ]);

        const bVal = Math.pow(pivot.r, 2) - Math.pow(anchor.r, 2) -
            Math.pow(pivot.x, 2) + Math.pow(anchor.x, 2) -
            Math.pow(pivot.y, 2) + Math.pow(anchor.y, 2);
        B_rows.push([bVal]);

        weights.push(1 / anchor.r);
    });

    const A_mat = math.matrix(A_rows);
    const B_mat = math.matrix(B_rows);
    const W_mat = math.diag(weights);

    const AT = math.transpose(A_mat);
    const ATW = math.multiply(AT, W_mat);
    const ATWA = math.multiply(ATW, A_mat);

    try {
        const invATWA = math.inv(ATWA);
        const ATWB = math.multiply(ATW, B_mat);
        const result = math.multiply(invATWA, ATWB) as math.Matrix;

        const x = result.get([0, 0]);
        const y = result.get([1, 0]);

        let totalError = 0;
        data.forEach(a => {
            const dist = Math.sqrt(Math.pow(x - a.x, 2) + Math.pow(y - a.y, 2));
            totalError += Math.abs(dist - a.r);
        });
        const residualError = totalError / n;

        return { x, y, residualError };
    } catch (err) {
        console.error("Matrix inversion failed", err);
        return null;
    }
};

/**
 * Height Compensation
 */
export const compensateHeight = (dMeasured: number, hPhone: number, hAnchor: number): number => {
    const hDiff = Math.abs(hPhone - hAnchor);
    if (dMeasured < hDiff) return 0;
    return Math.sqrt(Math.pow(dMeasured, 2) - Math.pow(hDiff, 2));
};
