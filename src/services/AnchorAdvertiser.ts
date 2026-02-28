import { NativeModules, Platform } from 'react-native';

interface AnchorAdvertiserNativeModule {
    startAdvertising(anchorId: string): Promise<boolean>;
    stopAdvertising(): Promise<boolean>;
    getIsAdvertising(): Promise<boolean>;
}

const nativeModule = NativeModules.AnchorAdvertiser as AnchorAdvertiserNativeModule | undefined;

const ensureAndroid = () => {
    if (Platform.OS !== 'android') {
        throw new Error('Anchor advertising is currently supported on Android only.');
    }
    if (!nativeModule) {
        throw new Error('Anchor advertiser native module is unavailable.');
    }
    return nativeModule;
};

export const anchorAdvertiser = {
    async startAdvertising(anchorId: string): Promise<void> {
        await ensureAndroid().startAdvertising(anchorId);
    },
    async stopAdvertising(): Promise<void> {
        await ensureAndroid().stopAdvertising();
    },
    async isAdvertising(): Promise<boolean> {
        return ensureAndroid().getIsAdvertising();
    },
};
