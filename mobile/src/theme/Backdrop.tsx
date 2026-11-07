import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { TUTIEN_INK } from './tokens';

/**
 * The scenery behind every screen in the cultivation appearance: a night sky, a gold moon, three ridges of mountains
 * in jade-black, and mist between them. One static canvas drawn once per window size (no animation, no images), under
 * the content, never carrying information, and kept dark and low in contrast so text above it stays as readable as on
 * plain ink.
 */

function ridge(width: number, height: number, base: number, amplitude: number, seed: number) {
  const path = Skia.Path.Make();
  path.moveTo(0, height);
  const step = Math.max(6, width / 60);
  for (let x = 0; x <= width + step; x += step) {
    const t = x / width;
    // Sharp peaks (abs of a sine) over a slow swell: the silhouette of a mountain range, not a wave.
    const peaks =
      Math.abs(Math.sin(t * 7.3 + seed)) * 0.55 +
      Math.abs(Math.sin(t * 13.1 + seed * 2.1)) * 0.3 +
      Math.sin(t * 3.1 + seed * 0.7) * 0.15;
    path.lineTo(x, base - amplitude * peaks);
  }
  path.lineTo(width + step, height);
  path.close();
  return path;
}

export function Backdrop() {
  const { width, height } = useWindowDimensions();
  const ridges = useMemo(
    () => [
      {
        path: ridge(width, height, height * 0.66, height * 0.1, 1.2),
        color: '#101C19',
        opacity: 0.9,
      },
      {
        path: ridge(width, height, height * 0.77, height * 0.09, 3.4),
        color: '#0C1513',
        opacity: 0.95,
      },
      {
        path: ridge(width, height, height * 0.88, height * 0.07, 5.8),
        color: '#08100E',
        opacity: 1,
      },
    ],
    [width, height],
  );
  const stars = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        x: ((i * 97) % 100) / 100,
        y: (((i * 53) % 60) / 100) * 0.9,
        r: 0.6 + ((i * 7) % 3) * 0.35,
      })),
    [],
  );

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={[TUTIEN_INK, '#0D1513', TUTIEN_INK]}
        />
      </Rect>

      {stars.map((s, i) => (
        <Circle key={i} cx={s.x * width} cy={s.y * height} r={s.r} color="rgba(239,230,207,0.35)" />
      ))}

      {/* The moon, with a wide faint halo. */}
      <Circle cx={width * 0.74} cy={height * 0.085} r={150}>
        <RadialGradient
          c={vec(width * 0.74, height * 0.085)}
          r={150}
          colors={['rgba(216,178,94,0.22)', 'rgba(216,178,94,0)']}
        />
      </Circle>
      <Circle cx={width * 0.74} cy={height * 0.085} r={20} color="rgba(232,205,140,0.78)" />

      {ridges.map((r, i) => (
        <Group key={i}>
          <Path path={r.path} color={r.color} opacity={r.opacity} />
          {/* Mist lying in the valley in front of each ridge. */}
          <Rect x={0} y={height * (0.62 + i * 0.1)} width={width} height={height * 0.12}>
            <LinearGradient
              start={vec(0, height * (0.62 + i * 0.1))}
              end={vec(0, height * (0.74 + i * 0.1))}
              colors={['rgba(170,195,185,0)', 'rgba(170,195,185,0.06)', 'rgba(170,195,185,0)']}
            />
          </Rect>
        </Group>
      ))}
    </Canvas>
  );
}
