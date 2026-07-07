module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin DEBE ir último (worklets).
    plugins: ['react-native-reanimated/plugin'],
  };
};
