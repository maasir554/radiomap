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
import Svg, { Circle, Defs, G, Line, Pattern, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { Crosshair, Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react-native';
import { ui } from '../theme/ui';

type Point = { x: number; y: number };

export interface LocalTrailCell {
    ix: number;
    iy: number;
}

interface LocalTrailMapProps {
    currentPosition: Point | null;
    currentHeadingRad: number;
    visitedCells: ReadonlyArray<LocalTrailCell>;
    cellSizeMeters?: number;
    fullscreen?: boolean;
    onRequestFullscreen?: () => void;
    resetToken?: number;
}

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

type TrailBounds = {
    minIx: number;
    maxIx: number;
    minIy: number;
    maxIy: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const buildStepIndices = (minValue: number, maxValue: number, step: number): number[] => {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || step <= 0) return [];
    if (maxValue < minValue) return [];

    const start = Math.ceil(minValue / step) * step;
    const indices: number[] = [];
    for (let value = start; value <= maxValue; value += step) {
        indices.push(value);
    }
    return indices;
};

const formatMeters = (meters: number): string => {
    const rounded = Math.round(meters * 10) / 10;
    if (Math.abs(rounded) < 0.0001) return '0';
    if (Math.abs(rounded - Math.round(rounded)) < 0.0001) return `${Math.round(rounded)}`;
    return rounded.toFixed(1);
};

interface StaticLayerProps {
    svgWidth: number;
    svgHeight: number;
    originX: number;
    originY: number;
    mapWidth: number;
    mapHeight: number;
    minIx: number;
    maxIy: number;
    cellSizePx: number;
    cellSizeMeters: number;
    markerSize: number;
    showMarkerPattern: boolean;
    majorVerticalIndices: number[];
    majorHorizontalIndices: number[];
    labelXIndices: number[];
    labelYIndices: number[];
}

const LocalTrailStaticLayer: React.FC<StaticLayerProps> = memo(({
    svgWidth,
    svgHeight,
    originX,
    originY,
    mapWidth,
    mapHeight,
    minIx,
    maxIy,
    cellSizePx,
    cellSizeMeters,
    markerSize,
    showMarkerPattern,
    majorVerticalIndices,
    majorHorizontalIndices,
    labelXIndices,
    labelYIndices,
}) => {
    const originPx = {
        x: (0 - minIx + 0.5) * cellSizePx,
        y: (maxIy - 0 + 0.5) * cellSizePx,
    };

    return (
        <Svg width={svgWidth} height={svgHeight} style={StyleSheet.absoluteFill}>
            <Defs>
                {showMarkerPattern ? (
                    <Pattern
                        id="localMinorCells"
                        x="0"
                        y="0"
                        width={cellSizePx}
                        height={cellSizePx}
                        patternUnits="userSpaceOnUse"
                    >
                        <Rect
                            x={(cellSizePx - markerSize) / 2}
                            y={(cellSizePx - markerSize) / 2}
                            width={markerSize}
                            height={markerSize}
                            rx={Math.max(1, markerSize * 0.24)}
                            ry={Math.max(1, markerSize * 0.24)}
                            fill="rgba(90, 126, 178, 0.24)"
                            stroke="rgba(170, 208, 255, 0.3)"
                            strokeWidth={0.6}
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
                    stroke="#2c3f5c"
                    strokeWidth={2}
                    rx={10}
                    ry={10}
                />

                {showMarkerPattern ? (
                    <Rect x={0} y={0} width={mapWidth} height={mapHeight} fill="url(#localMinorCells)" />
                ) : null}

                {majorVerticalIndices.map((ix) => {
                    const x = (ix - minIx + 0.5) * cellSizePx;
                    return (
                        <Line
                            key={`major-x-${ix}`}
                            x1={x}
                            y1={0}
                            x2={x}
                            y2={mapHeight}
                            stroke="#36537a"
                            strokeWidth={0.95}
                            opacity={0.9}
                        />
                    );
                })}

                {majorHorizontalIndices.map((iy) => {
                    const y = (maxIy - iy + 0.5) * cellSizePx;
                    return (
                        <Line
                            key={`major-y-${iy}`}
                            x1={0}
                            y1={y}
                            x2={mapWidth}
                            y2={y}
                            stroke="#36537a"
                            strokeWidth={0.95}
                            opacity={0.9}
                        />
                    );
                })}

                <Line
                    x1={originPx.x}
                    y1={0}
                    x2={originPx.x}
                    y2={mapHeight}
                    stroke="#fbbf24"
                    strokeWidth={1.35}
                    opacity={0.95}
                />
                <Line
                    x1={0}
                    y1={originPx.y}
                    x2={mapWidth}
                    y2={originPx.y}
                    stroke="#fbbf24"
                    strokeWidth={1.35}
                    opacity={0.95}
                />

                <Circle cx={originPx.x} cy={originPx.y} r={7} fill="#fbbf24" stroke="#fff8dd" strokeWidth={1.2} />
                <SvgText
                    x={originPx.x}
                    y={originPx.y - 11}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#ffe7a3"
                >
                    O
                </SvgText>

                {labelXIndices.map((ix) => {
                    const x = (ix - minIx + 0.5) * cellSizePx;
                    const meters = ix * cellSizeMeters;
                    return (
                        <SvgText
                            key={`label-x-${ix}`}
                            x={x}
                            y={mapHeight + 20}
                            textAnchor="middle"
                            fontSize="10"
                            fontWeight="700"
                            fill="#8fa5c7"
                        >
                            {formatMeters(meters)}
                        </SvgText>
                    );
                })}

                {labelYIndices.map((iy) => {
                    const y = (maxIy - iy + 0.5) * cellSizePx + 3.5;
                    const meters = iy * cellSizeMeters;
                    return (
                        <SvgText
                            key={`label-y-${iy}`}
                            x={-12}
                            y={y}
                            textAnchor="end"
                            fontSize="10"
                            fontWeight="700"
                            fill="#8fa5c7"
                        >
                            {formatMeters(meters)}
                        </SvgText>
                    );
                })}
            </G>
        </Svg>
    );
});

LocalTrailStaticLayer.displayName = 'LocalTrailStaticLayer';

interface TrailLayerProps {
    svgWidth: number;
    svgHeight: number;
    originX: number;
    originY: number;
    minIx: number;
    maxIy: number;
    cellSizePx: number;
    visitedCells: ReadonlyArray<LocalTrailCell>;
}

const LocalTrailVisitedLayer: React.FC<TrailLayerProps> = memo(({
    svgWidth,
    svgHeight,
    originX,
    originY,
    minIx,
    maxIy,
    cellSizePx,
    visitedCells,
}) => {
    if (visitedCells.length === 0) return null;

    const cellRadius = clamp(cellSizePx * 0.21, 1, 4.2);

    return (
        <Svg width={svgWidth} height={svgHeight} style={StyleSheet.absoluteFill}>
            <G x={originX} y={originY}>
                {visitedCells.map((cell) => (
                    <Rect
                        key={`trail-${cell.ix}-${cell.iy}`}
                        x={(cell.ix - minIx) * cellSizePx}
                        y={(maxIy - cell.iy) * cellSizePx}
                        width={cellSizePx}
                        height={cellSizePx}
                        rx={cellRadius}
                        ry={cellRadius}
                        fill="rgba(246, 251, 255, 0.56)"
                        stroke="rgba(255, 255, 255, 0.38)"
                        strokeWidth={0.5}
                    />
                ))}
            </G>
        </Svg>
    );
});

LocalTrailVisitedLayer.displayName = 'LocalTrailVisitedLayer';

interface DynamicLayerProps {
    svgWidth: number;
    svgHeight: number;
    originX: number;
    originY: number;
    minIx: number;
    maxIy: number;
    cellSizePx: number;
    cellSizeMeters: number;
    currentPosition: Point | null;
    currentHeadingRad: number;
}

const LocalTrailDynamicLayer: React.FC<DynamicLayerProps> = memo(({
    svgWidth,
    svgHeight,
    originX,
    originY,
    minIx,
    maxIy,
    cellSizePx,
    cellSizeMeters,
    currentPosition,
    currentHeadingRad,
}) => {
    if (!currentPosition) return null;

    const xUnits = currentPosition.x / cellSizeMeters;
    const yUnits = currentPosition.y / cellSizeMeters;
    const px = (xUnits - minIx + 0.5) * cellSizePx;
    const py = (maxIy - yUnits + 0.5) * cellSizePx;

    const headingLen = clamp(cellSizePx * 3.2, 16, 42);
    const headingEnd = {
        x: px + Math.cos(currentHeadingRad) * headingLen,
        y: py - Math.sin(currentHeadingRad) * headingLen,
    };
    const arrowWing = clamp(cellSizePx * 0.72, 5, 12);
    const wingLeft = {
        x: headingEnd.x - Math.cos(currentHeadingRad - Math.PI / 2) * arrowWing,
        y: headingEnd.y + Math.sin(currentHeadingRad - Math.PI / 2) * arrowWing,
    };
    const wingRight = {
        x: headingEnd.x - Math.cos(currentHeadingRad + Math.PI / 2) * arrowWing,
        y: headingEnd.y + Math.sin(currentHeadingRad + Math.PI / 2) * arrowWing,
    };

    return (
        <Svg width={svgWidth} height={svgHeight} style={StyleSheet.absoluteFill}>
            <G x={originX} y={originY}>
                <Line x1={px} y1={py} x2={headingEnd.x} y2={headingEnd.y} stroke="#7dd3fc" strokeWidth={2.3} />
                <Polygon
                    points={`${headingEnd.x},${headingEnd.y} ${wingLeft.x},${wingLeft.y} ${wingRight.x},${wingRight.y}`}
                    fill="#7dd3fc"
                />
                <Circle cx={px} cy={py} r={13} fill="rgba(34, 211, 238, 0.24)" />
                <Circle cx={px} cy={py} r={8} fill={ui.colors.success} />
            </G>
        </Svg>
    );
});

LocalTrailDynamicLayer.displayName = 'LocalTrailDynamicLayer';

export const LocalTrailMap: React.FC<LocalTrailMapProps> = ({
    currentPosition,
    currentHeadingRad,
    visitedCells,
    cellSizeMeters = 0.1,
    fullscreen = false,
    onRequestFullscreen,
    resetToken,
}) => {
    const { height: windowHeight } = useWindowDimensions();

    const [containerWidth, setContainerWidth] = useState(0);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

    const zoomRef = useRef(zoom);
    const offsetRef = useRef(offset);
    const pendingTransformRef = useRef<{ zoom: number; offset: Point } | null>(null);
    const transformFrameRef = useRef<number | null>(null);
    const hasInitialCenterRef = useRef(false);
    const previousBoundsRef = useRef<TrailBounds | null>(null);

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

    const paddingX = 58;
    const paddingTop = 24;
    const paddingBottom = 24;
    const labelBottomSpace = 44;
    const panBuffer = fullscreen ? 260 : 180;

    const minZoom = 0.55;
    const maxZoom = 4.8;
    const baseMetersToPx = fullscreen ? 34 : 30;
    const minorMetersStep = 0.5;
    const labelMetersStep = 1;

    const viewportHeight = fullscreen ? Math.max(windowHeight * 0.72, 430) : Math.min(windowHeight * 0.42, 390);
    const viewportWidth = Math.max(containerWidth, 1);

    const bounds = useMemo<TrailBounds>(() => {
        const currentIx = currentPosition ? Math.round(currentPosition.x / cellSizeMeters) : 0;
        const currentIy = currentPosition ? Math.round(currentPosition.y / cellSizeMeters) : 0;

        let minIx = Math.min(0, currentIx);
        let maxIx = Math.max(0, currentIx);
        let minIy = Math.min(0, currentIy);
        let maxIy = Math.max(0, currentIy);

        for (const cell of visitedCells) {
            if (cell.ix < minIx) minIx = cell.ix;
            if (cell.ix > maxIx) maxIx = cell.ix;
            if (cell.iy < minIy) minIy = cell.iy;
            if (cell.iy > maxIy) maxIy = cell.iy;
        }

        const marginCells = 8;
        return {
            minIx: minIx - marginCells,
            maxIx: maxIx + marginCells,
            minIy: minIy - marginCells,
            maxIy: maxIy + marginCells,
        };
    }, [cellSizeMeters, currentPosition, visitedCells]);

    const minIx = bounds.minIx;
    const maxIx = bounds.maxIx;
    const minIy = bounds.minIy;
    const maxIy = bounds.maxIy;

    const spanXCells = Math.max(1, maxIx - minIx + 1);
    const spanYCells = Math.max(1, maxIy - minIy + 1);

    const scale = baseMetersToPx * zoom;
    const cellSizePx = cellSizeMeters * scale;
    const mapWidth = spanXCells * cellSizePx;
    const mapHeight = spanYCells * cellSizePx;
    const svgWidth = mapWidth + paddingX * 2;
    const svgHeight = mapHeight + paddingTop + paddingBottom + labelBottomSpace;
    const originX = paddingX;
    const originY = paddingTop;

    const majorStepCells = Math.max(1, Math.round(minorMetersStep / cellSizeMeters));
    const labelStepCells = Math.max(1, Math.round(labelMetersStep / cellSizeMeters));
    const majorVerticalIndices = useMemo(
        () => buildStepIndices(minIx, maxIx, majorStepCells),
        [maxIx, majorStepCells, minIx]
    );
    const majorHorizontalIndices = useMemo(
        () => buildStepIndices(minIy, maxIy, majorStepCells),
        [maxIy, majorStepCells, minIy]
    );
    const labelXIndices = useMemo(
        () => buildStepIndices(minIx, maxIx, labelStepCells),
        [labelStepCells, maxIx, minIx]
    );
    const labelYIndices = useMemo(
        () => buildStepIndices(minIy, maxIy, labelStepCells),
        [labelStepCells, maxIy, minIy]
    );

    const markerSize = clamp(cellSizePx * 0.72, 2.8, 13);
    const showMarkerPattern = cellSizePx >= 2.1;

    const getContentSizeForZoom = (z: number) => {
        const nextCellSizePx = cellSizeMeters * baseMetersToPx * z;
        return {
            width: spanXCells * nextCellSizePx + paddingX * 2,
            height: spanYCells * nextCellSizePx + paddingTop + paddingBottom + labelBottomSpace,
        };
    };

    const clampZoom = (value: number) => clamp(value, minZoom, maxZoom);

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

    const applyOffset = (nextOffset: Point) => {
        const prev = offsetRef.current;
        if (Math.abs(prev.x - nextOffset.x) < 0.01 && Math.abs(prev.y - nextOffset.y) < 0.01) return;
        scheduleTransform(zoomRef.current, nextOffset);
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

    const resetView = () => {
        const nextZoom = 1;
        applyTransform(nextZoom, getCenteredOffsetForZoom(nextZoom), true);
    };

    const zoomByStep = (step: number) => {
        applyZoomAround(zoomRef.current + step, viewport.width / 2, viewport.height / 2);
    };

    useEffect(() => {
        if (viewport.width <= 0 || viewport.height <= 0 || hasInitialCenterRef.current) return;
        hasInitialCenterRef.current = true;
        resetView();
    }, [viewport.height, viewport.width]);

    useEffect(() => {
        if (viewport.width <= 0 || viewport.height <= 0) return;
        applyOffset(clampOffsetForZoom(offsetRef.current, zoomRef.current));
    }, [spanXCells, spanYCells, viewport.height, viewport.width]);

    useEffect(() => {
        if (viewport.width <= 0 || viewport.height <= 0) return;

        const previous = previousBoundsRef.current;
        previousBoundsRef.current = bounds;
        if (!previous) return;

        const shifts = {
            x: (bounds.minIx - previous.minIx) * cellSizeMeters * baseMetersToPx * zoomRef.current,
            y: (previous.maxIy - bounds.maxIy) * cellSizeMeters * baseMetersToPx * zoomRef.current,
        };

        if (Math.abs(shifts.x) < 0.01 && Math.abs(shifts.y) < 0.01) return;

        const shiftedOffset = clampOffsetForZoom(
            {
                x: offsetRef.current.x + shifts.x,
                y: offsetRef.current.y + shifts.y,
            },
            zoomRef.current
        );
        applyTransform(zoomRef.current, shiftedOffset, true);
    }, [
        baseMetersToPx,
        bounds,
        cellSizeMeters,
        spanXCells,
        spanYCells,
        viewport.height,
        viewport.width,
    ]);

    useEffect(() => {
        if (resetToken === undefined) return;
        resetView();
    }, [resetToken]);

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

    const startPinch = (event: GestureResponderEvent): boolean => {
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
                            x: gestureRef.current.lastMid.x + (rawMid.x - gestureRef.current.lastMid.x) * 0.3,
                            y: gestureRef.current.lastMid.y + (rawMid.y - gestureRef.current.lastMid.y) * 0.3,
                        };
                        gestureRef.current.lastMid = smoothedMid;

                        const pinchRatio = distance / gestureRef.current.startDistance;
                        const targetZoom = clampZoom(gestureRef.current.startZoom * pinchRatio);
                        const currentZoom = zoomRef.current;
                        const zoomDelta = targetZoom - currentZoom;
                        if (Math.abs(zoomDelta) < 0.0015) return;

                        const nextZoom = clampZoom(currentZoom + zoomDelta * 0.32);
                        const scaleRatio = nextZoom / gestureRef.current.startZoom;

                        const rawOffset = {
                            x: smoothedMid.x - scaleRatio * (gestureRef.current.startMid.x - gestureRef.current.startOffset.x),
                            y: smoothedMid.y - scaleRatio * (gestureRef.current.startMid.y - gestureRef.current.startOffset.y),
                        };

                        const clampedOffset = clampOffsetForZoom(rawOffset, nextZoom);
                        const currentOffset = offsetRef.current;
                        const nextOffset = {
                            x: currentOffset.x + (clampedOffset.x - currentOffset.x) * 0.52,
                            y: currentOffset.y + (clampedOffset.y - currentOffset.y) * 0.52,
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
        [spanXCells, spanYCells, viewport.height, viewport.width]
    );

    const onLayout = (event: LayoutChangeEvent) => {
        setContainerWidth(event.nativeEvent.layout.width);
    };

    const onViewportLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setViewport({ width, height });
    };

    const visibleVisitedCells = useMemo(() => {
        if (visitedCells.length === 0) return visitedCells;
        if (viewport.width <= 0 || viewport.height <= 0 || cellSizePx <= 0) return visitedCells;

        const leftUnits = (-offset.x - originX) / cellSizePx;
        const rightUnits = (viewport.width - offset.x - originX) / cellSizePx;
        const topRows = (-offset.y - originY) / cellSizePx;
        const bottomRows = (viewport.height - offset.y - originY) / cellSizePx;

        const ixMinVisible = minIx + Math.floor(leftUnits) - 2;
        const ixMaxVisible = minIx + Math.ceil(rightUnits) + 2;
        const rowMinVisible = Math.floor(topRows) - 2;
        const rowMaxVisible = Math.ceil(bottomRows) + 2;
        const iyMaxVisible = maxIy - rowMinVisible;
        const iyMinVisible = maxIy - rowMaxVisible;

        return visitedCells.filter(
            (cell) =>
                cell.ix >= ixMinVisible &&
                cell.ix <= ixMaxVisible &&
                cell.iy >= iyMinVisible &&
                cell.iy <= iyMaxVisible
        );
    }, [visitedCells, viewport.width, viewport.height, offset.x, offset.y, originX, originY, cellSizePx, minIx, maxIy]);

    return (
        <View style={[styles.container, fullscreen && styles.containerFullscreen]} onLayout={onLayout}>
            <View style={[styles.controls, fullscreen && styles.controlsFullscreen]}>
                <Pressable onPress={() => zoomByStep(-0.25)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Zoom out">
                    <ZoomOut size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                <Text style={styles.zoomLabel}>{zoom.toFixed(2)}x</Text>

                <Pressable onPress={() => zoomByStep(0.25)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Zoom in">
                    <ZoomIn size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                <Pressable onPress={recenter} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Center map">
                    <Crosshair size={18} color={ui.colors.textPrimary} strokeWidth={2.1} />
                </Pressable>

                <Pressable onPress={resetView} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Reset view">
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
                    <LocalTrailStaticLayer
                        svgWidth={svgWidth}
                        svgHeight={svgHeight}
                        originX={originX}
                        originY={originY}
                        mapWidth={mapWidth}
                        mapHeight={mapHeight}
                        minIx={minIx}
                        maxIy={maxIy}
                        cellSizePx={cellSizePx}
                        cellSizeMeters={cellSizeMeters}
                        markerSize={markerSize}
                        showMarkerPattern={showMarkerPattern}
                        majorVerticalIndices={majorVerticalIndices}
                        majorHorizontalIndices={majorHorizontalIndices}
                        labelXIndices={labelXIndices}
                        labelYIndices={labelYIndices}
                    />

                    <LocalTrailVisitedLayer
                        svgWidth={svgWidth}
                        svgHeight={svgHeight}
                        originX={originX}
                        originY={originY}
                        minIx={minIx}
                        maxIy={maxIy}
                        cellSizePx={cellSizePx}
                        visitedCells={visibleVisitedCells}
                    />

                    <LocalTrailDynamicLayer
                        svgWidth={svgWidth}
                        svgHeight={svgHeight}
                        originX={originX}
                        originY={originY}
                        minIx={minIx}
                        maxIy={maxIy}
                        cellSizePx={cellSizePx}
                        cellSizeMeters={cellSizeMeters}
                        currentPosition={currentPosition}
                        currentHeadingRad={currentHeadingRad}
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
