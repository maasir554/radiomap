import React, { useEffect } from 'react';
import { Alert, BackHandler, ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useStore } from '../store/useStore';
import { TipsButton } from '../components/TipsButton';
import { TopNav } from '../components/TopNav';
import { ui } from '../theme/ui';

export const RoleSelectionScreen: React.FC = () => {
    const { setRole } = useStore();

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            Alert.alert('Exit App', 'Do you want to close BluePoint IPS?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
            ]);
            return true;
        });
        return () => subscription.remove();
    }, []);

    return (
        <View style={styles.container}>
            <View style={styles.fixedHeader}>
                <TopNav title="BluePoint IPS" subtitle="Indoor Positioning" right={<TipsButton />} />
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
            >

                <Text style={styles.subtitle}>Select this phone role</Text>

                <TouchableOpacity
                    style={[styles.button, styles.mobileButton]}
                    onPress={() => setRole('mobile')}
                >
                    <Text style={styles.buttonText}>Mobile Mode</Text>
                    <Text style={styles.buttonSubtext}>Use this on the test phone to scan anchors and track X/Y.</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, styles.anchorButton]}
                    onPress={() => setRole('anchor')}
                >
                    <Text style={styles.buttonText}>Anchor Mode</Text>
                    <Text style={styles.buttonSubtext}>Use this on 4 corner phones to broadcast BLUEPOINT IDs.</Text>
                </TouchableOpacity>

            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: ui.colors.bg,
    },
    scroll: {
        flex: 1,
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
    subtitle: {
        fontSize: 15,
        color: ui.colors.textSecondary,
        marginBottom: ui.spacing.xl,
    },
    button: {
        padding: ui.spacing.xl,
        borderRadius: ui.radius.lg,
        marginBottom: ui.spacing.md,
        borderWidth: 1,
        borderColor: ui.colors.border,
    },
    mobileButton: {
        backgroundColor: '#17325d',
    },
    anchorButton: {
        backgroundColor: '#174a42',
    },
    buttonText: {
        color: ui.colors.textPrimary,
        fontSize: 23,
        fontWeight: '800',
    },
    buttonSubtext: {
        color: '#d5e0f2',
        fontSize: 14,
        marginTop: 8,
        lineHeight: 20,
    },
});
