package com.anonymous.radiomap.ble

import android.Manifest
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets

class AnchorAdvertiserModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var advertiserCallback: AdvertiseCallback? = null
    private var isAdvertising = false

    override fun getName(): String = "AnchorAdvertiser"

    @ReactMethod
    fun startAdvertising(anchorId: String, promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            promise.reject("UNSUPPORTED_ANDROID", "BLE advertising requires Android 5.0+.")
            return
        }

        if (!anchorId.startsWith("BLUEPOINT-")) {
            promise.reject("INVALID_ID", "Anchor ID must start with BLUEPOINT-.")
            return
        }

        val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        if (adapter == null) {
            promise.reject("NO_ADAPTER", "Bluetooth adapter unavailable.")
            return
        }
        if (!adapter.isEnabled) {
            promise.reject("BT_OFF", "Bluetooth is turned off.")
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            reactContext.checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("NO_ADVERTISE_PERMISSION", "BLUETOOTH_ADVERTISE permission is not granted.")
            return
        }

        val advertiser = adapter.bluetoothLeAdvertiser
        if (advertiser == null) {
            promise.reject("NO_ADVERTISER", "BLE advertiser is unavailable on this device.")
            return
        }

        advertiserCallback?.let { advertiser.stopAdvertising(it) }

        val serviceUuid = ParcelUuid.fromString(SERVICE_UUID)
        val payload = anchorId.toByteArray(StandardCharsets.UTF_8)
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(false)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(serviceUuid)
            .addServiceData(serviceUuid, payload)
            .build()

        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                promise.resolve(true)
            }

            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                advertiserCallback = null
                promise.reject("ADVERTISE_FAILED", "Failed to start advertising. Code: $errorCode")
            }
        }

        advertiserCallback = callback
        advertiser.startAdvertising(settings, data, callback)
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            isAdvertising = false
            promise.resolve(true)
            return
        }

        val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        val advertiser = adapter?.bluetoothLeAdvertiser
        val callback = advertiserCallback
        if (advertiser != null && callback != null) {
            advertiser.stopAdvertising(callback)
        }
        advertiserCallback = null
        isAdvertising = false
        promise.resolve(true)
    }

    @ReactMethod
    fun getIsAdvertising(promise: Promise) {
        promise.resolve(isAdvertising)
    }

    companion object {
        private const val SERVICE_UUID = "00001802-0000-1000-8000-00805f9b34fb"
    }
}
