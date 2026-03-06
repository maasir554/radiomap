import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { Canvas, Circle, Line, RoundedRect } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { LinearTransition, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Check, MoveDiagonal2, RotateCcw, Scaling, X } from 'lucide-react-native';
import { ui } from '../theme/ui';

interface AnchorPoint {
    id: string;
    x: number;
    y: number;
}

interface VisualSetupModalProps {
    visible: boolean;
    initialWidth: number;
    initialHeight: number;
    anchors: AnchorPoint[];
    onClose: () => void;
    onSave: (payload: { width: number; height: number; anchors: AnchorPoint[] }) => void;
}

type Mode = 'resize' | 'anchor';
type VertexKey = 'tl' | 'tr' | 'bl' | 'br';

type GestureTarget =
    | { type: 'none' }
    | { type: 'resize'; startWidth: number; startHeight: number }
    | { type: 'anchor'; anchorId: string; fromVertex: VertexKey };

const MAX_ROOM_METERS = 30;
const MIN_ROOM_METERS = 1;
const DEFAULT_CANVAS_SIZE = 320;
const CANVAS_PADDING = 24;
const HANDLE_HIT_RADIUS = 40;
const ANCHOR_HIT_RADIUS = 26;
const ANCHOR_MARKER_SIZE = 30;
const SWAP_TRIGGER_RADIUS = 24;
const MIN_ZOOM = 0.7;
const DEFAULT_ZOOM = 1;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const VERTEX_ORDER: VertexKey[] = ['tl', 'tr', 'bl', 'br'];

const getVertexMeters = (width: number, height: number): Record<VertexKey, { x: number; y: number }> => ({
    tl: { x: 0, y: 0 },
    tr: { x: width, y: 0 },
    bl: { x: 0, y: height },
    br: { x: width, y: height },
});

const resolveInitialAssignment = (
    anchors: AnchorPoint[],
    width: number,
    height: number
): Record<VertexKey, string> => {
    const available = new Set<VertexKey>(VERTEX_ORDER);
    const assignment: Partial<Record<VertexKey, string>> = {};
    const vertices = getVertexMeters(width, height);

    anchors.forEach((anchor) => {
        const sorted = [...available].sort((a, b) => {
            const da = Math.hypot(anchor.x - vertices[a].x, anchor.y - vertices[a].y);
            const db = Math.hypot(anchor.x - vertices[b].x, anchor.y - vertices[b].y);
            return da - db;
        });
        const chosen = sorted[0];
        if (!chosen) return;
        assignment[chosen] = anchor.id;
        available.delete(chosen);
    });

    const defaults = ['BLUEPOINT-01', 'BLUEPOINT-02', 'BLUEPOINT-03', 'BLUEPOINT-04'];
    const pool = [...defaults, ...anchors.map((a) => a.id)];
    const used = new Set<string>(Object.values(assignment).filter(Boolean) as string[]);

    for (const vertex of VERTEX_ORDER) {
        if (assignment[vertex]) continue;
        const id = pool.find((candidate) => !used.has(candidate));
        if (!id) continue;
        assignment[vertex] = id;
        used.add(id);
    }

    return assignment as Record<VertexKey, string>;
};

const anchorNumber = (anchorId: string): string => {
    const suffix = anchorId.split('-').pop();
    return suffix ? String(Number(suffix)) : '?';
};

export const VisualSetupModal: React.FC<VisualSetupModalProps> = ({
    visible,
    initialWidth,
    initialHeight,
    anchors,
    onClose,
    onSave,
}) => {
    const { width: windowWidth } = useWindowDimensions();
    const [mode, setMode] = useState<Mode>('resize');
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [editingField, setEditingField] = useState<'width' | 'height' | null>(null);
    const [dimensionInput, setDimensionInput] = useState('');
    const [room, setRoom] = useState({
        width: clamp(initialWidth, MIN_ROOM_METERS, MAX_ROOM_METERS),
        height: clamp(initialHeight, MIN_ROOM_METERS, MAX_ROOM_METERS),
    });
    const [assignment, setAssignment] = useState<Record<VertexKey, string>>(
        resolveInitialAssignment(
            anchors,
            clamp(initialWidth, MIN_ROOM_METERS, MAX_ROOM_METERS),
            clamp(initialHeight, MIN_ROOM_METERS, MAX_ROOM_METERS)
        )
    );
    const [hoverVertex, setHoverVertex] = useState<VertexKey | null>(null);
    const [draggingAnchorId, setDraggingAnchorId] = useState<string | null>(null);

    const modeRef = useRef<Mode>('resize');
    const gestureTargetRef = useRef<GestureTarget>({ type: 'none' });
    const hoverVertexRef = useRef<VertexKey | null>(null);
    const assignmentRef = useRef(assignment);
    const roomRef = useRef(room);
    const pendingRoomRef = useRef(room);
    const frameRef = useRef<number | null>(null);

    const dragX = useSharedValue(0);
    const dragY = useSharedValue(0);

    const canvasSize = useMemo(
        () => clamp(windowWidth - ui.spacing.lg * 2, 280, 360),
        [windowWidth]
    );
    const maxZoom = useMemo(() => {
        const byWidth = MAX_ROOM_METERS / Math.max(room.width, MIN_ROOM_METERS);
        const byHeight = MAX_ROOM_METERS / Math.max(room.height, MIN_ROOM_METERS);
        return clamp(Math.min(byWidth, byHeight), DEFAULT_ZOOM, 4);
    }, [room.height, room.width]);
    const safeZoom = clamp(zoom, MIN_ZOOM, maxZoom);

    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);

    useEffect(() => {
        hoverVertexRef.current = hoverVertex;
    }, [hoverVertex]);

    useEffect(() => {
        roomRef.current = room;
    }, [room]);

    useEffect(() => {
        assignmentRef.current = assignment;
    }, [assignment]);

    useEffect(() => {
        if (!visible) return;
        const nextWidth = clamp(initialWidth, MIN_ROOM_METERS, MAX_ROOM_METERS);
        const nextHeight = clamp(initialHeight, MIN_ROOM_METERS, MAX_ROOM_METERS);
        setRoom({ width: nextWidth, height: nextHeight });
        setAssignment(resolveInitialAssignment(anchors, nextWidth, nextHeight));
        setZoom(DEFAULT_ZOOM);
        setEditingField(null);
        setDimensionInput('');
        setMode('resize');
        setHoverVertex(null);
        hoverVertexRef.current = null;
        setDraggingAnchorId(null);
        gestureTargetRef.current = { type: 'none' };
        assignmentRef.current = resolveInitialAssignment(anchors, nextWidth, nextHeight);
    }, [visible, initialWidth, initialHeight, anchors]);

    useEffect(() => {
        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, []);

    const pixelsPerMeter = useMemo(
        () => ((canvasSize - CANVAS_PADDING * 2) / MAX_ROOM_METERS) * safeZoom,
        [canvasSize, safeZoom]
    );

    const roomRect = useMemo(
        () => ({
            x: CANVAS_PADDING,
            y: CANVAS_PADDING,
            width: room.width * pixelsPerMeter,
            height: room.height * pixelsPerMeter,
        }),
        [pixelsPerMeter, room.height, room.width]
    );
    const widthLabelX = clamp(roomRect.x + roomRect.width / 2 - 52, 8, canvasSize - 104);
    const widthLabelY = clamp(roomRect.y - 28, 4, canvasSize - 28);
    const heightLabelX = clamp(roomRect.x + 6, 4, canvasSize - 88);
    const heightLabelY = clamp(roomRect.y + roomRect.height / 2 - 14, 6, canvasSize - 28);

    const renderAnchors = useMemo(() => {
        const seen = new Set<string>();
        return VERTEX_ORDER.map((vertex) => {
            const anchorId = assignment[vertex];
            if (!anchorId || seen.has(anchorId)) return null;
            seen.add(anchorId);
            return { vertex, anchorId };
        }).filter((entry): entry is { vertex: VertexKey; anchorId: string } => entry !== null);
    }, [assignment]);

    const vertexScreenPosition = (vertex: VertexKey) => {
        if (vertex === 'tl') return { x: roomRect.x, y: roomRect.y };
        if (vertex === 'tr') return { x: roomRect.x + roomRect.width, y: roomRect.y };
        if (vertex === 'bl') return { x: roomRect.x, y: roomRect.y + roomRect.height };
        return { x: roomRect.x + roomRect.width, y: roomRect.y + roomRect.height };
    };

    const getAnchorVertex = (anchorId: string): VertexKey | null => {
        for (const vertex of VERTEX_ORDER) {
            if (assignment[vertex] === anchorId) return vertex;
        }
        return null;
    };

    const getAnchorVertexFromMap = (map: Record<VertexKey, string>, anchorId: string): VertexKey | null => {
        for (const vertex of VERTEX_ORDER) {
            if (map[vertex] === anchorId) return vertex;
        }
        return null;
    };

    const roomCornerHit = (x: number, y: number) => {
        const cx = roomRect.x + roomRect.width;
        const cy = roomRect.y + roomRect.height;
        return Math.hypot(cx - x, cy - y) <= HANDLE_HIT_RADIUS;
    };

    const hitAnchorByPoint = (x: number, y: number): string | null => {
        for (const vertex of VERTEX_ORDER) {
            const id = assignment[vertex];
            const pos = vertexScreenPosition(vertex);
            if (Math.hypot(pos.x - x, pos.y - y) <= ANCHOR_HIT_RADIUS) {
                return id;
            }
        }
        return null;
    };

    const nearestVertexByPoint = (x: number, y: number): VertexKey => {
        let winner: VertexKey = 'tl';
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const vertex of VERTEX_ORDER) {
            const pos = vertexScreenPosition(vertex);
            const distance = Math.hypot(pos.x - x, pos.y - y);
            if (distance < bestDistance) {
                bestDistance = distance;
                winner = vertex;
            }
        }
        return winner;
    };

    const scheduleRoomUpdate = (width: number, height: number) => {
        pendingRoomRef.current = { width, height };
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            setRoom({
                width: Number(pendingRoomRef.current.width.toFixed(3)),
                height: Number(pendingRoomRef.current.height.toFixed(3)),
            });
        });
    };

    const openDimensionEditor = (field: 'width' | 'height') => {
        setEditingField(field);
        setDimensionInput((field === 'width' ? room.width : room.height).toFixed(2));
    };

    const applyDimensionEdit = () => {
        if (!editingField) return;
        const parsed = Number(dimensionInput);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        const next = Number(clamp(parsed, MIN_ROOM_METERS, MAX_ROOM_METERS).toFixed(2));
        if (editingField === 'width') {
            const updated = { width: next, height: room.height };
            setRoom(updated);
            pendingRoomRef.current = updated;
        } else {
            const updated = { width: room.width, height: next };
            setRoom(updated);
            pendingRoomRef.current = updated;
        }
        Keyboard.dismiss();
        setEditingField(null);
    };

    const swapAnchorImmediately = (anchorId: string, toVertex: VertexKey) => {
        const currentMap = assignmentRef.current;
        const fromVertex = getAnchorVertexFromMap(currentMap, anchorId);
        if (!fromVertex || fromVertex === toVertex) return;

        const displaced = currentMap[toVertex];
        if (!displaced || displaced === anchorId) return;

        const next: Record<VertexKey, string> = {
            ...currentMap,
            [toVertex]: anchorId,
            [fromVertex]: displaced,
        };
        assignmentRef.current = next;
        setAssignment(next);

        if (gestureTargetRef.current.type === 'anchor' && gestureTargetRef.current.anchorId === anchorId) {
            gestureTargetRef.current = { ...gestureTargetRef.current, fromVertex: toVertex };
        }
    };

    const panGesture = useMemo(
        () =>
            Gesture.Pan()
                .runOnJS(true)
                .onBegin((event: any) => {
                    if (modeRef.current === 'resize') {
                        if (!roomCornerHit(event.x, event.y)) {
                            gestureTargetRef.current = { type: 'none' };
                            return;
                        }
                        gestureTargetRef.current = {
                            type: 'resize',
                            startWidth: roomRef.current.width,
                            startHeight: roomRef.current.height,
                        };
                        return;
                    }

                    const anchorId = hitAnchorByPoint(event.x, event.y);
                    if (!anchorId) {
                        gestureTargetRef.current = { type: 'none' };
                        return;
                    }

                    const fromVertex = getAnchorVertex(anchorId);
                    if (!fromVertex) {
                        gestureTargetRef.current = { type: 'none' };
                        return;
                    }

                    const fromPos = vertexScreenPosition(fromVertex);
                    dragX.value = fromPos.x;
                    dragY.value = fromPos.y;
                    setDraggingAnchorId(anchorId);
                    setHoverVertex(fromVertex);
                    hoverVertexRef.current = fromVertex;
                    gestureTargetRef.current = { type: 'anchor', anchorId, fromVertex };
                })
                .onUpdate((event: any) => {
                    const target = gestureTargetRef.current;
                    if (modeRef.current === 'resize' && target.type === 'resize') {
                        const nextWidth = clamp(
                            target.startWidth + event.translationX / pixelsPerMeter,
                            MIN_ROOM_METERS,
                            MAX_ROOM_METERS
                        );
                        const nextHeight = clamp(
                            target.startHeight + event.translationY / pixelsPerMeter,
                            MIN_ROOM_METERS,
                            MAX_ROOM_METERS
                        );
                        scheduleRoomUpdate(nextWidth, nextHeight);
                        return;
                    }

                    if (modeRef.current === 'anchor' && target.type === 'anchor') {
                        dragX.value = clamp(event.x, CANVAS_PADDING, canvasSize - CANVAS_PADDING);
                        dragY.value = clamp(event.y, CANVAS_PADDING, canvasSize - CANVAS_PADDING);
                        const nearest = nearestVertexByPoint(event.x, event.y);
                        const nearestPos = vertexScreenPosition(nearest);
                        const nearEnough = Math.hypot(event.x - nearestPos.x, event.y - nearestPos.y) <= SWAP_TRIGGER_RADIUS;
                        setHoverVertex(nearest);
                        hoverVertexRef.current = nearest;
                        if (nearEnough) {
                            swapAnchorImmediately(target.anchorId, nearest);
                        }
                    }
                })
                .onEnd(() => {
                    const target = gestureTargetRef.current;
                    if (target.type === 'resize') {
                        const pending = pendingRoomRef.current;
                        setRoom({
                            width: Number(pending.width.toFixed(2)),
                            height: Number(pending.height.toFixed(2)),
                        });
                    }

                    setDraggingAnchorId(null);
                    setHoverVertex(null);
                    hoverVertexRef.current = null;
                    gestureTargetRef.current = { type: 'none' };
                })
                .onFinalize(() => {
                    setDraggingAnchorId(null);
                    setHoverVertex(null);
                    hoverVertexRef.current = null;
                    gestureTargetRef.current = { type: 'none' };
                }),
        [assignment, canvasSize, pixelsPerMeter, roomRect.height, roomRect.width, roomRect.x, roomRect.y]
    );

    const resetToDefault = () => {
        setAssignment(resolveInitialAssignment(anchors, room.width, room.height));
    };

    const applyAndClose = () => {
        const used = new Set<string>();
        const sanitized: Record<VertexKey, string> = { ...assignment };
        const fallbackPool = ['BLUEPOINT-01', 'BLUEPOINT-02', 'BLUEPOINT-03', 'BLUEPOINT-04', ...anchors.map((a) => a.id)];

        for (const vertex of VERTEX_ORDER) {
            const current = sanitized[vertex];
            if (current && !used.has(current)) {
                used.add(current);
                continue;
            }
            const replacement = fallbackPool.find((id) => !used.has(id));
            if (!replacement) continue;
            sanitized[vertex] = replacement;
            used.add(replacement);
        }

        const vertices = getVertexMeters(room.width, room.height);
        const mappedAnchors = VERTEX_ORDER.map((vertex) => ({
            id: sanitized[vertex],
            x: Number(vertices[vertex].x.toFixed(2)),
            y: Number(vertices[vertex].y.toFixed(2)),
        }));

        onSave({
            width: Number(room.width.toFixed(2)),
            height: Number(room.height.toFixed(2)),
            anchors: mappedAnchors,
        });
        onClose();
    };

    const draggingStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: dragX.value - ANCHOR_MARKER_SIZE / 2 },
            { translateY: dragY.value - ANCHOR_MARKER_SIZE / 2 },
        ],
    }));

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <GestureHandlerRootView style={styles.modalRoot}>
                <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    <View style={styles.headerRow}>
                        <Text style={styles.title}>Visual Setup</Text>
                        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                            <X size={16} color={ui.colors.textPrimary} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.modeRow}>
                        <TouchableOpacity
                            style={[styles.modeBtn, mode === 'resize' && styles.modeBtnActive]}
                            onPress={() => setMode('resize')}
                        >
                            <Scaling size={14} color={mode === 'resize' ? '#0d1320' : ui.colors.textPrimary} />
                            <Text style={[styles.modeBtnText, mode === 'resize' && styles.modeBtnTextActive]}>Resize</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.modeBtn, mode === 'anchor' && styles.modeBtnActive]}
                            onPress={() => setMode('anchor')}
                        >
                            <MoveDiagonal2 size={14} color={mode === 'anchor' ? '#0d1320' : ui.colors.textPrimary} />
                            <Text style={[styles.modeBtnText, mode === 'anchor' && styles.modeBtnTextActive]}>Anchor Select</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.subtitle}>
                        {mode === 'resize'
                            ? 'Resize mode: drag the bottom-right handle. Tap L(X)/B(Y) labels to type exact values.'
                            : 'Anchor Select: drag anchor bubble near a vertex to swap labels.'}
                    </Text>

                    <View style={styles.canvasWrap}>
                        <GestureDetector gesture={panGesture}>
                            <View style={[styles.canvasContainer, { width: canvasSize, height: canvasSize }]}>
                                <Canvas style={styles.canvas}>
                                    <RoundedRect x={0} y={0} width={canvasSize} height={canvasSize} r={16} color="#0d1626" />
                                    <RoundedRect
                                        x={roomRect.x}
                                        y={roomRect.y}
                                        width={roomRect.width}
                                        height={roomRect.height}
                                        r={10}
                                        color="rgba(63, 108, 182, 0.2)"
                                    />

                                    <Line
                                        p1={{ x: roomRect.x, y: roomRect.y }}
                                        p2={{ x: roomRect.x + roomRect.width, y: roomRect.y }}
                                        color="#8bb6ff"
                                        strokeWidth={2}
                                    />
                                    <Line
                                        p1={{ x: roomRect.x + roomRect.width, y: roomRect.y }}
                                        p2={{ x: roomRect.x + roomRect.width, y: roomRect.y + roomRect.height }}
                                        color="#8bb6ff"
                                        strokeWidth={2}
                                    />
                                    <Line
                                        p1={{ x: roomRect.x + roomRect.width, y: roomRect.y + roomRect.height }}
                                        p2={{ x: roomRect.x, y: roomRect.y + roomRect.height }}
                                        color="#8bb6ff"
                                        strokeWidth={2}
                                    />
                                    <Line
                                        p1={{ x: roomRect.x, y: roomRect.y + roomRect.height }}
                                        p2={{ x: roomRect.x, y: roomRect.y }}
                                        color="#8bb6ff"
                                        strokeWidth={2}
                                    />

                                    {VERTEX_ORDER.map((vertex) => {
                                        const pos = vertexScreenPosition(vertex);
                                        const highlight = hoverVertex === vertex && mode === 'anchor';
                                        return (
                                            <Circle
                                                key={`vertex-${vertex}`}
                                                cx={pos.x}
                                                cy={pos.y}
                                                r={highlight ? 8 : 6}
                                                color={highlight ? '#ffffff' : '#8cb6ff'}
                                            />
                                        );
                                    })}

                                    <Circle
                                        cx={roomRect.x + roomRect.width}
                                        cy={roomRect.y + roomRect.height}
                                        r={mode === 'resize' ? 11 : 8}
                                        color={mode === 'resize' ? '#ffffff' : '#94a3b8'}
                                    />
                                </Canvas>

                                {renderAnchors.map(({ vertex, anchorId }) => {
                                    if (draggingAnchorId === anchorId) return null;
                                    const pos = vertexScreenPosition(vertex);
                                    return (
                                        <Animated.View
                                            key={`anchor-chip-${anchorId}`}
                                            layout={LinearTransition.duration(160)}
                                            style={[
                                                styles.anchorChip,
                                                {
                                                    left: pos.x - ANCHOR_MARKER_SIZE / 2,
                                                    top: pos.y - ANCHOR_MARKER_SIZE / 2,
                                                },
                                            ]}
                                        >
                                            <Text style={styles.anchorChipText}>{anchorNumber(anchorId)}</Text>
                                        </Animated.View>
                                    );
                                })}

                                {draggingAnchorId ? (
                                    <Animated.View style={[styles.anchorChip, styles.draggingChip, draggingStyle]}>
                                        <Text style={styles.anchorChipText}>{anchorNumber(draggingAnchorId)}</Text>
                                    </Animated.View>
                                ) : null}

                                <View style={styles.zoomControls}>
                                    <TouchableOpacity
                                        style={[styles.zoomBtn, safeZoom <= MIN_ZOOM + 0.01 && styles.zoomBtnDisabled]}
                                        disabled={safeZoom <= MIN_ZOOM + 0.01}
                                        onPress={() => setZoom((prev) => clamp(prev - 0.18, MIN_ZOOM, maxZoom))}
                                    >
                                        <Text style={styles.zoomBtnText}>-</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.zoomBtn, safeZoom >= maxZoom - 0.01 && styles.zoomBtnDisabled]}
                                        disabled={safeZoom >= maxZoom - 0.01}
                                        onPress={() => setZoom((prev) => clamp(prev + 0.18, MIN_ZOOM, maxZoom))}
                                    >
                                        <Text style={styles.zoomBtnText}>+</Text>
                                    </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                    style={[styles.edgeLabel, { left: widthLabelX, top: widthLabelY }]}
                                    onPress={() => openDimensionEditor('width')}
                                >
                                    <Text style={styles.edgeLabelText}>{`L(X) ${room.width.toFixed(2)}m`}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.edgeLabel, { left: heightLabelX, top: heightLabelY }]}
                                    onPress={() => openDimensionEditor('height')}
                                >
                                    <Text style={styles.edgeLabelText}>{`B(Y) ${room.height.toFixed(2)}m`}</Text>
                                </TouchableOpacity>
                            </View>
                        </GestureDetector>
                    </View>

                    <Text style={styles.metrics}>{`Room: L(X) ${room.width.toFixed(2)}m x B(Y) ${room.height.toFixed(2)}m`}</Text>

                    <View style={styles.actionsRow}>
                        <TouchableOpacity style={styles.secondaryBtn} onPress={resetToDefault}>
                            <RotateCcw size={14} color={ui.colors.textPrimary} />
                            <Text style={styles.secondaryBtnText}>Reset</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.primaryBtn} onPress={applyAndClose}>
                            <Check size={14} color="#0d1320" />
                            <Text style={styles.primaryBtnText}>Apply</Text>
                        </TouchableOpacity>
                    </View>

                    {editingField ? (
                        <View style={styles.dimensionOverlay}>
                            <TouchableOpacity
                                style={styles.dimensionOverlayScrim}
                                activeOpacity={1}
                                onPress={() => {
                                    Keyboard.dismiss();
                                    setEditingField(null);
                                }}
                            />
                            <KeyboardAvoidingView
                                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                                style={styles.dimensionOverlayContent}
                            >
                                <View style={styles.dimensionDialog}>
                                    <Text style={styles.dimensionEditorLabel}>{`Set ${editingField === 'width' ? 'Length (X)' : 'Breadth (Y)'} (m)`}</Text>
                                    <TextInput
                                        style={styles.dimensionInput}
                                        value={dimensionInput}
                                        onChangeText={setDimensionInput}
                                        keyboardType="numeric"
                                        placeholder="meters"
                                        placeholderTextColor={ui.colors.textMuted}
                                        autoFocus
                                        returnKeyType="done"
                                        onSubmitEditing={applyDimensionEdit}
                                    />
                                    <View style={styles.dimensionActions}>
                                        <TouchableOpacity
                                            style={styles.dimensionCancel}
                                            onPress={() => {
                                                Keyboard.dismiss();
                                                setEditingField(null);
                                            }}
                                        >
                                            <Text style={styles.dimensionCancelText}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.dimensionApply} onPress={applyDimensionEdit}>
                                            <Text style={styles.dimensionApplyText}>Apply</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </KeyboardAvoidingView>
                        </View>
                    ) : null}
                </View>
                </View>
            </GestureHandlerRootView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalRoot: {
        flex: 1,
    },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(2,6,23,0.68)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: ui.colors.panel,
        borderTopLeftRadius: ui.radius.lg,
        borderTopRightRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        paddingHorizontal: ui.spacing.lg,
        paddingTop: ui.spacing.md,
        paddingBottom: ui.spacing.lg,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    title: {
        color: ui.colors.textPrimary,
        fontSize: 18,
        fontWeight: '800',
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: ui.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: ui.colors.panelElevated,
    },
    modeRow: {
        marginTop: 12,
        flexDirection: 'row',
        gap: 8,
    },
    modeBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panelElevated,
        borderRadius: ui.radius.pill,
        paddingVertical: 10,
    },
    modeBtnActive: {
        borderColor: '#bfdbfe',
        backgroundColor: '#dbeafe',
    },
    modeBtnText: {
        color: ui.colors.textPrimary,
        fontWeight: '700',
        fontSize: 13,
    },
    modeBtnTextActive: {
        color: '#0d1320',
    },
    subtitle: {
        color: ui.colors.textSecondary,
        marginTop: 8,
        marginBottom: 10,
        fontSize: 12,
    },
    canvasWrap: {
        alignItems: 'center',
    },
    canvasContainer: {
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#2b3f60',
        backgroundColor: '#0d1626',
    },
    canvas: {
        ...StyleSheet.absoluteFillObject,
    },
    anchorChip: {
        position: 'absolute',
        width: ANCHOR_MARKER_SIZE,
        height: ANCHOR_MARKER_SIZE,
        borderRadius: 10,
        backgroundColor: '#67a5ff',
        borderWidth: 1.5,
        borderColor: '#ecf3ff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    draggingChip: {
        zIndex: 20,
        backgroundColor: '#9dc3ff',
    },
    anchorChipText: {
        color: '#0b1423',
        fontSize: 12,
        fontWeight: '800',
    },
    zoomControls: {
        position: 'absolute',
        right: 8,
        top: 8,
        gap: 6,
    },
    zoomBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: '#e7f0ff',
        borderWidth: 1,
        borderColor: '#b8cff5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    zoomBtnDisabled: {
        opacity: 0.5,
    },
    zoomBtnText: {
        color: '#10223f',
        fontSize: 20,
        fontWeight: '800',
        marginTop: -1,
    },
    edgeLabel: {
        position: 'absolute',
        borderRadius: ui.radius.pill,
        backgroundColor: 'rgba(7, 19, 39, 0.9)',
        borderWidth: 1,
        borderColor: '#87aff5',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    edgeLabelText: {
        color: '#e6efff',
        fontSize: 11,
        fontWeight: '700',
    },
    metrics: {
        marginTop: 10,
        color: ui.colors.textPrimary,
        fontWeight: '700',
        textAlign: 'center',
    },
    dimensionOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-start',
    },
    dimensionOverlayScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(2, 6, 23, 0.45)',
    },
    dimensionOverlayContent: {
        paddingTop: 92,
        paddingHorizontal: ui.spacing.lg,
    },
    dimensionDialog: {
        borderRadius: ui.radius.md,
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panel,
        padding: 12,
    },
    dimensionEditorLabel: {
        color: ui.colors.textSecondary,
        fontSize: 12,
        marginBottom: 6,
    },
    dimensionInput: {
        borderWidth: 1,
        borderColor: ui.colors.border,
        borderRadius: ui.radius.md,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: ui.colors.textPrimary,
        backgroundColor: ui.colors.panel,
    },
    dimensionActions: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    dimensionCancel: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: ui.radius.pill,
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panel,
    },
    dimensionCancelText: {
        color: ui.colors.textSecondary,
        fontWeight: '700',
    },
    dimensionApply: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: ui.radius.pill,
        backgroundColor: '#dbeafe',
        borderWidth: 1,
        borderColor: '#bfd8ff',
    },
    dimensionApplyText: {
        color: '#0d1320',
        fontWeight: '800',
    },
    actionsRow: {
        marginTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
    },
    secondaryBtn: {
        flex: 1,
        borderRadius: ui.radius.pill,
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panelElevated,
        paddingVertical: 11,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    secondaryBtnText: {
        color: ui.colors.textPrimary,
        fontWeight: '700',
    },
    primaryBtn: {
        flex: 1,
        borderRadius: ui.radius.pill,
        backgroundColor: '#f4f8ff',
        borderWidth: 1,
        borderColor: '#d4e3ff',
        paddingVertical: 11,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    primaryBtnText: {
        color: '#0d1320',
        fontWeight: '800',
    },
});
