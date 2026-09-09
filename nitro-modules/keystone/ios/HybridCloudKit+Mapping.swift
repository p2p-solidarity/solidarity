//
//  HybridCloudKit+Mapping.swift
//  @solidarity/nitro-cloudkit (iOS)
//
//  Translates between the Nitro `CloudKitRecord` struct (which carries
//  fields as a single JSON-encoded string) and Apple's `CKRecord`.
//
//  Why JSON in the Nitro layer:
//    Nitrogen cannot codegen an open-ended `Record<string, unknown>` type
//    over the Swift↔C++ bridge. JSON is the lowest common denominator and
//    keeps the bridge static-typed while letting the TS layer evolve the
//    field schema freely. The cost is one JSONSerialization round-trip per
//    record; in practice each record is < 4 KB.
//
//  Type rules:
//    - String  → CKRecord string
//    - Bool    → CKRecord NSNumber(bool)
//    - Number  → CKRecord NSNumber(double)
//    - Array   → CKRecord NSArray (each element re-encoded recursively)
//    - Dict    → re-encoded as JSON sub-string under the same key + ".json"
//      suffix (avoids the need for nested CKRecord references on v1).
//
//  Reserved field names (stripped from the JSON before save):
//    `__recordId`, `__zoneId`, `__shareId`, `__modifiedAt` — the Nitro
//    struct carries these out-of-band already.
//

import CloudKit
import Foundation

#if canImport(CoreLocation)
  import CoreLocation
#endif

extension HybridCloudKit {

  /// Build a `CKRecord` from a Nitro `CloudKitRecord`.
  internal func makeCkRecord(
    from record: CloudKitRecord,
    in zoneId: CKRecordZone.ID
  ) throws -> CKRecord {
    let recordId: CKRecord.ID
    if record.recordId.isEmpty {
      recordId = CKRecord.ID(recordName: UUID().uuidString, zoneID: zoneId)
    } else {
      recordId = CKRecord.ID(recordName: record.recordId, zoneID: zoneId)
    }
    let ck = CKRecord(recordType: record.recordType, recordID: recordId)
    try populate(ck, fromJsonString: record.fields)
    return ck
  }

  /// Build a Nitro `CloudKitRecord` from a `CKRecord`. Optionally annotate
  /// with the share id this record belongs to.
  internal func makeNitroRecord(
    from record: CKRecord,
    shareId: String? = nil
  ) throws -> CloudKitRecord {
    let fieldsJson = encodeFields(record)
    let modifiedTime = (record.modificationDate?.timeIntervalSince1970 ?? 0) * 1000
    return CloudKitRecord(
      recordId: record.recordID.recordName,
      recordType: record.recordType,
      fields: fieldsJson,
      zoneId: record.recordID.zoneID.zoneName,
      shareId: shareId,
      modifiedTime: modifiedTime
    )
  }

  // MARK: - JSON ↔ CKRecord

  internal func populate(_ record: CKRecord, fromJsonString json: String) throws {
    guard let data = json.data(using: .utf8) else { return }
    let parsed = try JSONSerialization.jsonObject(with: data, options: [])
    guard let dict = parsed as? [String: Any] else { return }
    let reserved: Set<String> = [
      "__recordId", "__zoneId", "__shareId", "__modifiedAt",
    ]
    for (key, value) in dict where !reserved.contains(key) {
      record[key] = try toCkValue(value, parentKey: key)
    }
  }

  /// Recursively unwrap a JSON value into a CloudKit-acceptable
  /// `CKRecordValue`. Nested dicts are flattened to JSON sub-strings.
  internal func toCkValue(_ value: Any, parentKey: String) throws -> CKRecordValue {
    if let str = value as? String { return str as CKRecordValue }
    if let bool = value as? Bool { return NSNumber(value: bool) }
    if let num = value as? NSNumber { return num }
    if let arr = value as? [Any] {
      var mapped: [CKRecordValue] = []
      mapped.reserveCapacity(arr.count)
      for (idx, item) in arr.enumerated() {
        mapped.append(try toCkValue(item, parentKey: "\(parentKey)[\(idx)]"))
      }
      return mapped as CKRecordValue
    }
    if let dict = value as? [String: Any] {
      let json = try JSONSerialization.data(withJSONObject: dict, options: [])
      let s = String(data: json, encoding: .utf8) ?? "{}"
      return s as CKRecordValue
    }
    if value is NSNull { return "" as CKRecordValue }
    // Fall back to the string representation so we never crash on
    // unrecognised JSON primitives.
    return String(describing: value) as CKRecordValue
  }

  /// Encode a CKRecord's public fields back into a JSON string.
  internal func encodeFields(_ record: CKRecord) -> String {
    var out: [String: Any] = [:]
    for key in record.allKeys() {
      let value = record[key]
      out[key] = fromCkValue(value)
    }
    do {
      let data = try JSONSerialization.data(
        withJSONObject: out,
        options: [.sortedKeys]
      )
      return String(data: data, encoding: .utf8) ?? "{}"
    } catch {
      return "{}"
    }
  }

  internal func fromCkValue(_ value: Any?) -> Any {
    guard let value = value else { return NSNull() }
    if let str = value as? String { return str }
    if let arr = value as? [Any] { return arr.map { self.fromCkValue($0) } }
    if let num = value as? NSNumber { return num }
    if let date = value as? Date { return date.timeIntervalSince1970 * 1000 }
    if let data = value as? Data { return data.base64EncodedString() }
    if let ref = value as? CKRecord.Reference { return ref.recordID.recordName }
    if let location = value as? CLLocation {
      return [
        "lat": location.coordinate.latitude,
        "lng": location.coordinate.longitude,
      ]
    }
    return String(describing: value)
  }

  // MARK: - Predicate

  /// Parse a `{ key, op, value }` JSON predicate. Falls back to TRUEPREDICATE
  /// when the JSON is missing or malformed — keeps the API safe to call
  /// with `"{}"` for "fetch all".
  internal func predicate(fromJson json: String) -> NSPredicate {
    let trimmed = json.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed == "{}" { return NSPredicate(value: true) }
    guard let data = trimmed.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
      let dict = parsed as? [String: Any],
      let key = dict["key"] as? String
    else {
      return NSPredicate(value: true)
    }
    let op = (dict["op"] as? String ?? "=").uppercased()
    let raw = dict["value"]
    let value = wrapForPredicate(raw)
    let format: String
    switch op {
    case "=", "==": format = "%K == %@"
    case "!=":     format = "%K != %@"
    case "<":       format = "%K < %@"
    case "<=":      format = "%K <= %@"
    case ">":       format = "%K > %@"
    case ">=":      format = "%K >= %@"
    case "BEGINSWITH": format = "%K BEGINSWITH %@"
    case "CONTAINS":   format = "%K CONTAINS %@"
    case "IN":         format = "%K IN %@"
    default: format = "%K == %@"
    }
    return NSPredicate(format: format, argumentArray: [key, value])
  }

  internal func wrapForPredicate(_ raw: Any?) -> NSObject {
    if let value = raw as? String { return value as NSString }
    if let value = raw as? Bool { return NSNumber(value: value) }
    if let value = raw as? NSNumber { return value }
    if let value = raw as? [Any] {
      return value.compactMap { $0 as? AnyHashable } as NSArray
    }
    return "" as NSString
  }
}
