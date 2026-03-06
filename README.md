# Radiomap

## Android Build Guide

### Prerequisites
- Node.js + npm installed.
- Android Studio / Android SDK installed.
- JDK 21 installed.
- `ANDROID_HOME` configured, or `android/local.properties` contains:
  - `sdk.dir=/path/to/Android/sdk`

### 1) Clone and install deps
```bash
git clone https://github.com/maasir554/radiomap
cd radiomap
npm install
```

### 2) Build debug APK (recommended for testing)
```bash
cd android
./gradlew app:assembleDebug -x lint -x test --build-cache -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

Debug APK output:
- `android/app/build/outputs/apk/debug/app-debug.apk`

### 3) Build release APK
```bash
cd android
./gradlew app:assembleRelease -x lint -x test --build-cache -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

Release APK output:
- `android/app/build/outputs/apk/release/app-release.apk`

### 4) Install APK via ADB
From repo root:
```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Run app with Expo dev client
From repo root:
```bash
npx expo start --dev-client
```

## Notes
- If Gradle cannot find SDK:
  - set `ANDROID_HOME`, or
  - create `android/local.properties` with valid `sdk.dir`.
- Current `release` signing may still be debug/default; configure your own keystore for production distribution.
