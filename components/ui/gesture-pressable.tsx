/**
 * Botón con gesto Tap y animación de escala (Reanimated).
 * Usar en lugar de Pressable cuando se quiera feedback táctil consistente en toda la app.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const springConfig = { damping: 15, stiffness: 400 };

type GesturePressableProps = {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Escala al presionar (default 0.96) */
  activeScale?: number;
};

export function GesturePressable({
  children,
  onPress,
  disabled = false,
  style,
  activeScale = 0.96,
}: GesturePressableProps) {
  const scale = useSharedValue(1);

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onBegin(() => {
      scale.value = withSpring(activeScale, springConfig);
    })
    .onFinalize((_, success) => {
      scale.value = withSpring(1, springConfig);
      if (success && !disabled) {
        runOnJS(onPress)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.6 : 1,
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}
