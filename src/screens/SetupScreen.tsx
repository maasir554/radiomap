import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
    BackHandler,
    Platform,
    ActivityIndicator,
    Modal,
} from 'react-native';
import { Bug, CheckCircle2 } from 'lucide-react-native';
import { REFERENCE_ANCHOR_ID, useStore } from '../store/useStore';
import { bleService, type BleDebugSnapshot } from '../services/BleService';
import { TipsButton } from '../components/TipsButton';
import { TopNav } from '../components/TopNav';
import { ui } from '../theme/ui';
import { VisualSetupModal } from '../components/VisualSetupModal';

export const SetupScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    const [step, setStep] = useState(1);
    const {
        roomSize,
        setRoomSize,
        phoneHeightRelative,
        setPhoneHeightRelative,
        anchors,
        setAnchors,
        setAnchorPeripheral,
        isScanning,
        setRole,
    } = useStore();

    const [width, setWidth] = useState(roomSize.width.toString());
    const [height, setHeight] = useState(roomSize.height.toString());
    const [phoneHeight, setPhoneHeight] = useState(phoneHeightRelative.toString());
    const [bleDebug, setBleDebug] = useState<BleDebugSnapshot>(() => bleService.getDebugSnapshot());
    const [calibratingAnchorId, setCalibratingAnchorId] = useState<string | null>(null);
    const [calibratedAValues, setCalibratedAValues] = useState<Record<string, number>>({});
    const [isDebugModalVisible, setIsDebugModalVisible] = useState(false);
    const [isVisualSetupVisible, setIsVisualSetupVisible] = useState(false);
    const [hasCustomAnchorLayout, setHasCustomAnchorLayout] = useState(false);
    const [anchorHeights, setAnchorHeights] = useState<Record<string, string>>(
        anchors.reduce((acc, anchor) => ({ ...acc, [anchor.id]: anchor.h.toString() }), {})
    );

    const parsePositiveNumber = (value: string): number | null => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return parsed;
    };

    const parseSignedNumber = (value: string): number | null => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        return parsed;
    };

    const applyDefaultCornerAnchors = (widthMeters: number, heightMeters: number) => {
        const cornerById: Record<string, { x: number; y: number }> = {
            [REFERENCE_ANCHOR_ID]: { x: 0, y: 0 },
            'BLUEPOINT-02': { x: widthMeters, y: 0 },
            'BLUEPOINT-03': { x: 0, y: heightMeters },
            'BLUEPOINT-04': { x: widthMeters, y: heightMeters },
        };

        setAnchors(
            anchors.map((anchor) => {
                const corner = cornerById[anchor.id];
                return corner ? { ...anchor, ...corner } : anchor;
            })
        );
    };

    const handleNext = () => {
        if (step === 1) {
            const parsedWidth = parsePositiveNumber(width);
            const parsedHeight = parsePositiveNumber(height);
            const parsedPhoneHeight = parseSignedNumber(phoneHeight);
            if (parsedWidth === null || parsedHeight === null || parsedPhoneHeight === null) {
                Alert.alert('Invalid input', 'Length (X) and breadth (Y) must be positive values. Phone height must be numeric.');
                return;
            }
            setRoomSize(parsedWidth, parsedHeight);
            setPhoneHeightRelative(parsedPhoneHeight);
            if (!hasCustomAnchorLayout) {
                applyDefaultCornerAnchors(parsedWidth, parsedHeight);
            }
            setStep(2);
        } else if (step === 2) {
            const updatedAnchors = anchors.map((anchor) => {
                if (anchor.id === REFERENCE_ANCHOR_ID) {
                    return { ...anchor, h: 0 };
                }

                const parsed = Number(anchorHeights[anchor.id]);
                if (!Number.isFinite(parsed)) {
                    return null;
                }
                return { ...anchor, h: parsed };
            });

            if (updatedAnchors.some((anchor) => anchor === null)) {
                Alert.alert('Invalid input', 'Anchor relative heights must be numeric values.');
                return;
            }

            setAnchors(updatedAnchors.filter((anchor): anchor is typeof anchors[number] => anchor !== null));
            setStep(3);
        } else {
            onComplete();
        }
    };

    const handleBack = () => {
        if (step > 1) {
            setStep((prev) => prev - 1);
            return;
        }
        setRole('none');
    };

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (isDebugModalVisible) {
                setIsDebugModalVisible(false);
                return true;
            }
            handleBack();
            return true;
        });
        return () => subscription.remove();
    }, [step, isDebugModalVisible]);

    useEffect(() => {
        if (step !== 3) return;
        const syncDebug = () => setBleDebug(bleService.getDebugSnapshot());
        syncDebug();
        const timer = setInterval(syncDebug, 800);
        return () => clearInterval(timer);
    }, [step, isScanning]);

    const calibrateAnchor = async (id: string) => {
        if (!isScanning) {
            Alert.alert('Calibration needs scan', 'Start Calibration Scan first.');
            return;
        }
        if (calibratingAnchorId) return;

        setCalibratingAnchorId(id);
        const sampleWindowMs = 2500;
        const sampleIntervalMs = 200;
        const samples: number[] = [];
        let sampleCount = 0;
        const maxSamples = Math.ceil(sampleWindowMs / sampleIntervalMs);

        await new Promise<void>((resolve) => {
            const timer = setInterval(() => {
                sampleCount += 1;
                const latest = useStore.getState().anchors.find((a) => a.id === id)?.currentRssi;
                if (typeof latest === 'number' && Number.isFinite(latest)) {
                    samples.push(latest);
                }

                if (sampleCount >= maxSamples) {
                    clearInterval(timer);
                    resolve();
                }
            }, sampleIntervalMs);
        });

        setCalibratingAnchorId(null);

        if (samples.length < 3) {
            Alert.alert('Calibration failed', `No stable signal from ${id}. Keep it broadcasting and try again.`);
            return;
        }

        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        const newAnchors = useStore.getState().anchors.map((a) =>
            a.id === id ? { ...a, A: average } : a
        );
        setAnchors(newAnchors);
        setCalibratedAValues((prev) => ({ ...prev, [id]: average }));
        Alert.alert('Calibration', `Calibrated ${id} with A = ${average.toFixed(1)} dBm (${samples.length} samples / 2.5s).`);
    };

    const clearPeripheralBinding = (peripheralId: string) => {
        anchors.forEach((anchor) => {
            if (anchor.peripheralId?.toUpperCase() === peripheralId.toUpperCase()) {
                setAnchorPeripheral(anchor.id, undefined);
            }
        });
    };

    const bindPeripheralToAnchor = (peripheralId: string) => {
        Alert.alert(
            'Assign Anchor',
            `Bind ${peripheralId} to which BLUEPOINT?`,
            [
                ...anchors.map((anchor) => ({
                    text: anchor.id,
                    onPress: () => setAnchorPeripheral(anchor.id, peripheralId),
                })),
                {
                    text: 'Clear Binding',
                    onPress: () => clearPeripheralBinding(peripheralId),
                    style: 'destructive' as const,
                },
                { text: 'Cancel', style: 'cancel' as const },
            ]
        );
    };

    const handleCalibrationScanToggle = async () => {
        try {
            if (isScanning) {
                await bleService.stopScanning();
            } else {
                await bleService.startScanning();
            }
            setBleDebug(bleService.getDebugSnapshot());
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update scan state.';
            Alert.alert('BLE error', message);
            setBleDebug(bleService.getDebugSnapshot());
        }
    };

    const subtitle = step === 1 ? 'Step 1: Environment Mapping' : step === 2 ? 'Step 2: Anchor Deployment' : 'Step 3: Calibration';

    return (
        <View style={styles.container}>
            <View style={styles.fixedHeader}>
                <TopNav title="Mobile Setup" subtitle={subtitle} onBack={handleBack} right={<TipsButton />} />
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.contentContainer}
            >
                {step === 1 && (
                    <View style={styles.card}>
                        <Text style={styles.label}>Room Length (X-axis, m)</Text>
                        <TextInput
                            style={styles.input}
                            value={width}
                            onChangeText={setWidth}
                            keyboardType="numeric"
                            placeholderTextColor={ui.colors.textMuted}
                        />
                        <Text style={styles.label}>Room Breadth (Y-axis, m)</Text>
                        <TextInput
                            style={styles.input}
                            value={height}
                            onChangeText={setHeight}
                            keyboardType="numeric"
                            placeholderTextColor={ui.colors.textMuted}
                        />
                        <Text style={styles.helperTextNormal}>Length maps to X-axis and breadth maps to Y-axis in tracking/map coordinates.</Text>
                        <Text style={styles.label}>{`Test Phone Height Relative to ${REFERENCE_ANCHOR_ID} (m)`}</Text>
                        <TextInput
                            style={styles.input}
                            value={phoneHeight}
                            onChangeText={setPhoneHeight}
                            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                            placeholderTextColor={ui.colors.textMuted}
                        />
                        <Text style={styles.helperText}>
                            Enter relative height from anchor {REFERENCE_ANCHOR_ID}. Use positive if phone is above, negative if below, 0 if same level.
                        </Text>
                        <TouchableOpacity style={styles.visualSetupButton} onPress={() => setIsVisualSetupVisible(true)}>
                            <Text style={styles.visualSetupButtonText}>Visual Setup</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {step === 2 && (
                    <View style={styles.card}>
                        <Text style={styles.description}>
                            Verify anchor positions and set each anchor height relative to {REFERENCE_ANCHOR_ID} (m). {REFERENCE_ANCHOR_ID} is fixed at 0.
                        </Text>
                        <Text style={styles.helperTextNormal}>
                            Example: if an anchor is 0.35m above {REFERENCE_ANCHOR_ID}, enter 0.35. If below, enter a negative value.
                        </Text>
                        {anchors.map(a => (
                            <View key={a.id} style={styles.anchorRow}>
                                <View style={styles.anchorMeta}>
                                    <Text style={styles.anchorText}>{a.id}</Text>
                                    <Text style={styles.anchorCoords}>{`(${a.x}, ${a.y})`}</Text>
                                </View>
                                <TextInput
                                    style={[styles.heightInput, a.id === REFERENCE_ANCHOR_ID && styles.heightInputDisabled]}
                                    value={a.id === REFERENCE_ANCHOR_ID ? '0' : (anchorHeights[a.id] ?? '0')}
                                    editable={a.id !== REFERENCE_ANCHOR_ID}
                                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                                    onChangeText={(value) => setAnchorHeights((prev) => ({ ...prev, [a.id]: value }))}
                                    placeholderTextColor={ui.colors.textMuted}
                                />
                            </View>
                        ))}
                    </View>
                )}

                {step === 3 && (
                    <View style={styles.card}>
                        <Text style={styles.description}>Stand 1m away from each anchor, then calibrate.</Text>
                        {anchors.map(a => (
                            <TouchableOpacity
                                key={a.id}
                                style={[styles.calibrateButton, calibratingAnchorId && styles.calibrateButtonDisabled]}
                                disabled={!!calibratingAnchorId}
                                onPress={() => calibrateAnchor(a.id)}
                            >
                                <View style={styles.calibrateHeader}>
                                    {calibratingAnchorId === a.id ? (
                                        <View style={styles.calibratingHeader}>
                                            <ActivityIndicator size="small" color="#eaf3ff" />
                                            <Text style={styles.actionText}>Calibrating {a.id}...</Text>
                                        </View>
                                    ) : (
                                        <Text style={styles.actionText}>Calibrate {a.id}</Text>
                                    )}
                                    {typeof calibratedAValues[a.id] === 'number' ? (
                                        <View style={styles.calibratedChip}>
                                            <CheckCircle2 size={14} color="#b8f7d4" />
                                            <Text style={styles.calibratedChipText}>{`A=${calibratedAValues[a.id].toFixed(1)}`}</Text>
                                        </View>
                                    ) : null}
                                </View>
                                <Text style={styles.metaText}>Current RSSI: {a.currentRssi || 'N/A'} dBm</Text>
                                <Text style={styles.metaTextSecondary}>
                                    {`Bound device: ${a.peripheralId ?? 'Auto-detect from broadcast payload'}`}
                                </Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            style={[styles.scanButton, isScanning && styles.scanButtonStop]}
                            onPress={handleCalibrationScanToggle}
                        >
                            <Text style={styles.actionText}>{isScanning ? 'Stop Calibration Scan' : 'Start Calibration Scan'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.debugButton} onPress={() => setIsDebugModalVisible(true)}>
                            <Bug size={16} color="#0d1320" />
                            <Text style={styles.debugButtonText}>Open BLE Debug</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            <View style={styles.bottomBar}>
                <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
                    <Text style={styles.nextButtonText}>{step === 3 ? 'Finish Setup' : 'Continue'}</Text>
                </TouchableOpacity>
            </View>

            <Modal
                transparent
                animationType="slide"
                visible={isDebugModalVisible}
                onRequestClose={() => setIsDebugModalVisible(false)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>BLE Debug</Text>
                            <TouchableOpacity style={styles.modalClose} onPress={() => setIsDebugModalVisible(false)}>
                                <Text style={styles.modalCloseText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
                            <Text style={styles.debugMeta}>
                                {`Scan: ${bleDebug.isScanning ? 'ON' : 'OFF'} | Mode: ${bleDebug.scanMode}${bleDebug.fallbackScanApplied ? ' (fallback)' : ''}`}
                            </Text>
                            <Text style={styles.debugMeta}>
                                {`Events callback/poll: ${bleDebug.callbackEvents}/${bleDebug.pollEvents} | Parsed anchors: ${bleDebug.parsedAnchorsSinceScanStart}`}
                            </Text>
                            <Text style={styles.debugMeta}>
                                {`Unique peripherals seen: ${bleDebug.visiblePeripheralCount}`}
                            </Text>
                            {bleDebug.lastScanError ? (
                                <Text style={styles.debugError}>{`Last error: ${bleDebug.lastScanError}`}</Text>
                            ) : null}
                            {bleDebug.peripherals.length === 0 ? (
                                <Text style={styles.debugHint}>
                                    No BLE peripherals discovered yet. Keep Bluetooth and location services ON on this phone and keep anchors advertising.
                                </Text>
                            ) : (
                                bleDebug.peripherals.map((peripheral) => (
                                    <TouchableOpacity
                                        key={peripheral.key}
                                        style={styles.debugRow}
                                        activeOpacity={0.75}
                                        onPress={() => {
                                            if (!peripheral.peripheralId) return;
                                            bindPeripheralToAnchor(peripheral.peripheralId);
                                        }}
                                    >
                                        <Text style={styles.debugName}>
                                            {peripheral.parsedAnchorId ?? peripheral.name ?? peripheral.localName ?? peripheral.peripheralId ?? 'Unknown'}
                                        </Text>
                                        <Text style={styles.debugValue}>
                                            {`${peripheral.rssi ?? 'N/A'} dBm`}
                                        </Text>
                                        <Text style={styles.debugSub}>
                                            {`src:${peripheral.source} ${peripheral.peripheralId ? `| id:${peripheral.peripheralId}` : ''}`}
                                        </Text>
                                        <Text style={styles.debugTapHint}>
                                            {peripheral.peripheralId ? 'Tap to bind this device to an anchor' : ''}
                                        </Text>
                                    </TouchableOpacity>
                                ))
                            )}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            <VisualSetupModal
                visible={isVisualSetupVisible}
                initialWidth={Number(width) || roomSize.width}
                initialHeight={Number(height) || roomSize.height}
                anchors={anchors.map((a) => ({ id: a.id, x: a.x, y: a.y }))}
                onClose={() => setIsVisualSetupVisible(false)}
                onSave={({ width: nextWidth, height: nextHeight, anchors: nextAnchors }) => {
                    setWidth(String(nextWidth));
                    setHeight(String(nextHeight));
                    setRoomSize(nextWidth, nextHeight);
                    const mapped = anchors.map((a) => {
                        const updated = nextAnchors.find((na) => na.id === a.id);
                        return updated ? { ...a, x: updated.x, y: updated.y } : a;
                    });
                    setAnchors(mapped);
                    setHasCustomAnchorLayout(true);
                }}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ui.colors.bg },
    scroll: { flex: 1 },
    contentContainer: { paddingHorizontal: ui.spacing.lg, paddingBottom: 128 },
    fixedHeader: {
        backgroundColor: ui.colors.bg,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 12,
        elevation: 14,
        zIndex: 10,
    },
    card: {
        marginTop: ui.spacing.md,
        marginBottom: ui.spacing.md,
        backgroundColor: ui.colors.panel,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        padding: ui.spacing.lg,
    },
    label: {
        fontSize: 14,
        color: ui.colors.textSecondary,
        marginBottom: ui.spacing.xs,
    },
    description: {
        fontSize: 14,
        color: ui.colors.textSecondary,
        marginBottom: ui.spacing.md,
        lineHeight: 20,
    },
    helperText: {
        color: ui.colors.textMuted,
        fontSize: 12,
        lineHeight: 18,
        marginTop: -6,
    },
    visualSetupButton: {
        marginTop: ui.spacing.md,
        borderRadius: ui.radius.pill,
        backgroundColor: '#dbeafe',
        borderWidth: 1,
        borderColor: '#bfd8ff',
        paddingVertical: 12,
        alignItems: 'center',
    },
    visualSetupButtonText: {
        color: '#0d1320',
        fontWeight: '800',
        fontSize: 14,
    },
    helperTextNormal: {
        color: ui.colors.textMuted,
        fontSize: 12,
        lineHeight: 18,
        marginBottom: ui.spacing.xs,
    },
    input: {
        borderWidth: 1,
        borderColor: ui.colors.border,
        borderRadius: ui.radius.md,
        padding: 12,
        marginBottom: ui.spacing.md,
        color: ui.colors.textPrimary,
        backgroundColor: ui.colors.panelElevated,
    },
    anchorRow: {
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: ui.colors.border,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
    },
    anchorMeta: {
        flex: 1,
    },
    anchorText: {
        color: ui.colors.textPrimary,
        fontSize: 15,
        fontWeight: '700',
    },
    anchorCoords: {
        color: ui.colors.textSecondary,
        fontSize: 14,
    },
    heightInput: {
        width: 90,
        borderWidth: 1,
        borderColor: ui.colors.border,
        borderRadius: ui.radius.md,
        paddingVertical: 8,
        paddingHorizontal: 10,
        color: ui.colors.textPrimary,
        backgroundColor: ui.colors.panelElevated,
        textAlign: 'center',
    },
    heightInputDisabled: {
        opacity: 0.7,
    },
    calibrateButton: {
        backgroundColor: '#223a64',
        borderRadius: ui.radius.md,
        padding: 14,
        marginBottom: ui.spacing.sm,
        borderWidth: 1,
        borderColor: ui.colors.border,
    },
    calibrateButtonDisabled: {
        opacity: 0.7,
    },
    calibrateHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    calibratingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    calibratedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#0f4230',
        borderColor: '#2a7a59',
        borderWidth: 1,
        borderRadius: ui.radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    calibratedChipText: {
        color: '#b8f7d4',
        fontSize: 11,
        fontWeight: '700',
    },
    scanButton: {
        marginTop: 8,
        backgroundColor: '#145c54',
        borderRadius: ui.radius.md,
        padding: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: ui.colors.border,
    },
    scanButtonStop: {
        backgroundColor: '#6b2136',
    },
    actionText: {
        color: ui.colors.textPrimary,
        fontSize: 15,
        fontWeight: '700',
    },
    metaText: {
        color: '#c4d4ef',
        fontSize: 12,
        marginTop: 4,
    },
    metaTextSecondary: {
        color: ui.colors.textMuted,
        fontSize: 11,
        marginTop: 2,
    },
    debugButton: {
        marginTop: ui.spacing.sm,
        backgroundColor: '#dbeafe',
        borderRadius: ui.radius.pill,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        borderWidth: 1,
        borderColor: '#c6ddff',
    },
    debugButtonText: {
        color: '#0d1320',
        fontWeight: '800',
        fontSize: 14,
    },
    bottomBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: ui.spacing.lg,
        paddingTop: ui.spacing.sm,
        paddingBottom: ui.spacing.lg,
        backgroundColor: ui.colors.bg,
        borderTopWidth: 1,
        borderTopColor: ui.colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.24,
        shadowRadius: 10,
        elevation: 18,
    },
    nextButton: {
        backgroundColor: ui.colors.textPrimary,
        padding: 16,
        borderRadius: ui.radius.pill,
        alignItems: 'center',
        width: '100%',
    },
    nextButtonText: {
        color: '#0d1320',
        fontSize: 16,
        fontWeight: '800',
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(2,6,23,0.65)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        height: '82%',
        backgroundColor: ui.colors.panel,
        borderTopLeftRadius: ui.radius.lg,
        borderTopRightRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        paddingHorizontal: ui.spacing.lg,
        paddingTop: ui.spacing.md,
        paddingBottom: ui.spacing.md,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: ui.spacing.sm,
    },
    modalTitle: {
        color: ui.colors.textPrimary,
        fontSize: 17,
        fontWeight: '800',
    },
    modalClose: {
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panelElevated,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: ui.radius.pill,
    },
    modalCloseText: {
        color: ui.colors.textPrimary,
        fontWeight: '700',
    },
    modalScroll: {
        flex: 1,
        marginTop: ui.spacing.xs,
    },
    modalContent: {
        paddingBottom: ui.spacing.xl + ui.spacing.lg,
    },
    debugMeta: {
        color: ui.colors.textSecondary,
        fontSize: 12,
        marginBottom: 4,
    },
    debugError: {
        color: '#fca5a5',
        fontSize: 12,
        marginTop: 4,
        marginBottom: 4,
    },
    debugHint: {
        color: ui.colors.textMuted,
        fontSize: 12,
        marginTop: 6,
        lineHeight: 18,
    },
    debugRow: {
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#273244',
    },
    debugName: {
        color: ui.colors.textPrimary,
        fontSize: 12,
        fontWeight: '700',
    },
    debugValue: {
        color: '#a5b4fc',
        fontSize: 12,
        marginTop: 2,
    },
    debugSub: {
        color: ui.colors.textMuted,
        fontSize: 11,
        marginTop: 2,
    },
    debugTapHint: {
        color: '#8fa6c8',
        fontSize: 10,
        marginTop: 4,
    },
});
