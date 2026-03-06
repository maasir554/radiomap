import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Switch, Alert, Platform, ScrollView, BackHandler } from 'react-native';
import { useStore } from '../store/useStore';
import { bleService } from '../services/BleService';
import { TipsButton } from '../components/TipsButton';
import { TopNav } from '../components/TopNav';
import { ui } from '../theme/ui';

export const AnchorModeScreen: React.FC = () => {
    const { anchorConfig, setAnchorConfig, isAdvertising, setRole } = useStore();
    const [id, setId] = useState(anchorConfig.id);
    const [x, setX] = useState(anchorConfig.x.toString());
    const [y, setY] = useState(anchorConfig.y.toString());
    const [a, setA] = useState(anchorConfig.A.toString());

    const parseNumber = (value: string): number | null => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        return parsed;
    };

    const handleToggle = async (value: boolean) => {
        try {
            if (Platform.OS !== 'android') {
                Alert.alert('Unsupported', 'Anchor mode currently supports Android only.');
                return;
            }

            if (value) {
                const parsedX = parseNumber(x);
                const parsedY = parseNumber(y);
                const parsedA = parseNumber(a);
                if (!id.startsWith('BLUEPOINT-')) {
                    Alert.alert('Invalid anchor ID', 'Anchor ID must start with BLUEPOINT-.');
                    return;
                }
                if (parsedX === null || parsedY === null || parsedA === null || parsedX < 0 || parsedY < 0) {
                    Alert.alert('Invalid input', 'X and Y must be zero or greater, and A must be numeric.');
                    return;
                }
                setAnchorConfig({ id, x: parsedX, y: parsedY, A: parsedA });
                await bleService.startAdvertising(id);
            } else {
                await bleService.stopAdvertising();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update advertising state.';
            Alert.alert('BLE error', message);
        }
    };

    const goBack = async () => {
        try {
            if (isAdvertising) {
                await bleService.stopAdvertising();
            }
        } catch {
            // No-op on back
        }
        setRole('none');
    };

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            void goBack();
            return true;
        });
        return () => subscription.remove();
    }, [isAdvertising, setRole]);

    return (
        <View style={styles.container}>
            <View style={styles.fixedHeader}>
                <TopNav title="Anchor Mode" subtitle="Anchor Device" onBack={goBack} right={<TipsButton />} />
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
            >
                <View style={styles.form}>
                    <Text style={styles.inputLabel}>Anchor ID (BLUEPOINT-*)</Text>
                    <TextInput
                        style={styles.input}
                        value={id}
                        onChangeText={setId}
                        placeholder="BLUEPOINT-0X"
                        placeholderTextColor={ui.colors.textMuted}
                    />

                    <View style={styles.grid}>
                        <View style={styles.gridItem}>
                            <Text style={styles.inputLabel}>X Position (m)</Text>
                            <TextInput
                                style={styles.input}
                                value={x}
                                onChangeText={setX}
                                keyboardType="numeric"
                                placeholderTextColor={ui.colors.textMuted}
                            />
                        </View>
                        <View style={styles.gridItem}>
                            <Text style={styles.inputLabel}>Y Position (m)</Text>
                            <TextInput
                                style={styles.input}
                                value={y}
                                onChangeText={setY}
                                keyboardType="numeric"
                                placeholderTextColor={ui.colors.textMuted}
                            />
                        </View>
                    </View>

                    <Text style={styles.inputLabel}>Calibration A (RSSI @ 1m)</Text>
                    <TextInput
                        style={styles.input}
                        value={a}
                        onChangeText={setA}
                        keyboardType="numeric"
                        placeholderTextColor={ui.colors.textMuted}
                    />
                </View>

                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <Text style={styles.backButtonText}>Exit Anchor Mode</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    activeOpacity={0.9}
                    style={[styles.card, isAdvertising && styles.cardActive]}
                    onPress={() => {
                        void handleToggle(!isAdvertising);
                    }}
                >
                    <View style={styles.row}>
                        <Text style={styles.label}>Broadcasting</Text>
                        <Switch value={isAdvertising} onValueChange={handleToggle} />
                    </View>
                    <Text style={[styles.status, isAdvertising && styles.statusActive]}>
                        {isAdvertising ? `Broadcasting as ${id}` : 'Tap anywhere on this box to start broadcasting'}
                    </Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ui.colors.bg },
    scroll: { flex: 1 },
    content: { paddingHorizontal: ui.spacing.lg, paddingBottom: ui.spacing.xl },
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
        backgroundColor: ui.colors.panel,
        padding: ui.spacing.lg,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        marginTop: ui.spacing.lg,
    },
    cardActive: {
        backgroundColor: '#1f6ed4',
        borderColor: '#82b4ff',
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    label: { fontSize: 17, fontWeight: '700', color: ui.colors.textPrimary },
    status: { marginTop: 10, color: ui.colors.textSecondary, fontSize: 14 },
    statusActive: { color: '#eaf3ff' },
    form: {
        backgroundColor: ui.colors.panel,
        padding: ui.spacing.lg,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
    },
    inputLabel: { fontSize: 13, color: ui.colors.textSecondary, marginBottom: 6 },
    input: {
        borderWidth: 1,
        borderColor: ui.colors.border,
        borderRadius: ui.radius.md,
        padding: 12,
        marginBottom: 15,
        color: ui.colors.textPrimary,
        backgroundColor: ui.colors.panelElevated,
    },
    grid: { flexDirection: 'row', gap: 12 },
    gridItem: { flex: 1 },
    backButton: {
        marginTop: ui.spacing.lg,
        alignSelf: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: ui.radius.pill,
        borderWidth: 1,
        borderColor: '#6b3140',
        backgroundColor: '#3c1d2a',
    },
    backButtonText: { color: '#ffd0dc', fontSize: 14, fontWeight: '700' },
});
