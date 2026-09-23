package com.margelo.nitro.gg.solidarity.keystone

import android.util.Base64
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialUnsupportedException
import androidx.credentials.exceptions.domerrors.InvalidStateError
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.security.SecureRandom
import org.json.JSONArray
import org.json.JSONObject

class HybridPasskeyPrf : HybridPasskeyPrfSpec() {
  override fun isSupported(): Boolean = NitroModules.applicationContext != null

  override fun createCredential(
    rpId: String,
    userName: String,
    userId: String,
    prfInput: String,
    excludeCredentialIds: Array<String>,
  ): Promise<PasskeyPrfResult> = Promise.async {
    if (rpId.isBlank() || userName.isBlank()) {
      throw IllegalArgumentException("passkey_prf_invalid_input")
    }
    val userIdBytes = decodeBase64Url(userId)
    val prfInputBytes = decodeBase64Url(prfInput)
    if (userIdBytes.isEmpty() || prfInputBytes.size != 32) {
      throw IllegalArgumentException("passkey_prf_invalid_input")
    }
    val context = NitroModules.applicationContext
      ?: throw IllegalStateException("passkey_prf_unsupported")
    val activity = context.currentActivity
      ?: throw IllegalStateException("passkey_prf_no_activity")

    val credentialManager = CredentialManager.create(context)
    val response = try {
      credentialManager.createCredential(
        activity,
        CreatePublicKeyCredentialRequest(
          requestJson = registrationJson(rpId, userName, userId, prfInput, excludeCredentialIds),
        ),
      )
    } catch (_: CreateCredentialCancellationException) {
      throw IllegalStateException("passkey_prf_cancelled")
    } catch (error: CreatePublicKeyCredentialDomException) {
      throw IllegalStateException(
        if (error.domError is InvalidStateError) "passkey_prf_already_registered"
        else "passkey_prf_invalid_credential",
      )
    } catch (_: CreateCredentialUnsupportedException) {
      throw IllegalStateException("passkey_prf_unsupported")
    } catch (_: Exception) {
      throw IllegalStateException("passkey_prf_invalid_credential")
    }

    val publicKey = response as? CreatePublicKeyCredentialResponse
      ?: throw IllegalStateException("passkey_prf_invalid_credential")
    val json = try {
      JSONObject(publicKey.registrationResponseJson)
    } catch (_: Exception) {
      throw IllegalStateException("passkey_prf_invalid_credential")
    }
    val credentialId = json.optString("rawId").ifBlank { json.optString("id") }
    val prfOutput = json.optJSONObject("clientExtensionResults")
      ?.optJSONObject("prf")
      ?.optJSONObject("results")
      ?.optString("first")
      .orEmpty()
    if (decodeBase64Url(credentialId).isEmpty() || decodeBase64Url(prfOutput).size != 32) {
      throw IllegalStateException("passkey_prf_no_prf")
    }
    PasskeyPrfResult(
      credentialId = credentialId,
      prfOutput = prfOutput,
      attachment = json.optString("authenticatorAttachment").takeIf {
        it == "platform" || it == "cross-platform"
      },
      attestationObject = json.optJSONObject("response")?.optString("attestationObject")
        ?.takeIf { it.isNotBlank() },
    )
  }

  private fun registrationJson(
    rpId: String,
    userName: String,
    userId: String,
    prfInput: String,
    excludeCredentialIds: Array<String>,
  ): String {
    val challenge = ByteArray(32).also(SecureRandom()::nextBytes)
    return JSONObject()
      .put("challenge", encodeBase64Url(challenge))
      .put("rp", JSONObject().put("id", rpId).put("name", "Solidarity"))
      .put(
        "user",
        JSONObject()
          .put("id", userId)
          .put("name", userName)
          .put("displayName", userName),
      )
      .put(
        "pubKeyCredParams",
        JSONArray()
          .put(JSONObject().put("type", "public-key").put("alg", -7))
          .put(JSONObject().put("type", "public-key").put("alg", -257)),
      )
      .put(
        "authenticatorSelection",
        JSONObject()
          .put("residentKey", "required")
          .put("requireResidentKey", true)
          .put("userVerification", "required"),
      )
      .put("excludeCredentials", JSONArray().also { excluded ->
        excludeCredentialIds.forEach { id ->
          excluded.put(JSONObject().put("type", "public-key").put("id", id))
        }
      })
      .put("attestation", "none")
      .put(
        "extensions",
        JSONObject().put(
          "prf",
          JSONObject().put(
            "eval",
            JSONObject().put("first", prfInput),
          ),
        ),
      )
      .toString()
  }

  private fun decodeBase64Url(value: String): ByteArray = try {
    Base64.decode(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  } catch (_: IllegalArgumentException) {
    ByteArray(0)
  }

  private fun encodeBase64Url(value: ByteArray): String =
    Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
