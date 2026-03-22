//
//  ZIPWriter.swift
//  airmeishi
//
//  Simple ZIP file creator for .pkpass generation
//

import Foundation

/// Simple ZIP archive writer for creating .pkpass files
struct ZIPWriter {

  /// Create a ZIP archive from files
  static func createArchive(files: [(name: String, data: Data)]) throws -> Data {
    var archive = Data()
    var centralDirectory = Data()
    var centralDirectoryOffset: UInt32 = 0

    for file in files {
      // Local file header
      let localHeader = createLocalFileHeader(
        filename: file.name,
        uncompressedSize: UInt32(file.data.count),
        crc32: calculateCRC32(file.data)
      )

      let localHeaderOffset = UInt32(archive.count)

      // Write local file header + filename + data (uncompressed)
      archive.append(localHeader)
      archive.append(Data(file.name.utf8))
      archive.append(file.data)

      // Central directory file header
      let centralDirHeader = createCentralDirectoryHeader(
        filename: file.name,
        uncompressedSize: UInt32(file.data.count),
        crc32: calculateCRC32(file.data),
        localHeaderOffset: localHeaderOffset
      )

      centralDirectory.append(centralDirHeader)
      centralDirectory.append(Data(file.name.utf8))
    }

    centralDirectoryOffset = UInt32(archive.count)
    archive.append(centralDirectory)

    // End of central directory record
    let endRecord = createEndOfCentralDirectoryRecord(
      numberOfEntries: UInt16(files.count),
      centralDirectorySize: UInt32(centralDirectory.count),
      centralDirectoryOffset: centralDirectoryOffset
    )
    archive.append(endRecord)

    return archive
  }

  // MARK: - ZIP Structure Creation

  private static func createLocalFileHeader(
    filename: String,
    uncompressedSize: UInt32,
    crc32: UInt32
  ) -> Data {
    var header = Data()

    // Local file header signature
    header.append(contentsOf: [0x50, 0x4B, 0x03, 0x04])

    // Version needed to extract (2.0)
    header.append(contentsOf: [0x14, 0x00])

    // General purpose bit flag
    header.append(contentsOf: [0x00, 0x00])

    // Compression method (0 = no compression)
    header.append(contentsOf: [0x00, 0x00])

    // File last modification time
    header.append(contentsOf: [0x00, 0x00])

    // File last modification date
    header.append(contentsOf: [0x00, 0x21])

    // CRC-32
    header.append(UInt32ToBytes(crc32))

    // Compressed size
    header.append(UInt32ToBytes(uncompressedSize))

    // Uncompressed size
    header.append(UInt32ToBytes(uncompressedSize))

    // Filename length
    let filenameData = Data(filename.utf8)
    header.append(UInt16ToBytes(UInt16(filenameData.count)))

    // Extra field length
    header.append(contentsOf: [0x00, 0x00])

    return header
  }

  private static func createCentralDirectoryHeader(
    filename: String,
    uncompressedSize: UInt32,
    crc32: UInt32,
    localHeaderOffset: UInt32
  ) -> Data {
    var header = Data()

    // Central directory file header signature
    header.append(contentsOf: [0x50, 0x4B, 0x01, 0x02])

    // Version made by
    header.append(contentsOf: [0x14, 0x00])

    // Version needed to extract
    header.append(contentsOf: [0x14, 0x00])

    // General purpose bit flag
    header.append(contentsOf: [0x00, 0x00])

    // Compression method
    header.append(contentsOf: [0x00, 0x00])

    // File last modification time
    header.append(contentsOf: [0x00, 0x00])

    // File last modification date
    header.append(contentsOf: [0x00, 0x21])

    // CRC-32
    header.append(UInt32ToBytes(crc32))

    // Compressed size
    header.append(UInt32ToBytes(uncompressedSize))

    // Uncompressed size
    header.append(UInt32ToBytes(uncompressedSize))

    // Filename length
    let filenameData = Data(filename.utf8)
    header.append(UInt16ToBytes(UInt16(filenameData.count)))

    // Extra field length
    header.append(contentsOf: [0x00, 0x00])

    // File comment length
    header.append(contentsOf: [0x00, 0x00])

    // Disk number start
    header.append(contentsOf: [0x00, 0x00])

    // Internal file attributes
    header.append(contentsOf: [0x00, 0x00])

    // External file attributes
    header.append(contentsOf: [0x00, 0x00, 0x00, 0x00])

    // Relative offset of local header
    header.append(UInt32ToBytes(localHeaderOffset))

    return header
  }

  private static func createEndOfCentralDirectoryRecord(
    numberOfEntries: UInt16,
    centralDirectorySize: UInt32,
    centralDirectoryOffset: UInt32
  ) -> Data {
    var record = Data()

    // End of central directory signature
    record.append(contentsOf: [0x50, 0x4B, 0x05, 0x06])

    // Number of this disk
    record.append(contentsOf: [0x00, 0x00])

    // Disk where central directory starts
    record.append(contentsOf: [0x00, 0x00])

    // Number of central directory records on this disk
    record.append(UInt16ToBytes(numberOfEntries))

    // Total number of central directory records
    record.append(UInt16ToBytes(numberOfEntries))

    // Size of central directory
    record.append(UInt32ToBytes(centralDirectorySize))

    // Offset of start of central directory
    record.append(UInt32ToBytes(centralDirectoryOffset))

    // ZIP file comment length
    record.append(contentsOf: [0x00, 0x00])

    return record
  }

  // MARK: - Helper Functions

  private static func UInt16ToBytes(_ value: UInt16) -> Data {
    var bytes = value.littleEndian
    return Data(bytes: &bytes, count: 2)
  }

  private static func UInt32ToBytes(_ value: UInt32) -> Data {
    var bytes = value.littleEndian
    return Data(bytes: &bytes, count: 4)
  }

  /// Calculate CRC32 checksum
  static func calculateCRC32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF

    for byte in data {
      let index = Int((crc ^ UInt32(byte)) & 0xFF)
      crc = (crc >> 8) ^ crc32Table[index]
    }

    return ~crc
  }

  // CRC32 lookup table (standard)
  private static let crc32Table: [UInt32] = {
    (0...255)
      .map { i -> UInt32 in
        var crc = UInt32(i)
        for _ in 0..<8 {
          crc = (crc & 1 == 1) ? ((crc >> 1) ^ 0xEDB8_8320) : (crc >> 1)
        }
        return crc
      }
  }()
}
