import { create } from 'zustand';
import { Anchor, Position } from '../utils/PositioningEngine';

export type AppRole = 'mobile' | 'anchor' | 'local' | 'none';
export const REFERENCE_ANCHOR_ID = 'BLUEPOINT-01';
type AnchorState = Anchor & { A: number, h: number, peripheralId?: string, currentRssi?: number, distance?: number };

const sanitizeDimension = (value: number, fallback: number): number => {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return value;
};
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

interface AppState {
    role: AppRole;
    setRole: (role: AppRole) => void;

    // Anchor specific state
    anchorConfig: Anchor & { A: number };
    setAnchorConfig: (config: Anchor & { A: number }) => void;

    // Mobile specific state
    roomSize: { width: number; height: number };
    setRoomSize: (width: number, height: number) => void;
    phoneHeightRelative: number;
    setPhoneHeightRelative: (height: number) => void;

    anchors: AnchorState[];
    updateAnchorRssi: (id: string, rssi: number) => void;
    setAnchors: (anchors: AnchorState[]) => void;
    setAnchorPeripheral: (id: string, peripheralId?: string) => void;

    currentPosition: Position | null;
    setCurrentPosition: (pos: Position | null) => void;
    isKalmanEnabled: boolean;
    setIsKalmanEnabled: (enabled: boolean) => void;

    isScanning: boolean;
    setIsScanning: (isScanning: boolean) => void;

    isAdvertising: boolean;
    setIsAdvertising: (isAdvertising: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
    role: 'none',
    setRole: (role) => set({ role }),

    anchorConfig: { id: REFERENCE_ANCHOR_ID, x: 0, y: 0, A: -60 },
    setAnchorConfig: (anchorConfig) => set({ anchorConfig }),

    roomSize: { width: 5, height: 5 },
    setRoomSize: (width, height) => set((state) => {
        const safeWidth = sanitizeDimension(width, state.roomSize.width);
        const safeHeight = sanitizeDimension(height, state.roomSize.height);

        const anchors = state.anchors.map((anchor) => {
            return {
                ...anchor,
                x: clamp(anchor.x, 0, safeWidth),
                y: clamp(anchor.y, 0, safeHeight),
            };
        });

        return {
            roomSize: { width: safeWidth, height: safeHeight },
            anchors,
        };
    }),
    phoneHeightRelative: 0,
    setPhoneHeightRelative: (height) => set({
        phoneHeightRelative: Number.isFinite(height) ? height : 0
    }),

    anchors: [
        { id: REFERENCE_ANCHOR_ID, x: 0, y: 0, A: -60, h: 0 },
        { id: 'BLUEPOINT-02', x: 5, y: 0, A: -60, h: 0 },
        { id: 'BLUEPOINT-03', x: 0, y: 5, A: -60, h: 0 },
        { id: 'BLUEPOINT-04', x: 5, y: 5, A: -60, h: 0 },
    ],
    setAnchors: (anchors) => set({
        anchors: anchors.map((anchor) =>
            anchor.id === REFERENCE_ANCHOR_ID ? { ...anchor, h: 0 } : anchor
        ),
    }),
    setAnchorPeripheral: (id, peripheralId) => set((state) => ({
        anchors: state.anchors.map((anchor) =>
            anchor.id === id ? { ...anchor, peripheralId } : anchor
        ),
    })),

    updateAnchorRssi: (id, rssi) => set((state) => ({
        anchors: state.anchors.map((a) => a.id === id ? { ...a, currentRssi: rssi } : a)
    })),

    currentPosition: null,
    setCurrentPosition: (currentPosition) => set({ currentPosition }),
    isKalmanEnabled: true,
    setIsKalmanEnabled: (isKalmanEnabled) => set({ isKalmanEnabled }),

    isScanning: false,
    setIsScanning: (isScanning) => set({ isScanning }),

    isAdvertising: false,
    setIsAdvertising: (isAdvertising) => set({ isAdvertising }),
}));
