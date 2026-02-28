import React, { useEffect, useState } from 'react';
import { Alert, BackHandler, Modal, Platform, Pressable, ScrollView, Share, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useStore } from '../store/useStore';
import { bleService } from '../services/BleService';
import { Map2D } from '../components/Map2D';
import { TipsButton } from '../components/TipsButton';
import { TopNav } from '../components/TopNav';
import { ui } from '../theme/ui';

export const TrackingScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { currentPosition, isScanning, anchors, isKalmanEnabled, setIsKalmanEnabled } = useStore();
    const [logs, setLogs] = useState<{ t: number, x: number, y: number }[]>([]);
    const [isMapFullscreen, setIsMapFullscreen] = useState(false);
    const modalTopInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

    useEffect(() => {
        if (currentPosition) {
            setLogs(prev => [...prev.slice(-99), {
                t: Date.now(),
                x: currentPosition.x,
                y: currentPosition.y
            }]);
        }
    }, [currentPosition]);

    const toggleScanning = async () => {
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

    const toggleKalman = () => {
        setIsKalmanEnabled(!isKalmanEnabled);
    };

    const exportData = async () => {
        if (logs.length === 0) {
            Alert.alert('No data', 'Collect some position points before exporting.');
            return;
        }
        const csv = 'timestamp,x,y\n' + logs.map(l => `${l.t},${l.x},${l.y}`).join('\n');
        try {
            await Share.share({
                title: 'radiomap-tracking.csv',
                message: csv,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to export CSV.';
            Alert.alert('Export error', message);
        }
    };

    const handleBack = async () => {
        try {
            if (isScanning) {
                await bleService.stopScanning();
            }
        } catch {
            // No-op; we still navigate back to keep UX responsive.
        }
        onBack();
    };

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (isMapFullscreen) {
                setIsMapFullscreen(false);
                return true;
            }
            void handleBack();
            return true;
        });
        return () => subscription.remove();
    }, [isMapFullscreen, isScanning, onBack]);

    return (
        <View style={styles.screen}>
            <View style={styles.fixedHeader}>
                <TopNav title="Live Tracking" subtitle="Test Device" onBack={handleBack} right={<TipsButton />} />
            </View>

            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                nestedScrollEnabled
            >
                <Pressable
                    style={({ pressed }) => [styles.filterCard, pressed && styles.filterCardPressed]}
                    onPress={toggleKalman}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isKalmanEnabled }}
                    accessibilityLabel="Kalman Filter Toggle"
                >
                    <View>
                        <Text style={styles.filterTitle}>Kalman Filter</Text>
                        <Text style={styles.filterSubtitle}>
                            {isKalmanEnabled ? 'ON: smoother tracking' : 'OFF: raw trilateration'}
                        </Text>
                    </View>
                    <Switch
                        value={isKalmanEnabled}
                        onValueChange={setIsKalmanEnabled}
                        pointerEvents="none"
                        trackColor={{ false: '#485261', true: '#2253a4' }}
                        thumbColor={isKalmanEnabled ? '#eef4ff' : '#e6e6e6'}
                    />
                </Pressable>

                <View style={styles.card}>
                    <Map2D onRequestFullscreen={() => setIsMapFullscreen(true)} />
                </View>

                <View style={styles.statsCard}>
                    <Text style={styles.sectionTitle}>Position</Text>
                    {currentPosition ? (
                        <View>
                            <Text style={styles.statValue}>X {currentPosition.x.toFixed(2)}m</Text>
                            <Text style={styles.statValue}>Y {currentPosition.y.toFixed(2)}m</Text>
                            <Text style={[
                                styles.residual,
                                { color: currentPosition.residualError > 2.0 ? ui.colors.danger : ui.colors.success }
                            ]}>
                                Confidence Error {currentPosition.residualError.toFixed(2)}m
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.placeholder}>Waiting for at least 3 anchors...</Text>
                    )}
                </View>

                <View style={styles.anchorsList}>
                    <Text style={styles.sectionTitle}>Visible Anchors</Text>
                    {anchors.map(a => (
                        <View key={a.id} style={styles.anchorItem}>
                            <Text style={styles.anchorLabel}>{a.id}</Text>
                            <Text style={styles.anchorValue}>{a.currentRssi || 'N/A'} dBm</Text>
                        </View>
                    ))}
                </View>

                <TouchableOpacity style={styles.exportButton} onPress={exportData}>
                    <Text style={styles.exportText}>Export CSV</Text>
                </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity
                style={[styles.scanFab, isScanning && styles.scanFabStop]}
                onPress={toggleScanning}
                accessibilityRole="button"
                accessibilityLabel={isScanning ? 'Stop Scan' : 'Start Scan'}
            >
                <Text style={styles.scanFabText}>{isScanning ? 'Stop Scan' : 'Start Scan'}</Text>
            </TouchableOpacity>

            <Modal
                visible={isMapFullscreen}
                animationType="slide"
                statusBarTranslucent={false}
                onRequestClose={() => setIsMapFullscreen(false)}
            >
                <View style={[styles.fullscreenContainer, { paddingTop: modalTopInset + ui.spacing.md }]}>
                    <View style={styles.fullscreenHeader}>
                        <View>
                            <Text style={styles.fullscreenTitle}>Map Explorer</Text>
                            <Text style={styles.fullscreenHint}>Pinch with two fingers to zoom</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={() => setIsMapFullscreen(false)}
                            accessibilityRole="button"
                            accessibilityLabel="Close full screen map"
                        >
                            <X size={16} color={ui.colors.textPrimary} strokeWidth={2.2} />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.fullscreenMapWrap}>
                        <Map2D fullscreen />
                    </View>
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: ui.colors.bg },
    container: { flex: 1, backgroundColor: ui.colors.bg },
    content: { paddingHorizontal: ui.spacing.lg, paddingBottom: ui.spacing.xl, flexGrow: 1 },
    fixedHeader: {
        backgroundColor: ui.colors.bg,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 12,
        elevation: 14,
        zIndex: 10,
    },
    scanFab: {
        position: 'absolute',
        right: ui.spacing.lg,
        bottom: ui.spacing.lg,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d8e1f0',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: ui.radius.pill,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 14,
        zIndex: 30,
    },
    scanFabStop: { backgroundColor: '#ffffff' },
    scanFabText: { color: '#0d1320', fontWeight: '900', fontSize: 13 },
    card: {
        backgroundColor: ui.colors.panel,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        padding: 8,
    },
    filterCard: {
        backgroundColor: ui.colors.panel,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        paddingHorizontal: ui.spacing.md,
        paddingVertical: ui.spacing.sm,
        marginBottom: ui.spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    filterCardPressed: {
        opacity: 0.86,
    },
    filterTitle: {
        color: ui.colors.textPrimary,
        fontSize: 14,
        fontWeight: '800',
    },
    filterSubtitle: {
        marginTop: 2,
        color: ui.colors.textMuted,
        fontSize: 12,
        fontWeight: '600',
    },
    statsCard: {
        backgroundColor: ui.colors.panel,
        padding: ui.spacing.lg,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        marginTop: ui.spacing.md,
    },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: ui.colors.textSecondary, marginBottom: 8 },
    statValue: { fontSize: 24, fontWeight: '900', color: ui.colors.textPrimary },
    residual: { fontSize: 13, marginTop: 6, fontWeight: '700' },
    placeholder: { color: ui.colors.textSecondary, fontStyle: 'italic' },
    anchorsList: {
        backgroundColor: ui.colors.panel,
        padding: ui.spacing.md,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        marginTop: ui.spacing.md,
    },
    anchorItem: {
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: ui.colors.border,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    anchorLabel: { color: ui.colors.textPrimary, fontSize: 14, fontWeight: '700' },
    anchorValue: { color: ui.colors.textSecondary, fontSize: 14 },
    exportButton: {
        marginTop: ui.spacing.lg,
        alignSelf: 'flex-start',
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: ui.radius.pill,
        backgroundColor: ui.colors.textPrimary,
    },
    exportText: { color: '#0e1625', fontWeight: '900', fontSize: 15 },
    fullscreenContainer: {
        flex: 1,
        backgroundColor: ui.colors.bg,
    },
    fullscreenHeader: {
        paddingHorizontal: ui.spacing.lg,
        paddingBottom: ui.spacing.sm,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: ui.colors.border,
    },
    fullscreenTitle: {
        color: ui.colors.textPrimary,
        fontSize: 18,
        fontWeight: '900',
    },
    fullscreenHint: {
        marginTop: 2,
        color: ui.colors.textMuted,
        fontSize: 12,
        fontWeight: '600',
    },
    closeButton: {
        borderRadius: ui.radius.pill,
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panel,
    },
    fullscreenMapWrap: {
        flex: 1,
        paddingHorizontal: ui.spacing.md,
        paddingTop: ui.spacing.md,
        paddingBottom: ui.spacing.lg,
    },
});
