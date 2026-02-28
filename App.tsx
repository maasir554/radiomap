import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { useStore } from './src/store/useStore';
import { bleService } from './src/services/BleService';
import { RoleSelectionScreen } from './src/screens/RoleSelectionScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { TrackingScreen } from './src/screens/TrackingScreen';
import { AnchorModeScreen } from './src/screens/AnchorModeScreen';
import { LocalModeScreen } from './src/screens/LocalModeScreen';
import { ui } from './src/theme/ui';

export default function App() {
    const { role } = useStore();
    const [setupComplete, setSetupComplete] = useState(false);

    useEffect(() => {
        if (role === 'none') {
            setSetupComplete(false);
        }
    }, [role]);

    useEffect(() => {
        if (role !== 'mobile' && role !== 'anchor') {
            bleService.cleanup();
            return;
        }

        let active = true;
        bleService.initialize().catch(err => {
            if (active) {
                console.error('BLE Init error:', err);
            }
        });

        return () => {
            active = false;
            bleService.cleanup();
        };
    }, [role]);

    const renderContent = () => {
        if (role === 'none') {
            return <RoleSelectionScreen />;
        }

        if (role === 'anchor') {
            return <AnchorModeScreen />;
        }

        if (role === 'mobile') {
            if (!setupComplete) {
                return <SetupScreen onComplete={() => setSetupComplete(true)} />;
            }
            return <TrackingScreen onBack={() => setSetupComplete(false)} />;
        }

        if (role === 'local') {
            return <LocalModeScreen />;
        }

        return null;
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={ui.colors.bg} translucent={false} />
            {renderContent()}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: ui.colors.bg,
    },
});
