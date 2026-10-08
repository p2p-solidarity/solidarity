/*
 * DriveClient.kt
 * @solidarity/nitro-cloudkit (Android)
 *
 * Thin OkHttp wrapper around the Google Drive REST API (v3). We avoid the
 * heavy `google-api-services-drive` dependency because:
 *   - It ships ~6 MB of generated client code plus the Apache HTTP stack.
 *   - We only need 6 endpoints (files.create / files.get / files.list /
 *     files.update / files.delete / permissions.create).
 *
 * Auth is bearer-token, passed in via `setAccessToken()` (the consumer's
 * react-native-google-signin session). Tokens are short-lived; the caller
 * is responsible for refreshing and pushing a new token.
 *
 * No PII is logged here — only file IDs / HTTP status codes when something
 * fails. Bodies live in the request stream only.
 */
package com.margelo.nitro.gg.solidarity.keystone

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/** Minimal projection of a Drive file the higher layer cares about. */
data class DriveFile(
  val id: String,
  val name: String,
  val mimeType: String,
  val parents: List<String>,
  val modifiedTime: Long,
  val webViewLink: String?,
  val appProperties: Map<String, String>,
)

class DriveClient {

  @Volatile
  private var accessToken: String? = null

  private val http: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .build()

  fun setAccessToken(token: String) {
    accessToken = token
  }

  fun isAuthenticated(): Boolean = !accessToken.isNullOrEmpty()

  // MARK: - Files

  /**
   * Create or update a Drive file. Returns the file id. When `existingId`
   * is null we use a multipart upload (POST /upload/drive/v3/files); when
   * non-null we PATCH the existing file's content.
   */
  fun upsertFile(
    name: String,
    mimeType: String,
    body: ByteArray,
    parents: List<String>,
    appProperties: Map<String, String>,
    existingId: String?,
  ): String {
    val metadata = JSONObject().apply {
      put("name", name)
      if (existingId == null && parents.isNotEmpty()) {
        put("parents", JSONArray(parents))
      }
      if (appProperties.isNotEmpty()) {
        val props = JSONObject()
        for ((k, v) in appProperties) props.put(k, v)
        put("appProperties", props)
      }
    }

    val multipart = MultipartBody.Builder()
      .setType("multipart/related".toMediaType())
      .addPart(
        metadata.toString().toRequestBody(
          "application/json; charset=UTF-8".toMediaType()
        )
      )
      .addPart(body.toRequestBody(mimeType.toMediaType()))
      .build()

    val url = if (existingId == null) {
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id"
    } else {
      "https://www.googleapis.com/upload/drive/v3/files/$existingId?uploadType=multipart&fields=id"
    }

    val builder = Request.Builder().url(url)
    if (existingId == null) builder.post(multipart) else builder.patch(multipart)
    builder.addHeader("Authorization", "Bearer ${requireToken()}")
    val resp = http.newCall(builder.build()).execute()
    resp.use {
      val text = it.body?.string() ?: ""
      if (!it.isSuccessful) {
        throw IOException("Drive upsert failed: HTTP ${it.code} — $text")
      }
      val json = JSONObject(text)
      return json.optString("id")
    }
  }

  fun fetchFileContent(fileId: String): ByteArray {
    val req = Request.Builder()
      .url("https://www.googleapis.com/drive/v3/files/$fileId?alt=media")
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .get()
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      if (!it.isSuccessful) {
        val text = it.body?.string() ?: ""
        throw IOException("Drive fetch failed: HTTP ${it.code} — $text")
      }
      return it.body?.bytes() ?: ByteArray(0)
    }
  }

  fun deleteFile(fileId: String) {
    val req = Request.Builder()
      .url("https://www.googleapis.com/drive/v3/files/$fileId")
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .delete()
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      if (!it.isSuccessful && it.code != 404) {
        val text = it.body?.string() ?: ""
        throw IOException("Drive delete failed: HTTP ${it.code} — $text")
      }
    }
  }

  fun fetchFileMetadata(fileId: String): DriveFile {
    val fields = "id,name,mimeType,parents,modifiedTime,webViewLink,appProperties"
    val url = "https://www.googleapis.com/drive/v3/files/$fileId?fields=${URLEncoder.encode(fields, "UTF-8")}"
    val req = Request.Builder()
      .url(url)
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .get()
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      val text = it.body?.string() ?: ""
      if (!it.isSuccessful) {
        throw IOException("Drive metadata fetch failed: HTTP ${it.code} — $text")
      }
      return parseDriveFile(JSONObject(text))
    }
  }

  /**
   * List files matching the given Drive query. Returns a flat list (no
   * pagination beyond a single page — callers should set their predicate
   * tight enough to stay under the default 100 result limit).
   */
  fun listFiles(query: String): List<DriveFile> {
    val fields = "files(id,name,mimeType,parents,modifiedTime,webViewLink,appProperties)"
    val url = StringBuilder("https://www.googleapis.com/drive/v3/files?")
    url.append("q=${URLEncoder.encode(query, "UTF-8")}")
    url.append("&fields=${URLEncoder.encode(fields, "UTF-8")}")
    url.append("&spaces=drive")
    url.append("&pageSize=100")
    val req = Request.Builder()
      .url(url.toString())
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .get()
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      val text = it.body?.string() ?: ""
      if (!it.isSuccessful) {
        throw IOException("Drive list failed: HTTP ${it.code} — $text")
      }
      val json = JSONObject(text)
      val arr = json.optJSONArray("files") ?: return emptyList()
      val out = ArrayList<DriveFile>(arr.length())
      for (i in 0 until arr.length()) {
        out.add(parseDriveFile(arr.getJSONObject(i)))
      }
      return out
    }
  }

  // MARK: - Permissions (the "CKShare" stand-in)

  /**
   * Make a file shareable. Drive has no equivalent of CKShare so we mimic
   * "shared zone" with `role=writer, type=anyone` and surface the
   * webViewLink as the invite URL. The caller is responsible for re-encrypting
   * the file with the per-share key before flipping it shared — Drive will
   * NOT encrypt the body further.
   */
  fun makeShareable(fileId: String, allowsPublic: Boolean): String {
    val role = "writer"
    val type = if (allowsPublic) "anyone" else "user"
    val body = JSONObject().apply {
      put("role", role)
      put("type", type)
    }
    val req = Request.Builder()
      .url("https://www.googleapis.com/drive/v3/files/$fileId/permissions?fields=id")
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .addHeader("Content-Type", "application/json")
      .post(body.toString().toRequestBody("application/json".toMediaType()))
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      val text = it.body?.string() ?: ""
      if (!it.isSuccessful) {
        throw IOException("Drive permissions.create failed: HTTP ${it.code} — $text")
      }
      val json = JSONObject(text)
      return json.optString("id")
    }
  }

  fun removeShare(fileId: String, permissionId: String) {
    val req = Request.Builder()
      .url("https://www.googleapis.com/drive/v3/files/$fileId/permissions/$permissionId")
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .delete()
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      if (!it.isSuccessful && it.code != 404) {
        val text = it.body?.string() ?: ""
        throw IOException("Drive permissions.delete failed: HTTP ${it.code} — $text")
      }
    }
  }

  // MARK: - Folder helpers

  /**
   * Resolve (or create) a folder by name inside `parentId` (or root if
   * null). Returns the folder id.
   */
  fun ensureFolder(name: String, parentId: String?): String {
    val parentQ = if (parentId != null) " and '$parentId' in parents" else ""
    val q = "name = '${escapeQ(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false$parentQ"
    val existing = listFiles(q)
    if (existing.isNotEmpty()) return existing.first().id
    val metadata = JSONObject().apply {
      put("name", name)
      put("mimeType", "application/vnd.google-apps.folder")
      if (parentId != null) put("parents", JSONArray(listOf(parentId)))
    }
    val req = Request.Builder()
      .url("https://www.googleapis.com/drive/v3/files?fields=id")
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .addHeader("Content-Type", "application/json")
      .post(metadata.toString().toRequestBody("application/json".toMediaType()))
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      val text = it.body?.string() ?: ""
      if (!it.isSuccessful) {
        throw IOException("Drive folder.create failed: HTTP ${it.code} — $text")
      }
      return JSONObject(text).optString("id")
    }
  }

  fun fetchAbout(): JSONObject {
    val req = Request.Builder()
      .url("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)")
      .addHeader("Authorization", "Bearer ${requireToken()}")
      .get()
      .build()
    val resp = http.newCall(req).execute()
    resp.use {
      val text = it.body?.string() ?: ""
      if (!it.isSuccessful) {
        throw IOException("Drive about failed: HTTP ${it.code} — $text")
      }
      return JSONObject(text)
    }
  }

  // MARK: - Internals

  private fun requireToken(): String =
    accessToken ?: throw IOException("Drive access token not set")

  private fun escapeQ(s: String): String = s.replace("'", "\\'")

  private fun parseDriveFile(json: JSONObject): DriveFile {
    val parentsJson = json.optJSONArray("parents")
    val parents = ArrayList<String>()
    if (parentsJson != null) {
      for (i in 0 until parentsJson.length()) parents.add(parentsJson.getString(i))
    }
    val propsJson = json.optJSONObject("appProperties")
    val props = mutableMapOf<String, String>()
    if (propsJson != null) {
      val keys = propsJson.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        props[key] = propsJson.optString(key)
      }
    }
    val modifiedIso = json.optString("modifiedTime")
    val modifiedMs = parseIsoMillis(modifiedIso)
    return DriveFile(
      id = json.optString("id"),
      name = json.optString("name"),
      mimeType = json.optString("mimeType"),
      parents = parents,
      modifiedTime = modifiedMs,
      webViewLink = json.optString("webViewLink").ifEmpty { null },
      appProperties = props.toMap(),
    )
  }

  private fun parseIsoMillis(iso: String): Long {
    if (iso.isEmpty()) return 0
    return try {
      val instant = java.time.Instant.parse(iso)
      instant.toEpochMilli()
    } catch (_: Throwable) {
      0L
    }
  }
}
