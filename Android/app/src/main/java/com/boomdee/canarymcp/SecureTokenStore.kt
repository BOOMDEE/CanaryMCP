package com.boomdee.canarymcp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureTokenStore(context: Context) {
    private val preferences = context.getSharedPreferences("secure_credentials", Context.MODE_PRIVATE)
    private val keyAlias = "canary_mcp_token_v1"

    @Synchronized
    fun save(deviceToken: String, mcpToken: String) {
        val (deviceIv, encryptedDeviceToken) = encrypt(deviceToken)
        val (mcpIv, encryptedMcpToken) = encrypt(mcpToken)
        preferences.edit()
            .putString("device_iv", deviceIv)
            .putString("device_token", encryptedDeviceToken)
            .putString("mcp_iv", mcpIv)
            .putString("mcp_token", encryptedMcpToken)
            .apply()
    }

    @Synchronized
    fun readDeviceToken(): String? = decrypt("device")

    @Synchronized
    fun readMcpToken(): String? = decrypt("mcp")

    private fun encrypt(value: String): Pair<String, String> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) to
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(prefix: String): String? {
        val ivText = preferences.getString("${prefix}_iv", null) ?: return null
        val tokenText = preferences.getString("${prefix}_token", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(128, Base64.decode(ivText, Base64.NO_WRAP)),
            )
            String(cipher.doFinal(Base64.decode(tokenText, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) {
            clear()
            null
        }
    }

    @Synchronized
    fun clear() {
        preferences.edit().clear().apply()
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }
}
