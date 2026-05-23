// dummy.cpp — empty TU so add_library() succeeds before the nitrogen
// autolinking cmake appends its own sources via target_sources(). The
// nitrogen-generated SolidarityCloudKitOnLoad.cpp is the actual entry
// point (provides JNI_OnLoad via fbjni).
