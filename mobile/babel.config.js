/**
 * `babel-preset-expo` already covers TypeScript, JSX and the expo-router plugin.
 * `react-native-worklets/plugin` is required by react-native-reanimated v4 and must
 * stay last in the plugin list.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
