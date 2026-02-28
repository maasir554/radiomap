import React from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { ui } from '../theme/ui';

interface TopNavProps {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    right?: React.ReactNode;
}

export const TopNav: React.FC<TopNavProps> = ({ title, subtitle, onBack, right }) => {
    const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

    return (
        <View style={[styles.container, { paddingTop: topInset + 8 }]}>
            <View style={styles.row}>
                <View style={styles.side}>
                    {onBack ? (
                        <Pressable onPress={onBack} style={styles.backButton}>
                            <Text style={styles.backText}>Back</Text>
                        </Pressable>
                    ) : (
                        <View style={styles.sideSpacer} />
                    )}
                </View>

                <View style={styles.center}>
                    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                    <Text style={styles.title}>{title}</Text>
                </View>

                <View style={[styles.side, styles.right]}>{right ?? <View style={styles.sideSpacer} />}</View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: ui.spacing.md,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    side: {
        width: 84,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    right: {
        alignItems: 'flex-end',
    },
    sideSpacer: {
        width: 76,
        height: 34,
    },
    center: {
        flex: 1,
        alignItems: 'center',
    },
    subtitle: {
        color: ui.colors.textMuted,
        textTransform: 'uppercase',
        fontSize: 10,
        letterSpacing: 1.2,
    },
    title: {
        color: ui.colors.textPrimary,
        fontSize: 24,
        fontWeight: '900',
        marginTop: 2,
        textAlign: 'center',
    },
    backButton: {
        height: 34,
        borderRadius: ui.radius.pill,
        borderWidth: 1,
        borderColor: ui.colors.border,
        backgroundColor: ui.colors.panel,
        justifyContent: 'center',
        paddingHorizontal: 14,
    },
    backText: {
        color: ui.colors.textPrimary,
        fontSize: 13,
        fontWeight: '700',
    },
});
