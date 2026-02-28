import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    BackHandler,
    Modal,
    Platform,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { TipsButton } from '../components/TipsButton';
import { TopNav } from '../components/TopNav';
import { LocalTrailCell, LocalTrailMap } from '../components/LocalTrailMap';
import { localMotionService, MotionUpdate } from '../services/LocalMotionService';
import { useStore } from '../store/useStore';
import { ui } from '../theme/ui';

type TrailPoint = LocalTrailCell & {
    x: number;
    y: number;
    timestamp: number;
};

const CELL_SIZE_METERS = 0.1;

const toCellIndex = (meters: number): number => Math.round(meters / CELL_SIZE_METERS);

export const LocalModeScreen: React.FC = () => {
    const { setRole } = useStore();

    const [currentPosition, setCurrentPosition] = useState<{ x: number; y: number } | null>(null);
    const [headingRad, setHeadingRad] = useState(0);
    const [steps, setSteps] = useState(0);
    const [isTracking, setIsTracking] = useState(false);
    const [trail, setTrail] = useState<TrailPoint[]>([]);
    const [isMapFullscreen, setIsMapFullscreen] = useState(false);
    const [resetToken, setResetToken] = useState(0);
    const [lastError, setLastError] = useState<string | null>(null);

    const visitedCellSetRef = useRef<Set<string>>(new Set());
    const modalTopInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

    const handleMotionUpdate = useCallback((update: MotionUpdate) => {
        setCurrentPosition(update.position);
        setHeadingRad(update.headingRad);
        setSteps(update.steps);

        const ix = toCellIndex(update.position.x);
        const iy = toCellIndex(update.position.y);
        const key = `${ix}:${iy}`;

        if (visitedCellSetRef.current.has(key)) return;
        visitedCellSetRef.current.add(key);

        setTrail((prev) => [
            ...prev,
            {
                ix,
                iy,
                x: ix * CELL_SIZE_METERS,
                y: iy * CELL_SIZE_METERS,
                timestamp: update.timestamp,
            },
        ]);
    }, []);

    const startTracking = useCallback(async () => {
        setLastError(null);
        setIsTracking(true);

        await localMotionService.start(handleMotionUpdate, (message) => {
            setLastError(message);
            setIsTracking(false);
            Alert.alert(
                'Local sensors unavailable',
                `${message}\n\nInstall sensor module:\n npx expo install expo-sensors`
            );
        });
    }, [handleMotionUpdate]);

    const stopTracking = useCallback(() => {
        localMotionService.stop();
        setIsTracking(false);
    }, []);

    const resetTrailAndRestart = useCallback(async () => {
        stopTracking();
        visitedCellSetRef.current.clear();
        setTrail([]);
        setCurrentPosition({ x: 0, y: 0 });
        setHeadingRad(0);
        setSteps(0);
        setResetToken((value) => value + 1);
        await startTracking();
    }, [startTracking, stopTracking]);

    const exportTrail = async () => {
        if (trail.length === 0) {
            Alert.alert('No trail yet', 'Walk around a bit to record new coordinates.');
            return;
        }

        const csv = `timestamp_ms,x_m,y_m\n${trail
            .map((point) => `${point.timestamp},${point.x.toFixed(3)},${point.y.toFixed(3)}`)
            .join('\n')}`;

        try {
            await Share.share({
                title: 'local-mode-trail.csv',
                message: csv,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to export trail.';
            Alert.alert('Export error', message);
        }
    };

    const goBack = useCallback(() => {
        stopTracking();
        setRole('none');
    }, [setRole, stopTracking]);

    useEffect(() => {
        void startTracking();
        return () => {
            localMotionService.stop();
        };
    }, [startTracking]);

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (isMapFullscreen) {
                setIsMapFullscreen(false);
                return true;
            }
            goBack();
            return true;
        });
        return () => subscription.remove();
    }, [goBack, isMapFullscreen]);

    const visitedCells = useMemo(() => trail.map((point) => ({ ix: point.ix, iy: point.iy })), [trail]);
    const headingDeg = ((headingRad * 180) / Math.PI + 360) % 360;

    return (
        <View style={styles.screen}>
            <View style={styles.fixedHeader}>
                <TopNav title="Local Mode" subtitle="Sensor-only Tracking" onBack={goBack} right={<TipsButton />} />
            </View>

            <ScrollView style={styles.container} contentContainerStyle={styles.content} nestedScrollEnabled>
                <View style={styles.banner}>
                    <Text style={styles.bannerTitle}>Auto Tracking</Text>
                    <Text style={styles.bannerBody}>
                        Tracking starts on screen load. Origin is fixed at your first position (0,0). Only new 10cm coordinates are recorded.
                    </Text>
                </View>

                <View style={styles.card}>
                    <LocalTrailMap
                        currentPosition={currentPosition}
                        currentHeadingRad={headingRad}
                        visitedCells={visitedCells}
                        cellSizeMeters={CELL_SIZE_METERS}
                        onRequestFullscreen={() => setIsMapFullscreen(true)}
                        resetToken={resetToken}
                    />
                </View>

                <View style={styles.statsCard}>
                    <Text style={styles.sectionTitle}>Live Status</Text>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Tracking</Text>
                        <Text style={[styles.statValueCompact, { color: isTracking ? ui.colors.success : ui.colors.warning }]}>
                            {isTracking ? 'RUNNING' : 'STOPPED'}
                        </Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Steps</Text>
                        <Text style={styles.statValueCompact}>{steps}</Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Heading</Text>
                        <Text style={styles.statValueCompact}>{headingDeg.toFixed(0)} deg</Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Unique Coordinates</Text>
                        <Text style={styles.statValueCompact}>{trail.length}</Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Current X</Text>
                        <Text style={styles.statValueCompact}>{currentPosition ? `${currentPosition.x.toFixed(2)} m` : '0.00 m'}</Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Current Y</Text>
                        <Text style={styles.statValueCompact}>{currentPosition ? `${currentPosition.y.toFixed(2)} m` : '0.00 m'}</Text>
                    </View>
                </View>

                {lastError ? (
                    <View style={styles.errorCard}>
                        <Text style={styles.errorTitle}>Sensor Setup Needed</Text>
                        <Text style={styles.errorBody}>
                            {lastError}
                            {'\n'}Install with: `npx expo install expo-sensors`
                        </Text>
                    </View>
                ) : null}

                <View style={styles.actions}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={resetTrailAndRestart}>
                        <Text style={styles.secondaryButtonText}>Reset Trail</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.primaryButton} onPress={exportTrail}>
                        <Text style={styles.primaryButtonText}>Export Trail CSV</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <Modal
                visible={isMapFullscreen}
                animationType="slide"
                statusBarTranslucent={false}
                onRequestClose={() => setIsMapFullscreen(false)}
            >
                <View style={[styles.fullscreenContainer, { paddingTop: modalTopInset + ui.spacing.md }]}>
                    <View style={styles.fullscreenHeader}>
                        <View>
                            <Text style={styles.fullscreenTitle}>Local Trail Explorer</Text>
                            <Text style={styles.fullscreenHint}>Pinch to zoom, drag to inspect the path</Text>
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
                        <LocalTrailMap
                            currentPosition={currentPosition}
                            currentHeadingRad={headingRad}
                            visitedCells={visitedCells}
                            cellSizeMeters={CELL_SIZE_METERS}
                            fullscreen
                            resetToken={resetToken}
                        />
                    </View>
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: ui.colors.bg,
    },
    container: {
        flex: 1,
        backgroundColor: ui.colors.bg,
    },
    content: {
        paddingHorizontal: ui.spacing.lg,
        paddingBottom: ui.spacing.xl,
        flexGrow: 1,
    },
    fixedHeader: {
        backgroundColor: ui.colors.bg,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 12,
        elevation: 14,
        zIndex: 10,
    },
    banner: {
        backgroundColor: '#152033',
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        padding: ui.spacing.md,
        marginBottom: ui.spacing.sm,
    },
    bannerTitle: {
        color: ui.colors.textPrimary,
        fontSize: 14,
        fontWeight: '800',
    },
    bannerBody: {
        marginTop: 6,
        color: '#c5d2e8',
        fontSize: 13,
        lineHeight: 20,
    },
    card: {
        backgroundColor: ui.colors.panel,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        padding: 8,
    },
    statsCard: {
        backgroundColor: ui.colors.panel,
        padding: ui.spacing.lg,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        marginTop: ui.spacing.md,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: ui.colors.textSecondary,
        marginBottom: 8,
    },
    statRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 5,
    },
    statLabel: {
        color: ui.colors.textSecondary,
        fontSize: 14,
    },
    statValueCompact: {
        color: ui.colors.textPrimary,
        fontSize: 14,
        fontWeight: '800',
    },
    errorCard: {
        marginTop: ui.spacing.md,
        backgroundColor: '#2f1c26',
        borderWidth: 1,
        borderColor: '#684053',
        borderRadius: ui.radius.lg,
        padding: ui.spacing.md,
    },
    errorTitle: {
        color: '#ffd6e4',
        fontSize: 14,
        fontWeight: '800',
    },
    errorBody: {
        color: '#f9c1d5',
        fontSize: 13,
        marginTop: 4,
        lineHeight: 19,
    },
    actions: {
        marginTop: ui.spacing.lg,
        flexDirection: 'row',
        gap: 10,
    },
    secondaryButton: {
        flex: 1,
        alignItems: 'center',
        borderRadius: ui.radius.pill,
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panelMuted,
        paddingVertical: 12,
    },
    secondaryButtonText: {
        color: ui.colors.textPrimary,
        fontSize: 13,
        fontWeight: '800',
    },
    primaryButton: {
        flex: 1.2,
        alignItems: 'center',
        borderRadius: ui.radius.pill,
        backgroundColor: ui.colors.textPrimary,
        paddingVertical: 12,
    },
    primaryButtonText: {
        color: '#0f1726',
        fontSize: 13,
        fontWeight: '900',
    },
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
