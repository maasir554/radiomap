import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, BackHandler, Platform } from 'react-native';
import { REFERENCE_ANCHOR_ID, useStore } from '../store/useStore';
import { bleService } from '../services/BleService';
import { TipsButton } from '../components/TipsButton';
import { TopNav } from '../components/TopNav';
import { ui } from '../theme/ui';

export const SetupScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    const [step, setStep] = useState(1);
    const {
        roomSize,
        setRoomSize,
        phoneHeightRelative,
        setPhoneHeightRelative,
        anchors,
        setAnchors,
        isScanning,
        setRole
    } = useStore();

    const [width, setWidth] = useState(roomSize.width.toString());
    const [height, setHeight] = useState(roomSize.height.toString());
    const [phoneHeight, setPhoneHeight] = useState(phoneHeightRelative.toString());
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

    const handleNext = () => {
        if (step === 1) {
            const parsedWidth = parsePositiveNumber(width);
            const parsedHeight = parsePositiveNumber(height);
            const parsedPhoneHeight = parseSignedNumber(phoneHeight);
            if (parsedWidth === null || parsedHeight === null || parsedPhoneHeight === null) {
                Alert.alert('Invalid input', 'Width and height must be positive values. Phone height must be numeric.');
                return;
            }
            setRoomSize(parsedWidth, parsedHeight);
            setPhoneHeightRelative(parsedPhoneHeight);
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
            handleBack();
            return true;
        });
        return () => subscription.remove();
    }, [step]);

    const calibrateAnchor = async (id: string) => {
        const anchor = anchors.find(a => a.id === id);
        if (anchor && anchor.currentRssi !== undefined) {
            const newAnchors = anchors.map(a =>
                a.id === id ? { ...a, A: anchor.currentRssi! } : a
            );
            setAnchors(newAnchors);
            Alert.alert('Calibration', `Calibrated ${id} with A = ${anchor.currentRssi.toFixed(1)}`);
        } else {
            Alert.alert('Error', `No signal from ${id}. Ensure it's broadcasting.`);
        }
    };

    const handleCalibrationScanToggle = async () => {
        try {
            if (isScanning) {
                await bleService.stopScanning();
            } else {
                await bleService.startScanning();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update scan state.';
            Alert.alert('BLE error', message);
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
                        <Text style={styles.label}>Room Width (m)</Text>
                        <TextInput
                            style={styles.input}
                            value={width}
                            onChangeText={setWidth}
                            keyboardType="numeric"
                            placeholderTextColor={ui.colors.textMuted}
                        />
                        <Text style={styles.label}>Room Height (m)</Text>
                        <TextInput
                            style={styles.input}
                            value={height}
                            onChangeText={setHeight}
                            keyboardType="numeric"
                            placeholderTextColor={ui.colors.textMuted}
                        />
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
                    </View>
                )}

                {step === 2 && (
                    <View style={styles.card}>
                        <Text style={styles.description}>
                            Place anchors at room corners and set each anchor height relative to {REFERENCE_ANCHOR_ID} (m). {REFERENCE_ANCHOR_ID} is fixed at 0.
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
                                style={styles.calibrateButton}
                                onPress={() => calibrateAnchor(a.id)}
                            >
                                <Text style={styles.actionText}>Calibrate {a.id}</Text>
                                <Text style={styles.metaText}>Current RSSI: {a.currentRssi || 'N/A'} dBm</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            style={[styles.scanButton, isScanning && styles.scanButtonStop]}
                            onPress={handleCalibrationScanToggle}
                        >
                            <Text style={styles.actionText}>{isScanning ? 'Stop Calibration Scan' : 'Start Calibration Scan'}</Text>
                        </TouchableOpacity>
                    </View>
                )}

                <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
                    <Text style={styles.nextButtonText}>{step === 3 ? 'Finish Setup' : 'Continue'}</Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ui.colors.bg },
    scroll: { flex: 1 },
    contentContainer: { paddingHorizontal: ui.spacing.lg, paddingBottom: ui.spacing.xl },
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
    nextButton: {
        marginTop: ui.spacing.md,
        backgroundColor: ui.colors.textPrimary,
        padding: 16,
        borderRadius: ui.radius.pill,
        alignItems: 'center',
    },
    nextButtonText: {
        color: '#0d1320',
        fontSize: 16,
        fontWeight: '800',
    },
});
