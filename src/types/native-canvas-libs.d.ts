declare module 'react-native-gesture-handler' {
    import * as React from 'react';

    export const GestureHandlerRootView: React.ComponentType<any>;
    export const GestureDetector: React.ComponentType<any>;
    export const Gesture: {
        Pan: () => any;
    };
}

declare module 'react-native-reanimated' {
    import * as React from 'react';

    const Animated: {
        View: React.ComponentType<any>;
    };

    export const useSharedValue: <T>(initial: T) => { value: T };
    export const useAnimatedStyle: (worklet: () => any) => any;
    export const LinearTransition: any;
    export default Animated;
}

declare module '@shopify/react-native-skia' {
    import * as React from 'react';

    export const Canvas: React.ComponentType<any>;
    export const RoundedRect: React.ComponentType<any>;
    export const Line: React.ComponentType<any>;
    export const Circle: React.ComponentType<any>;
}
