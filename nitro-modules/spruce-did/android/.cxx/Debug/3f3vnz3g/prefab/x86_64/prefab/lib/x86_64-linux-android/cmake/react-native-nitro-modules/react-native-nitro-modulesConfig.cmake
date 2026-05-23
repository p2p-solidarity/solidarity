if(NOT TARGET react-native-nitro-modules::NitroModules)
add_library(react-native-nitro-modules::NitroModules SHARED IMPORTED)
set_target_properties(react-native-nitro-modules::NitroModules PROPERTIES
    IMPORTED_LOCATION "/Users/kidney/Workspace/Work/solidarity/airmeishi/node_modules/react-native-nitro-modules/android/build/intermediates/cxx/Debug/4h6l6x1u/obj/x86_64/libNitroModules.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/kidney/Workspace/Work/solidarity/airmeishi/node_modules/react-native-nitro-modules/android/build/headers/nitromodules"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

