if(NOT TARGET ReactAndroid::hermestooling)
add_library(ReactAndroid::hermestooling SHARED IMPORTED)
set_target_properties(ReactAndroid::hermestooling PROPERTIES
    IMPORTED_LOCATION "/Users/kidney/.gradle/caches/9.3.1/transforms/6f9e22f0c697aaa3166c5b27816d5e7c/transformed/react-android-0.85.3-debug/prefab/modules/hermestooling/libs/android.x86_64/libhermestooling.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/kidney/.gradle/caches/9.3.1/transforms/6f9e22f0c697aaa3166c5b27816d5e7c/transformed/react-android-0.85.3-debug/prefab/modules/hermestooling/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::jsi)
add_library(ReactAndroid::jsi SHARED IMPORTED)
set_target_properties(ReactAndroid::jsi PROPERTIES
    IMPORTED_LOCATION "/Users/kidney/.gradle/caches/9.3.1/transforms/6f9e22f0c697aaa3166c5b27816d5e7c/transformed/react-android-0.85.3-debug/prefab/modules/jsi/libs/android.x86_64/libjsi.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/kidney/.gradle/caches/9.3.1/transforms/6f9e22f0c697aaa3166c5b27816d5e7c/transformed/react-android-0.85.3-debug/prefab/modules/jsi/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::reactnative)
add_library(ReactAndroid::reactnative SHARED IMPORTED)
set_target_properties(ReactAndroid::reactnative PROPERTIES
    IMPORTED_LOCATION "/Users/kidney/.gradle/caches/9.3.1/transforms/6f9e22f0c697aaa3166c5b27816d5e7c/transformed/react-android-0.85.3-debug/prefab/modules/reactnative/libs/android.x86_64/libreactnative.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/kidney/.gradle/caches/9.3.1/transforms/6f9e22f0c697aaa3166c5b27816d5e7c/transformed/react-android-0.85.3-debug/prefab/modules/reactnative/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

