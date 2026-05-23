// react-native.config.js
// @solidarity/nitro-cloudkit
//
// iOS picks up the podspec at the package root; Android picks up the
// gradle module in ./android. Both platforms are autolinked by Expo's
// expo-modules-autolinking via this dependency descriptor.

module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: './android',
      },
    },
  },
};
