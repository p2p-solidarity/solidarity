// react-native.config.js
// @solidarity/nitro-nfc-passport
//
// Tells the React Native CLI / expo-modules-autolinking how to wire this
// package on each platform. iOS uses the podspec at the package root;
// Android uses the android/ directory we set up alongside it.

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
