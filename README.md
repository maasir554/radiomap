# Radiomap

## Build Android APK

### Prerequisites
- Android SDK installed and available via `ANDROID_HOME` (or `sdk.dir` in `android/local.properties`).
- JDK 21 recommended.
- Dependencies installed: `npm install`.

### Debug APK (recommended for local testing)
```bash
cd /Users/maasir/Projects/radiomap/android
./gradlew app:assembleDebug -x lint -x test --build-cache -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

Output APK:
- `/Users/maasir/Projects/radiomap/android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK
```bash
cd /Users/maasir/Projects/radiomap/android
./gradlew app:assembleRelease -x lint -x test --build-cache -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

Output APK:
- `/Users/maasir/Projects/radiomap/android/app/build/outputs/apk/release/app-release.apk`

Note:
- Current `release` build is configured with debug signing in `android/app/build.gradle`.  
  For production distribution, replace with your own keystore/signing config.

## Install APK On Phone (ADB)
```bash
adb devices
adb install -r /Users/maasir/Projects/radiomap/android/app/build/outputs/apk/debug/app-debug.apk
```

