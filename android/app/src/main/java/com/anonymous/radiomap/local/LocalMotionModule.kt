package com.anonymous.radiomap.local

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class LocalMotionModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener {

    private val sensorManager =
        reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private var rotationSensor: Sensor? = null
    private var stepDetectorSensor: Sensor? = null
    private var linearAccelerationSensor: Sensor? = null
    private var accelerometerSensor: Sensor? = null

    private var tracking = false
    private var trackingStartedAtMs = 0.0
    private var headingRad = 0.0
    private var initialYawRad: Double? = null
    private var steps = 0
    private var lastStepTimestampMs = 0.0
    private var lastHeadingEmitMs = 0.0
    private var lastStepLengthMeters = 0.66

    private var dynamicAcc = 0.0
    private var prevDynamicAcc = 0.0
    private var prevSlope = 0.0
    private var lastFallbackStepMs = 0.0
    private var lastPeakMs = 0.0
    private var lastValley = 0.0
    private var consecutivePlausibleSteps = 0
    private var walkingPatternLocked = false
    private var activeFallbackSource = "none"
    private var gravityX = 0.0
    private var gravityY = 0.0
    private var gravityZ = 9.81
    private var stepDetectorEvents = 0
    private var lastStepDetectorMs = 0.0
    private var lastStepSource = "none"

    private val rotationMatrix = FloatArray(9)
    private val orientation = FloatArray(3)

    override fun getName(): String = "LocalMotionModule"

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        val sensor = getPreferredRotationSensor()
        promise.resolve(sensor != null)
    }

    @ReactMethod
    fun startTracking(promise: Promise) {
        try {
            stopTrackingInternal()
            resetState()

            rotationSensor = getPreferredRotationSensor()
            if (rotationSensor == null) {
                promise.reject("NO_ROTATION_SENSOR", "Rotation vector sensor is unavailable on this device.")
                return
            }

            val hasActivityPermission =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                    ContextCompat.checkSelfPermission(
                        reactContext,
                        Manifest.permission.ACTIVITY_RECOGNITION
                    ) == PackageManager.PERMISSION_GRANTED

            stepDetectorSensor =
                if (hasActivityPermission) sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) else null
            linearAccelerationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
            accelerometerSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            activeFallbackSource = when {
                linearAccelerationSensor != null -> "linear_acceleration"
                accelerometerSensor != null -> "accelerometer"
                else -> "none"
            }

            val rotationRegistered = sensorManager.registerListener(
                this,
                rotationSensor,
                SensorManager.SENSOR_DELAY_GAME
            )
            if (!rotationRegistered) {
                promise.reject("REGISTER_FAILED", "Unable to start rotation tracking.")
                return
            }

            if (stepDetectorSensor != null) {
                sensorManager.registerListener(this, stepDetectorSensor, SensorManager.SENSOR_DELAY_NORMAL)
            }
            if (activeFallbackSource == "linear_acceleration" && linearAccelerationSensor != null) {
                sensorManager.registerListener(this, linearAccelerationSensor, SensorManager.SENSOR_DELAY_GAME)
            }
            if (activeFallbackSource == "accelerometer" && accelerometerSensor != null) {
                sensorManager.registerListener(this, accelerometerSensor, SensorManager.SENSOR_DELAY_GAME)
            }

            tracking = true
            trackingStartedAtMs = SystemClock.elapsedRealtime().toDouble()
            emitUpdate(hasStep = false, timestampMs = trackingStartedAtMs)
            promise.resolve(true)
        } catch (error: Exception) {
            stopTrackingInternal()
            promise.reject("START_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun stopTracking(promise: Promise) {
        stopTrackingInternal()
        promise.resolve(true)
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (!tracking || event == null) return

        when (event.sensor.type) {
            Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_GAME_ROTATION_VECTOR -> handleRotation(event)
            Sensor.TYPE_STEP_DETECTOR -> handleStepDetected(event.timestamp / 1_000_000.0)
            Sensor.TYPE_LINEAR_ACCELERATION -> handleLinearAccelerationFallback(event)
            Sensor.TYPE_ACCELEROMETER -> handleAccelerometerFallback(event)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // No-op.
    }

    private fun handleRotation(event: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
        SensorManager.getOrientation(rotationMatrix, orientation)
        val yaw = orientation[0].toDouble()
        val eventMs = event.timestamp / 1_000_000.0

        val initial = initialYawRad
        if (initial == null) {
            initialYawRad = yaw
            headingRad = 0.0
            emitUpdate(hasStep = false, timestampMs = eventMs)
            return
        }

        val relativeHeading = normalizeAngle(yaw - initial)
        headingRad = blendAngle(headingRad, relativeHeading, alpha = 0.35)

        if (eventMs - lastHeadingEmitMs >= 90.0) {
            lastHeadingEmitMs = eventMs
            emitUpdate(hasStep = false, timestampMs = eventMs)
        }
    }

    private fun handleStepDetected(timestampMs: Double) {
        val dt = if (lastStepTimestampMs <= 0.0) {
            620.0
        } else {
            clamp(timestampMs - lastStepTimestampMs, 260.0, 1800.0)
        }

        val cadenceSpm = 60000.0 / dt
        val normalizedCadence = clamp((cadenceSpm - 95.0) / 85.0, 0.0, 1.0)
        lastStepLengthMeters = 0.54 + normalizedCadence * 0.32

        stepDetectorEvents += 1
        lastStepDetectorMs = timestampMs
        lastStepSource = "step_detector"
        steps += 1
        lastStepTimestampMs = timestampMs
        emitUpdate(hasStep = true, timestampMs = timestampMs)
    }

    private fun handleLinearAccelerationFallback(event: SensorEvent) {
        val timestampMs = event.timestamp / 1_000_000.0
        if (activeFallbackSource != "linear_acceleration") return
        val ax = event.values.getOrNull(0)?.toDouble() ?: 0.0
        val ay = event.values.getOrNull(1)?.toDouble() ?: 0.0
        val az = event.values.getOrNull(2)?.toDouble() ?: 0.0
        val magnitude = sqrt(ax * ax + ay * ay + az * az)
        detectFallbackStep(magnitude, timestampMs, "linear_acceleration")
    }

    private fun handleAccelerometerFallback(event: SensorEvent) {
        val timestampMs = event.timestamp / 1_000_000.0
        if (activeFallbackSource != "accelerometer") return
        val ax = event.values.getOrNull(0)?.toDouble() ?: 0.0
        val ay = event.values.getOrNull(1)?.toDouble() ?: 0.0
        val az = event.values.getOrNull(2)?.toDouble() ?: 0.0

        val gravityAlpha = 0.9
        gravityX = gravityAlpha * gravityX + (1 - gravityAlpha) * ax
        gravityY = gravityAlpha * gravityY + (1 - gravityAlpha) * ay
        gravityZ = gravityAlpha * gravityZ + (1 - gravityAlpha) * az

        val lx = ax - gravityX
        val ly = ay - gravityY
        val lz = az - gravityZ
        val magnitude = sqrt(lx * lx + ly * ly + lz * lz)
        detectFallbackStep(magnitude, timestampMs, "accelerometer")
    }

    private fun detectFallbackStep(magnitude: Double, timestampMs: Double, source: String) {
        if (!shouldUseFallback(timestampMs)) return

        if ((timestampMs - lastPeakMs) > 2200.0 && walkingPatternLocked) {
            walkingPatternLocked = false
            consecutivePlausibleSteps = 0
        }

        dynamicAcc = dynamicAcc * 0.82 + magnitude * 0.18
        val slope = dynamicAcc - prevDynamicAcc

        val amplitudeThreshold = if (source == "linear_acceleration") 0.78 else 0.52
        val refractoryMs = 280.0
        val isValley = prevSlope < 0 && slope >= 0
        if (isValley) {
            lastValley = prevDynamicAcc
        }

        val isPeak = prevSlope > 0 && slope <= 0
        val enoughGap = (timestampMs - lastFallbackStepMs) > refractoryMs &&
            (timestampMs - lastStepTimestampMs) > (refractoryMs * 0.88)

        if (isPeak && enoughGap) {
            val peakValue = prevDynamicAcc
            val amplitude = peakValue - lastValley
            val stepIntervalMs = if (lastPeakMs <= 0.0) 620.0 else timestampMs - lastPeakMs
            val plausibleCadence = stepIntervalMs in 320.0..1450.0
            val plausibleAmplitude = amplitude >= amplitudeThreshold

            if (plausibleCadence && plausibleAmplitude) {
                consecutivePlausibleSteps = min(consecutivePlausibleSteps + 1, 8)
            } else {
                consecutivePlausibleSteps = 0
                walkingPatternLocked = false
            }

            lastPeakMs = timestampMs

            val allowStep = walkingPatternLocked || consecutivePlausibleSteps >= 2
            if (allowStep) {
                walkingPatternLocked = true

                val cadenceSpm = 60000.0 / clamp(stepIntervalMs, 320.0, 1600.0)
                val cadenceNorm = clamp((cadenceSpm - 90.0) / 90.0, 0.0, 1.0)
                val amplitudeNorm = clamp((amplitude - amplitudeThreshold) / (amplitudeThreshold * 1.5), 0.0, 1.0)
                lastStepLengthMeters = 0.5 + cadenceNorm * 0.2 + amplitudeNorm * 0.12

                lastStepSource = source
                steps += 1
                lastFallbackStepMs = timestampMs
                lastStepTimestampMs = timestampMs
                emitUpdate(hasStep = true, timestampMs = timestampMs)
            }
        }

        prevSlope = slope
        prevDynamicAcc = dynamicAcc
    }

    private fun shouldUseFallback(timestampMs: Double): Boolean {
        if (stepDetectorSensor == null) return true

        val elapsedSinceStart = timestampMs - trackingStartedAtMs
        if (stepDetectorEvents == 0 && elapsedSinceStart < 6000.0) {
            // Give hardware step detector a chance before enabling fallback.
            return false
        }

        if (stepDetectorEvents > 0) {
            val silentForMs = timestampMs - lastStepDetectorMs
            return silentForMs > 2500.0
        }

        return true
    }

    private fun emitUpdate(hasStep: Boolean, timestampMs: Double) {
        if (!reactContext.hasActiveCatalystInstance()) return

        val payload = Arguments.createMap().apply {
            putDouble("headingRad", headingRad)
            putInt("steps", steps)
            putDouble("stepLengthMeters", lastStepLengthMeters)
            putDouble("timestamp", timestampMs)
            putBoolean("hasStep", hasStep)
            putString("headingSource", headingSource())
            putString(
                "stepSource",
                if (hasStep) lastStepSource
                else if (stepDetectorSensor != null) "step_detector"
                else if (linearAccelerationSensor != null) "linear_acceleration"
                else "accelerometer"
            )
        }

        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("LocalMotionUpdate", payload)
    }

    private fun stopTrackingInternal() {
        sensorManager.unregisterListener(this)
        tracking = false
        trackingStartedAtMs = 0.0
        rotationSensor = null
        stepDetectorSensor = null
        linearAccelerationSensor = null
        accelerometerSensor = null
        resetState()
    }

    private fun resetState() {
        headingRad = 0.0
        initialYawRad = null
        steps = 0
        lastStepTimestampMs = 0.0
        lastHeadingEmitMs = 0.0
        lastStepLengthMeters = 0.66
        dynamicAcc = 0.0
        prevDynamicAcc = 0.0
        prevSlope = 0.0
        lastFallbackStepMs = 0.0
        lastPeakMs = 0.0
        lastValley = 0.0
        consecutivePlausibleSteps = 0
        walkingPatternLocked = false
        activeFallbackSource = "none"
        gravityX = 0.0
        gravityY = 0.0
        gravityZ = 9.81
        stepDetectorEvents = 0
        lastStepDetectorMs = 0.0
        lastStepSource = "none"
    }

    private fun getPreferredRotationSensor(): Sensor? {
        return sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            ?: sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    }

    private fun headingSource(): String {
        return when (rotationSensor?.type) {
            Sensor.TYPE_GAME_ROTATION_VECTOR -> "game_rotation_vector"
            Sensor.TYPE_ROTATION_VECTOR -> "rotation_vector"
            else -> "unknown"
        }
    }

    private fun normalizeAngle(value: Double): Double {
        var angle = value
        while (angle > PI) angle -= PI * 2
        while (angle < -PI) angle += PI * 2
        return angle
    }

    private fun blendAngle(current: Double, target: Double, alpha: Double): Double {
        val delta = normalizeAngle(target - current)
        return normalizeAngle(current + delta * alpha)
    }

    private fun clamp(value: Double, minValue: Double, maxValue: Double): Double {
        return max(minValue, min(maxValue, value))
    }
}
