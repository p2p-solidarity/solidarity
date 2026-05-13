import Testing
@testable import solidarity

struct DataSyncSettingsViewTests {
  @Test func testIdentityKeyRecoverySectionIsDevOnlyAndLast() {
    #expect(DataSyncSettingsView.sections(isDeveloperMode: false) == [
      .syncBackup,
      .importExport,
    ])

    #expect(DataSyncSettingsView.sections(isDeveloperMode: true) == [
      .syncBackup,
      .importExport,
      .identityKeyRecovery,
    ])
  }
}
