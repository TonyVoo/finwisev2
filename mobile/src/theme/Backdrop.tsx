import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

/**
 * The scenery behind every screen in the cultivation appearance: a hand-painted ink-wash night (gold moon, jade-black
 * peaks, mist) under a scrim of the app's ink that deepens toward the bottom, so text above it stays as readable as on
 * plain ink. One static image, under the content, never carrying information.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PAINTING = require('../../assets/tutien-backdrop.jpg');

export function Backdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={PAINTING} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={['rgba(11,18,16,0.5)', 'rgba(11,18,16,0.55)', 'rgba(11,18,16,0.9)']}
            positions={[0, 0.45, 1]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}
