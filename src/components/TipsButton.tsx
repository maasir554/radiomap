import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ui } from '../theme/ui';

type TipSlide = {
    title: string;
    device: string;
    body: string;
};

const SLIDES: TipSlide[] = [
    {
        title: 'Goal',
        device: 'All Devices',
        body: 'Use 4 phones as anchors and 1 phone as test device to calculate and map live X/Y position.',
    },
    {
        title: 'Anchor Phones',
        device: '4 Corner Phones',
        body: 'Open Anchor Mode, set IDs BLUEPOINT-01 to BLUEPOINT-04, and keep broadcasting ON.',
    },
    {
        title: 'Anchor Placement',
        device: '4 Corner Phones',
        body: 'Place each anchor at fixed room corners and keep them stationary during the full session.',
    },
    {
        title: 'Test Device Setup',
        device: '1 Test Phone',
        body: 'Open Mobile Mode, enter room width/height and phone height relative to BLUEPOINT-01 (positive above, negative below).',
    },
    {
        title: 'Relative Heights',
        device: '1 Test Phone',
        body: 'In Step 2, keep BLUEPOINT-01 at 0 and enter relative heights for other anchors. This compensates vertical mismatch.',
    },
    {
        title: 'Calibration',
        device: '1 Test Phone',
        body: 'Start calibration scan, stand around 1 meter from each anchor, and tap Calibrate for each anchor.',
    },
    {
        title: 'Tracking',
        device: '1 Test Phone',
        body: 'Go to Live Tracking and start scan. You need at least 3 visible anchors for X/Y to update.',
    },
    {
        title: 'Troubleshooting',
        device: 'All Devices',
        body: 'If position is not updating, confirm anchors are still broadcasting, IDs are correct, and rerun calibration.',
    },
];

export const TipsButton: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [index, setIndex] = useState(0);

    const current = useMemo(() => SLIDES[index], [index]);
    const isFirst = index === 0;
    const isLast = index === SLIDES.length - 1;

    const close = () => {
        setOpen(false);
        setIndex(0);
    };

    return (
        <>
            <Pressable style={styles.button} onPress={() => setOpen(true)}>
                <Text style={styles.buttonText}>Tips</Text>
            </Pressable>

            <Modal visible={open} animationType="fade" transparent onRequestClose={close}>
                <View style={styles.overlay}>
                    <View style={styles.modal}>
                        <View style={styles.topRow}>
                            <Text style={styles.stepText}>Step {index + 1} of {SLIDES.length}</Text>
                            <Pressable style={styles.closeButton} onPress={close}>
                                <Text style={styles.closeText}>Close</Text>
                            </Pressable>
                        </View>

                        <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${((index + 1) / SLIDES.length) * 100}%` }]} />
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.deviceTag}>{current.device}</Text>
                            <Text style={styles.title}>{current.title}</Text>
                            <Text style={styles.body}>{current.body}</Text>
                        </View>

                        <View style={styles.controls}>
                            <Pressable
                                disabled={isFirst}
                                onPress={() => setIndex((prev) => Math.max(0, prev - 1))}
                                style={[styles.controlButton, isFirst && styles.controlButtonDisabled]}
                            >
                                <Text style={[styles.controlText, isFirst && styles.controlTextDisabled]}>Previous</Text>
                            </Pressable>

                            <Pressable
                                onPress={() => {
                                    if (isLast) {
                                        close();
                                    } else {
                                        setIndex((prev) => Math.min(SLIDES.length - 1, prev + 1));
                                    }
                                }}
                                style={[styles.controlButton, styles.controlButtonPrimary]}
                            >
                                <Text style={[styles.controlText, styles.controlTextPrimary]}>{isLast ? 'Done' : 'Next'}</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </>
    );
};

const styles = StyleSheet.create({
    button: {
        borderRadius: ui.radius.pill,
        backgroundColor: '#101725',
        borderWidth: 1,
        borderColor: ui.colors.border,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    buttonText: {
        color: ui.colors.textPrimary,
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(4, 8, 14, 0.72)',
        justifyContent: 'center',
        padding: 18,
    },
    modal: {
        backgroundColor: ui.colors.panel,
        borderRadius: ui.radius.xl,
        borderWidth: 1,
        borderColor: ui.colors.border,
        padding: ui.spacing.lg,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    stepText: {
        color: ui.colors.textMuted,
        fontSize: 12,
        fontWeight: '700',
    },
    closeButton: {
        borderRadius: ui.radius.pill,
        backgroundColor: ui.colors.panelMuted,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    closeText: {
        color: ui.colors.textPrimary,
        fontSize: 12,
        fontWeight: '700',
    },
    progressTrack: {
        height: 6,
        borderRadius: ui.radius.pill,
        backgroundColor: '#1a2435',
        marginTop: ui.spacing.md,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: ui.colors.accent,
    },
    card: {
        marginTop: ui.spacing.lg,
        backgroundColor: ui.colors.panelElevated,
        borderRadius: ui.radius.lg,
        borderWidth: 1,
        borderColor: ui.colors.border,
        padding: ui.spacing.lg,
    },
    deviceTag: {
        alignSelf: 'flex-start',
        borderRadius: ui.radius.pill,
        backgroundColor: '#1f355c',
        color: '#caddff',
        paddingHorizontal: 10,
        paddingVertical: 5,
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 10,
    },
    title: {
        color: ui.colors.textPrimary,
        fontSize: 22,
        fontWeight: '900',
        marginBottom: 8,
    },
    body: {
        color: ui.colors.textSecondary,
        fontSize: 15,
        lineHeight: 22,
    },
    controls: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: ui.spacing.lg,
        gap: ui.spacing.sm,
    },
    controlButton: {
        flex: 1,
        alignItems: 'center',
        borderRadius: ui.radius.pill,
        paddingVertical: 12,
        backgroundColor: ui.colors.panelMuted,
    },
    controlButtonPrimary: {
        backgroundColor: ui.colors.textPrimary,
    },
    controlButtonDisabled: {
        opacity: 0.5,
    },
    controlText: {
        color: ui.colors.textPrimary,
        fontSize: 14,
        fontWeight: '800',
    },
    controlTextPrimary: {
        color: '#0e1625',
    },
    controlTextDisabled: {
        color: ui.colors.textMuted,
    },
});
