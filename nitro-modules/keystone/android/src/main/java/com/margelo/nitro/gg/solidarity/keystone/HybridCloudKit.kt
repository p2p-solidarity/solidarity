/*
 * HybridCloudKit.kt
 * @solidarity/nitro-cloudkit (Android)
 *
 * Maps the CloudKit Nitro spec onto the Google Drive REST API. Each
 * "record" is a single Drive file under a per-record-type subfolder of
 * `Solidarity/`; "fields" is the file body (a JSON blob — the caller
 * already encrypts via encryptionManager before save).
 *
 * Mapping rules:
 *   - Container          → Drive root folder `Solidarity/`
 *   - Custom zone        → ignored (Drive has no zones)
 *   - recordType         → subfolder name (created on demand)
 *   - recordId           → Drive file name (UUID), id cached in
 *                          `recordIdToFileId` so subsequent saves PATCH
 *                          instead of recreating
 *   - share              → Drive folder + `permissions.create role=writer`
 *                          The folder's `webViewLink` is the invite URL.
 *
 * Concurrency: a single Mutex guards the maps and the DriveClient bearer
 * token, so concurrent JS calls don't race. All Drive I/O happens inside
 * `withContext(Dispatchers.IO)` (Promise.async kicks us onto Dispatchers.IO
 * already, but the explicit `withContext` survives any internal refactor).
 */
package com.margelo.nitro.gg.solidarity.keystone

import android.util.Base64
import com.margelo.nitro.core.Promise
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class HybridCloudKit : HybridCloudKitSpec() {

  // MARK: - State (serialised through `lock`)

  private val lock = ReentrantLock()
  private val drive = DriveClient()

  /** Root `Solidarity/` folder id, populated lazily by ensureRoot(). */
  private var rootFolderId: String? = null

  /** recordType → folder id, populated lazily. */
  private val typeFolderIds = mutableMapOf<String, String>()

  /** `Solidarity/Backups` folder id for file-based backups, lazily resolved. */
  private var backupFolderId: String? = null

  /** recordId (UUID) → Drive file id. */
  private val recordIdToFileId = mutableMapOf<String, String>()

  /** recordId (UUID) → share permission id. */
  private val recordIdToShare = mutableMapOf<String, String>()

  /** shareId (== Drive permission id) → recordId. */
  private val shareIdToRecord = mutableMapOf<String, String>()

  /** Event-listener fan-out. UUID key so unsubscribe stays O(1). */
  private val listeners = mutableMapOf<UUID, (CloudKitEvent) -> Unit>()

  private var initialized = false

  companion object {
    /** Top-level folder name in Drive. Mirrors the iOS container surface. */
    private const val ROOT_FOLDER_NAME = "Solidarity"

    /** MIME type written to Drive for record bodies. */
    private const val RECORD_MIME = "application/json"

    /** Subfolder under `Solidarity/` holding file-based backups. */
    private const val BACKUP_FOLDER_NAME = "Backups"

    /** MIME type for SOLB-framed backup blobs. */
    private const val BACKUP_MIME = "application/octet-stream"
  }

  // MARK: - Helpers

  private fun <T> withState(body: () -> T): T = lock.withLock(body)

  private fun emit(event: CloudKitEvent) {
    val snapshot = withState { listeners.values.toList() }
    for (handler in snapshot) {
      try {
        handler(event)
      } catch (_: Throwable) {
        // listeners must not crash the bridge
      }
    }
  }

  private fun emitError(message: String, code: String) {
    emit(makeEvent(CloudKitEventKind.ERROR, errorMessage = message, errorCode = code))
  }

  private fun makeEvent(
    kind: CloudKitEventKind,
    recordId: String? = null,
    recordType: String? = null,
    shareId: String? = null,
    errorMessage: String? = null,
    errorCode: String? = null,
  ): CloudKitEvent = CloudKitEvent(
    kind = kind,
    recordId = recordId,
    recordType = recordType,
    shareId = shareId,
    errorMessage = errorMessage,
    errorCode = errorCode,
  )

  // MARK: - Container lifecycle

  override fun initialize(containerIdentifier: String): Promise<Boolean> = Promise.async {
    // Drive doesn't have a "container identifier" concept; the bearer token
    // alone scopes access to the user's Drive. We keep the parameter so the
    // TS surface matches iOS but ignore the value.
    @Suppress("UNUSED_VARIABLE")
    val ignoredContainerId = containerIdentifier
    if (!drive.isAuthenticated()) {
      withState { initialized = false }
      return@async false
    }
    return@async try {
      ensureRootFolder()
      withState { initialized = true }
      true
    } catch (e: Throwable) {
      emitError(e.message ?: "Drive init failed", "drive_init_failed")
      withState { initialized = false }
      false
    }
  }

  override fun isAvailable(): Boolean = withState { initialized }

  override fun currentUserId(): Promise<String> = Promise.async {
    val about = drive.fetchAbout()
    val user = about.optJSONObject("user")
    return@async user?.optString("permissionId") ?: user?.optString("emailAddress") ?: ""
  }

  override fun setDriveAccessToken(accessToken: String) {
    drive.setAccessToken(accessToken)
  }

  // MARK: - Private DB CRUD

  override fun saveRecord(record: CloudKitRecord): Promise<CloudKitRecord> = Promise.async {
    val typeFolder = ensureTypeFolder(record.recordType)
    val recordId = record.recordId.ifEmpty { UUID.randomUUID().toString() }
    val existing = withState { recordIdToFileId[recordId] }
    val body = record.fields.toByteArray(Charsets.UTF_8)
    val props = mapOf(
      "solidarityRecordId" to recordId,
      "solidarityRecordType" to record.recordType,
    )
    val fileId = drive.upsertFile(
      name = recordId,
      mimeType = RECORD_MIME,
      body = body,
      parents = listOf(typeFolder),
      appProperties = props,
      existingId = existing,
    )
    withState { recordIdToFileId[recordId] = fileId }
    val meta = drive.fetchFileMetadata(fileId)
    val shareId = withState { recordIdToShare[recordId] }
    val out = CloudKitRecord(
      recordId = recordId,
      recordType = record.recordType,
      fields = record.fields,
      zoneId = null,
      shareId = shareId,
      modifiedTime = meta.modifiedTime.toDouble(),
    )
    emit(makeEvent(CloudKitEventKind.RECORDSAVED, recordId = recordId, recordType = record.recordType))
    return@async out
  }

  override fun fetchRecord(recordId: String): Promise<CloudKitRecord> = Promise.async {
    val fileId = withState { recordIdToFileId[recordId] }
      ?: resolveRecordIdToFileId(recordId)
      ?: throw IllegalArgumentException("Record not found: $recordId")
    val body = drive.fetchFileContent(fileId)
    val meta = drive.fetchFileMetadata(fileId)
    val recordType = meta.appProperties["solidarityRecordType"] ?: "Unknown"
    val shareId = withState { recordIdToShare[recordId] }
    return@async CloudKitRecord(
      recordId = recordId,
      recordType = recordType,
      fields = body.toString(Charsets.UTF_8),
      zoneId = null,
      shareId = shareId,
      modifiedTime = meta.modifiedTime.toDouble(),
    )
  }

  override fun deleteRecord(recordId: String): Promise<Unit> = Promise.async {
    val fileId = withState { recordIdToFileId[recordId] }
      ?: resolveRecordIdToFileId(recordId)
      ?: return@async
    drive.deleteFile(fileId)
    withState {
      recordIdToFileId.remove(recordId)
      val share = recordIdToShare.remove(recordId)
      if (share != null) shareIdToRecord.remove(share)
    }
    emit(makeEvent(CloudKitEventKind.RECORDDELETED, recordId = recordId))
  }

  override fun queryRecords(recordType: String, predicateJson: String): Promise<Array<CloudKitRecord>> = Promise.async {
    val typeFolder = ensureTypeFolder(recordType)
    // Drive query: parents '$typeFolder' in parents and not trashed.
    // We pull the file list, then download each body. Predicate matching
    // happens client-side (Drive's `q=` doesn't reach into file content);
    // callers should size their record sets accordingly.
    val q = "'$typeFolder' in parents and trashed = false and mimeType = '$RECORD_MIME'"
    val files = drive.listFiles(q)
    val predicate = parsePredicate(predicateJson)
    val out = ArrayList<CloudKitRecord>(files.size)
    for (file in files) {
      val body = try {
        drive.fetchFileContent(file.id)
      } catch (_: Throwable) {
        continue
      }
      val recordId = file.appProperties["solidarityRecordId"] ?: file.name
      withState { recordIdToFileId[recordId] = file.id }
      val fields = body.toString(Charsets.UTF_8)
      if (!predicate.matches(fields)) continue
      val shareId = withState { recordIdToShare[recordId] }
      out.add(
        CloudKitRecord(
          recordId = recordId,
          recordType = recordType,
          fields = fields,
          zoneId = null,
          shareId = shareId,
          modifiedTime = file.modifiedTime.toDouble(),
        )
      )
    }
    return@async out.toTypedArray()
  }

  // MARK: - Shared DB (Drive permissions)

  override fun createShare(
    rootRecordId: String,
    title: String,
    allowsPublicAccess: Boolean,
  ): Promise<CloudKitShareInvite> = Promise.async {
    val fileId = withState { recordIdToFileId[rootRecordId] }
      ?: resolveRecordIdToFileId(rootRecordId)
      ?: throw IllegalArgumentException("Record not found: $rootRecordId")
    val existing = withState { recordIdToShare[rootRecordId] }
    val permissionId = existing ?: drive.makeShareable(fileId, allowsPublicAccess)
    withState {
      recordIdToShare[rootRecordId] = permissionId
      shareIdToRecord[permissionId] = rootRecordId
    }
    val meta = drive.fetchFileMetadata(fileId)
    val url = meta.webViewLink ?: "https://drive.google.com/file/d/$fileId/view"
    return@async CloudKitShareInvite(
      shareId = permissionId,
      url = url,
      title = title,
      thumbnail = null,
    )
  }

  override fun acceptShare(url: String): Promise<String> = Promise.async {
    // Drive doesn't ship a programmatic "accept this share" verb — the
    // recipient simply opens the webViewLink and Drive grants access on
    // first read. We surface a synthetic share id derived from the URL so
    // the TS layer has a stable handle to refer back to.
    val derived = "drive:" + url.hashCode().toString(16)
    emit(makeEvent(CloudKitEventKind.SHAREACCEPTED, shareId = derived))
    return@async derived
  }

  override fun fetchSharedRecords(shareId: String): Promise<Array<CloudKitRecord>> = Promise.async {
    val recordId = withState { shareIdToRecord[shareId] }
      ?: return@async emptyArray()
    val fileId = withState { recordIdToFileId[recordId] }
      ?: return@async emptyArray()
    val meta = drive.fetchFileMetadata(fileId)
    val body = drive.fetchFileContent(fileId)
    val recordType = meta.appProperties["solidarityRecordType"] ?: "Unknown"
    return@async arrayOf(
      CloudKitRecord(
        recordId = recordId,
        recordType = recordType,
        fields = body.toString(Charsets.UTF_8),
        zoneId = null,
        shareId = shareId,
        modifiedTime = meta.modifiedTime.toDouble(),
      )
    )
  }

  override fun removeShare(shareId: String): Promise<Unit> = Promise.async {
    val recordId = withState { shareIdToRecord[shareId] } ?: return@async
    val fileId = withState { recordIdToFileId[recordId] } ?: return@async
    drive.removeShare(fileId, shareId)
    withState {
      recordIdToShare.remove(recordId)
      shareIdToRecord.remove(shareId)
    }
    emit(makeEvent(CloudKitEventKind.SHAREREVOKED, shareId = shareId))
  }

  // MARK: - Event listener

  override fun addEventListener(handler: (event: CloudKitEvent) -> Unit): () -> Unit {
    val id = UUID.randomUUID()
    withState { listeners[id] = handler }
    return {
      withState { listeners.remove(id) }
    }
  }

  // MARK: - File-based backup (Drive Solidarity/Backups)
  //
  // Mirrors the iOS ubiquity-container file backup. `content` is base64 of
  // the SOLB-framed AES-GCM blob; we store it as an opaque file in a
  // dedicated Drive folder so backups need no CloudKit-style schema.

  override fun writeFileBackup(filename: String, content: String): Promise<Unit> = Promise.async {
    val folder = ensureBackupFolder()
    val existing = drive.listFiles(backupQuery(folder, filename)).firstOrNull()
    val body = Base64.decode(content, Base64.NO_WRAP)
    drive.upsertFile(
      name = filename,
      mimeType = BACKUP_MIME,
      body = body,
      parents = listOf(folder),
      appProperties = mapOf("solidarityBackupFile" to filename),
      existingId = existing?.id,
    )
    emit(makeEvent(CloudKitEventKind.RECORDSAVED, recordId = filename, recordType = "FileBackup"))
  }

  override fun readFileBackup(filename: String): Promise<String> = Promise.async {
    val folder = ensureBackupFolder()
    val file = drive.listFiles(backupQuery(folder, filename)).firstOrNull()
      ?: throw IllegalArgumentException("Backup not found: $filename")
    val bytes = drive.fetchFileContent(file.id)
    return@async Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  override fun listFileBackups(): Promise<Array<String>> = Promise.async {
    val folder = ensureBackupFolder()
    val q = "'$folder' in parents and trashed = false"
    return@async drive.listFiles(q).map { it.name }.toTypedArray()
  }

  override fun deleteFileBackup(filename: String): Promise<Unit> = Promise.async {
    val folder = ensureBackupFolder()
    val file = drive.listFiles(backupQuery(folder, filename)).firstOrNull() ?: return@async
    drive.deleteFile(file.id)
    emit(makeEvent(CloudKitEventKind.RECORDDELETED, recordId = filename))
  }

  override fun getFileBackupMtime(filename: String): Promise<Double> = Promise.async {
    val folder = ensureBackupFolder()
    val file = drive.listFiles(backupQuery(folder, filename)).firstOrNull() ?: return@async 0.0
    return@async file.modifiedTime.toDouble()
  }

  override fun getFileBackupDownloadState(filename: String): Promise<FileBackupDownloadState> = Promise.async {
    // Drive keeps no local copy to wait for: `readFileBackup` streams the file
    // on demand, so an existing file is always `current` and there is never a
    // transfer whose progress could be reported. Only iOS knows `downloading`.
    val folder = ensureBackupFolder()
    val exists = drive.listFiles(backupQuery(folder, filename)).isNotEmpty()
    return@async FileBackupDownloadState(
      status = if (exists) FileBackupDownloadStatus.CURRENT else FileBackupDownloadStatus.MISSING,
      percentDownloaded = if (exists) 100.0 else null,
      errorMessage = null,
    )
  }

  override fun startFileBackupDownload(filename: String): Promise<Unit> = Promise.async {
    // Nothing to prefetch on Drive (see getFileBackupDownloadState). Only
    // check the name refers to a real file, so a typo fails here rather than
    // on the read that follows.
    val folder = ensureBackupFolder()
    if (drive.listFiles(backupQuery(folder, filename)).isEmpty()) {
      throw IllegalArgumentException("Backup not found: $filename")
    }
  }

  // MARK: - Internals

  private fun ensureRootFolder(): String {
    val existing = withState { rootFolderId }
    if (existing != null) return existing
    val id = drive.ensureFolder(ROOT_FOLDER_NAME, parentId = null)
    withState { rootFolderId = id }
    return id
  }

  private fun ensureTypeFolder(recordType: String): String {
    val existing = withState { typeFolderIds[recordType] }
    if (existing != null) return existing
    val root = ensureRootFolder()
    val id = drive.ensureFolder(recordType, parentId = root)
    withState { typeFolderIds[recordType] = id }
    return id
  }

  private fun ensureBackupFolder(): String {
    val existing = withState { backupFolderId }
    if (existing != null) return existing
    val root = ensureRootFolder()
    val id = drive.ensureFolder(BACKUP_FOLDER_NAME, parentId = root)
    withState { backupFolderId = id }
    return id
  }

  private fun backupQuery(folderId: String, filename: String): String =
    "name = '${filename.replace("'", "\\'")}' and '$folderId' in parents and trashed = false"

  /** Best-effort fallback: list the type folders and try to find the record. */
  private fun resolveRecordIdToFileId(recordId: String): String? {
    // appProperties lookup — Drive supports `appProperties has { key='x' and value='y' }`.
    val q = "appProperties has { key='solidarityRecordId' and value='$recordId' } and trashed = false"
    val files = drive.listFiles(q)
    val match = files.firstOrNull() ?: return null
    withState { recordIdToFileId[recordId] = match.id }
    return match.id
  }

  private fun parsePredicate(predicateJson: String): JsonPredicate {
    val trimmed = predicateJson.trim()
    if (trimmed.isEmpty() || trimmed == "{}") return JsonPredicate.ALWAYS
    return try {
      val obj = org.json.JSONObject(trimmed)
      val key = obj.optString("key")
      val op = obj.optString("op", "=")
      val value = obj.opt("value")?.toString()
      JsonPredicate(key, op, value)
    } catch (_: Throwable) {
      JsonPredicate.ALWAYS
    }
  }
}

/**
 * Client-side predicate evaluator. Drive cannot filter on file body, so we
 * post-filter here. The predicate format mirrors the iOS NSPredicate shape
 * (`{ key, op, value }`).
 */
internal class JsonPredicate(
  private val key: String?,
  private val op: String,
  private val rhs: String?,
) {
  fun matches(json: String): Boolean {
    if (key.isNullOrEmpty()) return true
    return try {
      val obj = org.json.JSONObject(json)
      val lhs = obj.opt(key)?.toString() ?: return false
      when (op.uppercase()) {
        "=", "==" -> lhs == rhs
        "!=" -> lhs != rhs
        "BEGINSWITH" -> rhs != null && lhs.startsWith(rhs)
        "CONTAINS" -> rhs != null && lhs.contains(rhs)
        else -> lhs == rhs
      }
    } catch (_: Throwable) {
      false
    }
  }

  companion object {
    val ALWAYS = JsonPredicate(key = null, op = "=", rhs = null)
  }
}
