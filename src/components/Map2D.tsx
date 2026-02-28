import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
    GestureResponderEvent,
    LayoutChangeEvent,
    PanResponder,
    PanResponderGestureState,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import Svg, { Circle, Defs, G, Line, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { Crosshair, Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react-native';
import { useStore } from '../store/useStore';
import { ui } from '../theme/ui';
import type { Position } from '../utils/PositioningEngine';

interface Map2DProps {
    fullscreen?: boolean;
    onRequestFullscreen?: () => void;
}

type Point = { x: number; y: number };
type AnchorLayout = { id: string; x: number; y: number };

type GestureTracker = {
    mode: 'none' | 'pan' | 'pinch';
    startZoom: number;
    startDistance: number;
    startOffset: Point;
    startMid: Point;
    lastMid: Point;
    baseDx: number;
    baseDy: number;
};

const buildLinePositions = (lengthMeters: number, stepMeters: number): number[] => {
    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) return [0, 1];
    const positions: number[] = [0];
    const stepCount = Math.floor(lengthMeters / stepMeters);

    for (let i = 1; i <= stepCount; i += 1) {
        const value = Number((i * stepMeters).toFixed(6));
        if (value < lengthMeters) positions.push(value);
    }

    if (positions[positions.length - 1] !== lengthMeters) {
        positions.push(Number(lengthMeters.toFixed(6)));
    }

    return positions;
};

const isMajorMeterMark = (meters: number): boolean => Math.abs(meters - Math.round(meters)) < 0.0001;

const getAnchorNumberLabel = (anchorId: string): string => {
    const match = anchorId.match(/(\d+)\s*$/);
    if (!match || !match[1]) return '?';
    return String(Number(match[1]));
};

interface StaticLayerProps {
    svgWidth: number;
    svgHeight: number;
    originX: number;
    originY: number;
    mapWidth: number;
    mapHeight: number;
    scale: number;
    xLineMeters: number[];
    yLineMeters: number[];
    markerSize: number;
    minorCellPx: number;
    showMarkerPattern: boolean;
    anchors: AnchorLayout[];
}

const MapStaticLayer: React.FC<StaticLayerProps> = memo(({
    svgWidth,
    svgHeight,
    originX,
    originY,
    mapWidth,
    mapHeight,
    scale,
    xLineMeters,
    yLineMeters,
    markerSize,
    minorCellPx,
    showMarkerPattern,
    anchors,
}) => {
    return (
        <Svg width={svgWidth} height={svgHeight} style={StyleSheet.absoluteFill}>
            <Defs>
                {showMarkerPattern ? (
                    <Pattern
                        id="halfMeterCells"
                        x="0"
                        y="0"
                        width={minorCellPx}
                        height={minorCellPx}
                        patternUnits="userSpaceOnUse"
                    >
                        <Rect
                            x={(minorCellPx - markerSize) / 2}
                            y={(minorCellPx - markerSize) / 2}
                            width={markerSize}
                            height={markerSize}
                            rx={markerSize * 0.26}
                            ry={markerSize * 0.26}
                            fill="rgba(74, 121, 188, 0.26)"
                            stroke="rgba(149, 194, 255, 0.34)"
                            strokeWidth={0.65}
                        />
                    </Pattern>
                ) : null}
            </Defs>

            <G x={originX} y={originY}>
                <Rect
                    x={0}
                    y={0}
                    width={mapWidth}
                    height={mapHeight}
                    fill="#0d1626"
                    stroke="#32445f"
                    strokeWidth={2}
                    rx={10}
                    ry={10}
                />

                {showMarkerPattern ? (
                    <Rect x={0} y={0} width={mapWidth} height={mapHeight} fill="url(#halfMeterCells)" />
                ) : null}

                {xLineMeters.map((meters) => {
                    const x = meters * scale;
                    const major = isMajorMeterMark(meters);
                    return (
                        <Line
                            key={`x-${meters}`}
                            x1={x}
                            y1={0}
                            x2={x}
                            y2={mapHeight}
                            stroke={major ? '#36537a' : '#21334e'}
                            strokeWidth={major ? 1.15 : 0.7}
                            opacity={major ? 0.9 : 0.85}
                        />
                    );
                })}

                {yLineMeters.map((meters) => {
                    const y = meters * scale;
                    const major = isMajorMeterMark(meters);
                    return (
                        <Line
                            key={`y-${meters}`}
                            x1={0}
                            y1={y}
                            x2={mapWidth}
                            y2={y}
                            stroke={major ? '#36537a' : '#21334e'}
                            strokeWidth={major ? 1.15 : 0.7}
                            opacity={major ? 0.9 : 0.85}
                        />
                    );
                })}

                {anchors.map((anchor) => (
                    <G key={anchor.id} x={anchor.x * scale} y={anchor.y * scale}>
                        <Circle r={13} fill="#67a5ff" stroke="#ecf3ff" strokeWidth={1.9} />
                        <SvgText y={4.5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0b1423">
                            {getAnchorNumberLabel(anchor.id)}
                        </SvgText>
                    </G>
                ))}
            </G>
        </Svg>
    );
});

MapStaticLayer.displayName = 'MapStaticLayer';

interface VisitedCell {
    ix: number;
    iy: number;
}

interface VisitedLayerProps {
    svgWidth: number;
    svgHeight: number;
    originX: number;
    originY: number;
    scale: number;
    stepMeters: number;
    visitedCells: VisitedCell[];
}

const MapVisitedLayer: React.FC<VisitedLayerProps> = memo(({
    svgWidth,
    svgHeight,
    originX,
    originY,
    scale,
    stepMeters,
    visitedCells,
}) => {
    if (visitedCells.length === 0) return null;
    const cellSize = stepMeters * scale;

    return (
        <Svg width={svgWidth} height={svgHeight} style={StyleSheet.absoluteFill}>
            <G x={originX} y={originY}>
                {visitedCells.map((cell) => (
                    <Rect
                        key={`visited-${cell.ix}-${cell.iy}`}
                        x={cell.ix * cellSize}
                        y={cell.iy * cellSize}
                        width={cellSize}
                        height={cellSize}
                        rx={cellSize * 0.16}
                        ry={cellSize * 0.16}
                        fill="rgba(244, 250, 255, 0.52)"
                        stroke="rgba(255, 255, 255, 0.36)"
                        strokeWidth={0.55}
                    />
                ))}
            </G>
        </Svg>
    );
});

MapVisitedLayer.displayName = 'MapVisitedLayer';

interface DynamicLayerProps {
    svgWidth: number;
    svgHeight: number;
    scale: number;
    originX: number;
    originY: number;
    currentPosition: Position | null;
}

const MapDynamicLayer: React.FC<DynamicLayerProps> = memo(({
    svgWidth,
    svgHeight,
    scale,
    originX,
    originY,
    currentPosition,
}) => {
    if (!currentPosition) return null;

    return (
        <Svg width={svgWidth} height={svgHeight} style={StyleSheet.absoluteFill}>
            <G x={originX} y={originY}>
                <G x={currentPosition.x * scale} y={currentPosition.y * scale}>
                    <Circle
                        r={20}
                        fill={currentPosition.residualError > 2.0 ? 'rgba(251, 113, 133, 0.24)' : 'rgba(45, 212, 191, 0.22)'}
                    />
                    <Circle
                        r={10}
                        fill={currentPosition.residualError > 2.0 ? ui.colors.danger : ui.colors.success}
                    />
                </G>
            </G>
        </Svg>
    );
});

MapDynamicLayer.displayName = 'MapDynamicLayer';

export const Map2D: React.FC<Map2DProps> = ({ fullscreen = false, onRequestFullscreen }) => {
    const roomSize = useStore((state) => state.roomSize);
    const currentPosition = useStore((state) => state.currentPosition);
    const anchorLayoutKey = useStore((state) => state.anchors.map((a) => `${a.id}:${a.x}:${a.y}`).join('|'));

    const anchors = useMemo<AnchorLayout[]>(() => {
        if (!anchorLayoutKey) return [];
        return anchorLayoutKey
            .split('|')
            .map((entry) => {
                const [id, xRaw, yRaw] = entry.split(':');
                const x = Number(xRaw);
                const y = Number(yRaw);
                return {
                    id: id ?? '?',
                    x: Number.isFinite(x) ? x : 0,
                    y: Number.isFinite(y) ? y : 0,
                };
            });
    }, [anchorLayoutKey]);

    const { height: windowHeight } = useWindowDimensions();

    const [containerWidth, setContainerWidth] = useState(0);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
    const [visitedCells, setVisitedCells] = useState<VisitedCell[]>([]);
    const visitedCellSetRef = useRef<Set<string>>(new Set());

    const zoomRef = useRef(zoom);
    const offsetRef = useRef(offset);
    const pendingTransformRef = useRef<{ zoom: number; offset: Point } | null>(null);
    const transformFrameRef = useRef<number | null>(null);
    const gestureRef = useRef<GestureTracker>({
        mode: 'none',
        startZoom: 1,
        startDistance: 1,
        startOffset: { x: 0, y: 0 },
        startMid: { x: 0, y: 0 },
        lastMid: { x: 0, y: 0 },
        baseDx: 0,
        baseDy: 0,
    });

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
        offsetRef.current = offset;
    }, [offset]);

    const minZoom = 1;
    const maxZoom = 2.5;
    const paddingX = 56;
    const paddingTop = 24;
    const paddingBottom = 24;
    const labelBottomSpace = 54;

    const safeRoomWidth = Number.isFinite(roomSize.width) && roomSize.width > 0 ? roomSize.width : 1;
    const safeRoomHeight = Number.isFinite(roomSize.height) && roomSize.height > 0 ? roomSize.height : 1;

    const viewportHeight = fullscreen ? Math.max(windowHeight * 0.72, 430) : Math.min(windowHeight * 0.42, 390);
    const viewportWidth = Math.max(containerWidth, 1);
    const targetMapHeight = Math.max(viewportHeight - 56, 1);
    const availableWidth = Math.max(containerWidth - paddingX * 2, 1);

    const panBuffer = fullscreen ? 220 : 150;
    const pinchMidLerp = 0.32;
    const pinchZoomLerp = 0.34;
    const pinchOffsetLerp = 0.5;
    const pinchZoomDeadzone = 0.0015;
    const minorStepMeters = 0.5;

    const fitScale = useMemo(() => {
        const widthScale = availableWidth / safeRoomWidth;
        const heightScale = targetMapHeight / safeRoomHeight;
        return Math.max(0.01, Math.min(widthScale, heightScale));
    }, [availableWidth, safeRoomWidth, safeRoomHeight, targetMapHeight]);

    const scale = fitScale * zoom;
    const mapWidth = safeRoomWidth * scale;
    const mapHeight = safeRoomHeight * scale;
    const svgWidth = mapWidth + paddingX * 2;
    const svgHeight = mapHeight + paddingTop + paddingBottom + labelBottomSpace;
    const originX = paddingX;
    const originY = paddingTop;

    const xLineMeters = useMemo(() => buildLinePositions(safeRoomWidth, minorStepMeters), [safeRoomWidth]);
    const yLineMeters = useMemo(() => buildLinePositions(safeRoomHeight, minorStepMeters), [safeRoomHeight]);

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const clampZoom = (value: number) => clamp(value, minZoom, maxZoom);

    const minorCellPx = minorStepMeters * scale;
    const markerSize = clamp(minorCellPx * 0.78, 3.8, 16);
    const showMarkerPattern = minorCellPx >= 3.4;

    const getContentSizeForZoom = (z: number) => ({
        width: safeRoomWidth * fitScale * z + paddingX * 2,
        height: safeRoomHeight * fitScale * z + paddingTop + paddingBottom + labelBottomSpace,
    });

    const clampOffsetForZoom = (candidate: Point, z: number): Point => {
        if (viewport.width <= 0 || viewport.height <= 0) return candidate;

        const content = getContentSizeForZoom(z);
        const centerX = (viewport.width - content.width) / 2;
        const centerY = (viewport.height - content.height) / 2;

        const [minX, maxX] =
            content.width <= viewport.width
                ? [centerX - panBuffer, centerX + panBuffer]
                : [viewport.width - content.width - panBuffer, panBuffer];

        const [minY, maxY] =
            content.height <= viewport.height
                ? [centerY - panBuffer, centerY + panBuffer]
                : [viewport.height - content.height - panBuffer, panBuffer];

        return {
            x: clamp(candidate.x, minX, maxX),
            y: clamp(candidate.y, minY, maxY),
        };
    };

    const getCenteredOffsetForZoom = (z: number): Point => {
        const content = getContentSizeForZoom(z);
        return clampOffsetForZoom(
            {
                x: (viewport.width - content.width) / 2,
                y: (viewport.height - content.height) / 2,
            },
            z
        );
    };

    const flushPendingTransform = () => {
        transformFrameRef.current = null;
        const pending = pendingTransformRef.current;
        if (!pending) return;
        pendingTransformRef.current = null;
        zoomRef.current = pending.zoom;
        offsetRef.current = pending.offset;
        setZoom(pending.zoom);
        setOffset(pending.offset);
    };

    const scheduleTransform = (nextZoom: number, nextOffset: Point) => {
        pendingTransformRef.current = { zoom: nextZoom, offset: nextOffset };
        if (transformFrameRef.current !== null) return;
        transformFrameRef.current = requestAnimationFrame(flushPendingTransform);
    };

    const clearPendingTransform = () => {
        if (transformFrameRef.current !== null) {
            cancelAnimationFrame(transformFrameRef.current);
            transformFrameRef.current = null;
        }
        pendingTransformRef.current = null;
    };

    useEffect(() => () => clearPendingTransform(), []);

    const applyOffset = (nextOffset: Point) => {
        const prev = offsetRef.current;
        if (Math.abs(prev.x - nextOffset.x) < 0.01 && Math.abs(prev.y - nextOffset.y) < 0.01) return;
        scheduleTransform(zoomRef.current, nextOffset);
    };

    const applyTransform = (nextZoom: number, nextOffset: Point, immediate: boolean = false) => {
        if (immediate) {
            clearPendingTransform();
            zoomRef.current = nextZoom;
            offsetRef.current = nextOffset;
            setZoom(nextZoom);
            setOffset(nextOffset);
            return;
        }
        scheduleTransform(nextZoom, nextOffset);
    };

    const applyZoomAround = (requestedZoom: number, anchorX: number, anchorY: number) => {
        const currentZoom = zoomRef.current;
        const nextZoom = clampZoom(requestedZoom);
        if (Math.abs(nextZoom - currentZoom) < 0.0001) return;

        const currentOffset = offsetRef.current;
        const ratio = nextZoom / currentZoom;
        const rawOffset = {
            x: anchorX - ratio * (anchorX - currentOffset.x),
            y: anchorY - ratio * (anchorY - currentOffset.y),
        };
        const nextOffset = clampOffsetForZoom(rawOffset, nextZoom);
        applyTransform(nextZoom, nextOffset);
    };

    const recenter = () => {
        applyOffset(getCenteredOffsetForZoom(zoomRef.current));
    };

    const resetZoom = () => {
        const nextZoom = minZoom;
        applyTransform(nextZoom, getCenteredOffsetForZoom(nextZoom), true);
    };

    const zoomByStep = (step: number) => {
        applyZoomAround(zoomRef.current + step, viewport.width / 2, viewport.height / 2);
    };

    const getTouchesDistance = (event: GestureResponderEvent): number => {
        const touches = event.nativeEvent.touches;
        if (!touches || touches.length < 2) return 0;
        const [a, b] = touches;
        if (!a || !b) return 0;
        return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    };

    const getTouchesMidpoint = (event: GestureResponderEvent): Point => {
        const touches = event.nativeEvent.touches;
        if (!touches || touches.length < 2) return { x: viewport.width / 2, y: viewport.height / 2 };
        const [a, b] = touches;
        if (!a || !b) return { x: viewport.width / 2, y: viewport.height / 2 };
        return {
            x: (a.locationX + b.locationX) / 2,
            y: (a.locationY + b.locationY) / 2,
        };
    };

    const startPan = (gestureState: PanResponderGestureState) => {
        gestureRef.current = {
            mode: 'pan',
            startZoom: zoomRef.current,
            startDistance: 1,
            startOffset: offsetRef.current,
            startMid: { x: 0, y: 0 },
            lastMid: { x: 0, y: 0 },
            baseDx: gestureState.dx,
            baseDy: gestureState.dy,
        };
    };

    const startPinch = (event: GestureResponderEvent) => {
        const distance = getTouchesDistance(event);
        if (distance <= 0) return false;

        const midpoint = getTouchesMidpoint(event);
        gestureRef.current = {
            mode: 'pinch',
            startZoom: zoomRef.current,
            startDistance: distance,
            startOffset: offsetRef.current,
            startMid: midpoint,
            lastMid: midpoint,
            baseDx: 0,
            baseDy: 0,
        };
        return true;
    };

    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onMoveShouldSetPanResponder: () => true,
                onPanResponderTerminationRequest: () => false,
                onPanResponderGrant: (event, gestureState) => {
                    if (event.nativeEvent.touches.length >= 2) {
                        startPinch(event);
                    } else {
                        startPan(gestureState);
                    }
                },
                onPanResponderMove: (event, gestureState) => {
                    const touches = event.nativeEvent.touches;

                    if (touches.length >= 2) {
                        if (gestureRef.current.mode !== 'pinch' && !startPinch(event)) return;

                        const distance = getTouchesDistance(event);
                        if (distance <= 0 || gestureRef.current.startDistance <= 0) return;

                        const rawMid = getTouchesMidpoint(event);
                        const smoothedMid = {
                            x: gestureRef.current.lastMid.x + (rawMid.x - gestureRef.current.lastMid.x) * pinchMidLerp,
                            y: gestureRef.current.lastMid.y + (rawMid.y - gestureRef.current.lastMid.y) * pinchMidLerp,
                        };
                        gestureRef.current.lastMid = smoothedMid;

                        const pinchRatio = distance / gestureRef.current.startDistance;
                        const targetZoom = clampZoom(gestureRef.current.startZoom * pinchRatio);
                        const currentZoom = zoomRef.current;
                        const zoomDelta = targetZoom - currentZoom;
                        if (Math.abs(zoomDelta) < pinchZoomDeadzone) return;

                        const nextZoom = clampZoom(currentZoom + zoomDelta * pinchZoomLerp);
                        const scaleRatio = nextZoom / gestureRef.current.startZoom;

                        const rawOffset = {
                            x: smoothedMid.x - scaleRatio * (gestureRef.current.startMid.x - gestureRef.current.startOffset.x),
                            y: smoothedMid.y - scaleRatio * (gestureRef.current.startMid.y - gestureRef.current.startOffset.y),
                        };

                        const clampedOffset = clampOffsetForZoom(rawOffset, nextZoom);
                        const currentOffset = offsetRef.current;
                        const nextOffset = {
                            x: currentOffset.x + (clampedOffset.x - currentOffset.x) * pinchOffsetLerp,
                            y: currentOffset.y + (clampedOffset.y - currentOffset.y) * pinchOffsetLerp,
                        };

                        applyTransform(nextZoom, nextOffset);
                        return;
                    }

                    if (touches.length === 1) {
                        if (gestureRef.current.mode !== 'pan') {
                            startPan(gestureState);
                        }

                        const dx = gestureState.dx - gestureRef.current.baseDx;
                        const dy = gestureState.dy - gestureRef.current.baseDy;

                        const rawOffset = {
                            x: gestureRef.current.startOffset.x + dx,
                            y: gestureRef.current.startOffset.y + dy,
                        };

                        applyOffset(clampOffsetForZoom(rawOffset, zoomRef.current));
                    }
                },
                onPanResponderRelease: () => {
                    gestureRef.current.mode = 'none';
                },
                onPanResponderTerminate: () => {
                    gestureRef.current.mode = 'none';
                },
            }),
        [fitScale, fullscreen, safeRoomHeight, safeRoomWidth, viewport.height, viewport.width]
    );

    const onLayout = (event: LayoutChangeEvent) => {
        setContainerWidth(event.nativeEvent.layout.width);
    };

    const onViewportLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setViewport({ width, height });
    };

    useEffect(() => {
        if (viewport.width <= 0 || viewport.height <= 0) return;
        applyOffset(getCenteredOffsetForZoom(zoomRef.current));
    }, [fitScale, fullscreen, roomSize.height, roomSize.width, viewport.height, viewport.width]);

    useEffect(() => {
        if (viewport.width <= 0 || viewport.height <= 0) return;
        applyOffset(clampOffsetForZoom(offsetRef.current, zoomRef.current));
    }, [fitScale, fullscreen, viewport.height, viewport.width, zoom]);

    useEffect(() => {
        visitedCellSetRef.current.clear();
        setVisitedCells([]);
    }, [safeRoomWidth, safeRoomHeight]);

    useEffect(() => {
        if (!currentPosition) return;
        const maxXIndex = Math.max(0, Math.ceil(safeRoomWidth / minorStepMeters) - 1);
        const maxYIndex = Math.max(0, Math.ceil(safeRoomHeight / minorStepMeters) - 1);

        const ix = clamp(Math.floor(currentPosition.x / minorStepMeters), 0, maxXIndex);
        const iy = clamp(Math.floor(currentPosition.y / minorStepMeters), 0, maxYIndex);
        const key = `${ix}:${iy}`;

        if (visitedCellSetRef.current.has(key)) return;
        visitedCellSetRef.current.add(key);
        setVisitedCells((prev) => [...prev, { ix, iy }]);
    }, [currentPosition, safeRoomWidth, safeRoomHeight]);

    return (
        <View style={[styles.container, fullscreen && styles.containerFullscreen]} onLayout={onLayout}>
            <View style={[styles.controls, fullscreen && styles.controlsFullscreen]}>
                <Pressable
                    onPress={() => zoomByStep(-0.25)}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Zoom out"
                >
                    <ZoomOut size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                <Text style={styles.zoomLabel}>{zoom.toFixed(2)}x</Text>

                <Pressable
                    onPress={() => zoomByStep(0.25)}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Zoom in"
                >
                    <ZoomIn size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                <Pressable
                    onPress={recenter}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Center map"
                >
                    <Crosshair size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                <Pressable
                    onPress={resetZoom}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Reset zoom"
                >
                    <RotateCcw size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                {!fullscreen && onRequestFullscreen ? (
                    <Pressable
                        onPress={onRequestFullscreen}
                        style={[styles.iconButton, styles.iconButtonPrimary]}
                        accessibilityRole="button"
                        accessibilityLabel="Open full screen map"
                    >
                        <Maximize2 size={18} color="#0d1320" strokeWidth={2.2} />
                    </Pressable>
                ) : null}
            </View>

            <View
                style={[
                    styles.gestureViewport,
                    fullscreen && styles.gestureViewportFullscreen,
                    { width: viewportWidth, height: viewportHeight },
                ]}
                onLayout={onViewportLayout}
                {...panResponder.panHandlers}
            >
                <View
                    style={[
                        styles.mapLayer,
                        {
                            width: svgWidth,
                            height: svgHeight,
                            transform: [{ translateX: offset.x }, { translateY: offset.y }],
                        },
                    ]}
                >
                    <MapStaticLayer
                        svgWidth={svgWidth}
                        svgHeight={svgHeight}
                        originX={originX}
                        originY={originY}
                        mapWidth={mapWidth}
                        mapHeight={mapHeight}
                        scale={scale}
                        xLineMeters={xLineMeters}
                        yLineMeters={yLineMeters}
                        markerSize={markerSize}
                        minorCellPx={minorCellPx}
                        showMarkerPattern={showMarkerPattern}
                        anchors={anchors}
                    />

                    <MapVisitedLayer
                        svgWidth={svgWidth}
                        svgHeight={svgHeight}
                        originX={originX}
                        originY={originY}
                        scale={scale}
                        stepMeters={minorStepMeters}
                        visitedCells={visitedCells}
                    />

                    <MapDynamicLayer
                        svgWidth={svgWidth}
                        svgHeight={svgHeight}
                        scale={scale}
                        originX={originX}
                        originY={originY}
                        currentPosition={currentPosition}
                    />
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: ui.colors.panel,
        borderRadius: ui.radius.md,
        overflow: 'hidden',
    },
    containerFullscreen: {
        flex: 1,
        borderRadius: 0,
    },
    controls: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingTop: 10,
        paddingBottom: 8,
    },
    controlsFullscreen: {
        paddingBottom: 10,
    },
    gestureViewport: {
        overflow: 'hidden',
        borderRadius: 10,
        backgroundColor: '#0a111d',
        marginTop: 8,
    },
    gestureViewportFullscreen: {
        marginTop: 8,
    },
    mapLayer: {
        position: 'absolute',
        left: 0,
        top: 0,
    },
    iconButton: {
        width: 34,
        height: 34,
        borderRadius: ui.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: ui.colors.panelMuted,
        borderWidth: 1,
        borderColor: ui.colors.border,
    },
    iconButtonPrimary: {
        backgroundColor: ui.colors.textPrimary,
    },
    zoomLabel: {
        color: ui.colors.textSecondary,
        fontSize: 12,
        fontWeight: '700',
        minWidth: 48,
        textAlign: 'center',
    },
});
