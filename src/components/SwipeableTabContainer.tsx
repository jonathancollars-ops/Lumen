import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Animated,
  StyleProp,
  ViewStyle,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Sequência canônica das 5 abas principais do Project Lumen
 */
export const TAB_ORDER = [
  'Agenda',
  'Estudos',
  'Desempenho',
  'Faltas',
  'Notas',
] as const;

export type TabName = typeof TAB_ORDER[number];

/**
 * Retorna a próxima aba à direita ou null se estiver na última
 */
export function getNextTab(currentTab: string): TabName | null {
  const idx = TAB_ORDER.indexOf(currentTab as TabName);
  if (idx >= 0 && idx < TAB_ORDER.length - 1) {
    return TAB_ORDER[idx + 1];
  }
  return null;
}

/**
 * Retorna a aba anterior à esquerda ou null se estiver na primeira
 */
export function getPrevTab(currentTab: string): TabName | null {
  const idx = TAB_ORDER.indexOf(currentTab as TabName);
  if (idx > 0) {
    return TAB_ORDER[idx - 1];
  }
  return null;
}

export interface SwipeableTabContextType {
  setSwipeDisabled: (disabled: boolean) => void;
}

export const SwipeableTabContext = React.createContext<SwipeableTabContextType>({
  setSwipeDisabled: () => {},
});

export const useSwipeableTabs = () => React.useContext(SwipeableTabContext);

export interface SwipeableTabContainerProps {
  currentTab: TabName | string;
  onNavigateTab?: (tabName: string) => void;
  disabled?: boolean;
  threshold?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * SwipeableTabContainer
 * Habilita transição lateral fluida a 120 Hz/60 Hz entre as abas principais via UI Thread.
 * Trata limites de borda, rejeição de scrolls verticais e feedback tátil leve.
 */
export const SwipeableTabContainer: React.FC<SwipeableTabContainerProps> = ({
  currentTab,
  onNavigateTab,
  disabled = false,
  threshold = 60,
  style,
  children,
}) => {
  const [internalDisabled, setInternalDisabled] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipingRef = useRef(false);

  const currentIndex = useMemo(() => {
    const idx = TAB_ORDER.indexOf(currentTab as TabName);
    return idx >= 0 ? idx : 0;
  }, [currentTab]);

  // Mantém refs atualizadas para os manipuladores do PanResponder
  const stateRef = useRef({
    currentIndex,
    disabled: Boolean(disabled || internalDisabled || Platform.OS === 'web'),
    onNavigateTab,
    threshold,
  });

  useEffect(() => {
    stateRef.current = {
      currentIndex,
      disabled: Boolean(disabled || internalDisabled || Platform.OS === 'web'),
      onNavigateTab,
      threshold,
    };
  }, [currentIndex, disabled, internalDisabled, onNavigateTab, threshold]);

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      onMoveShouldSetPanResponder: (_, gestureState) => {
        const { disabled: isGestureDisabled, currentIndex: activeIdx } = stateRef.current;
        if (isGestureDisabled) return false;

        const { dx, dy } = gestureState;
        // Prioriza o gesto horizontal caso dx seja significativamente maior que dy
        const isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
        const hasMovedEnough = Math.abs(dx) > 12;

        if (!isHorizontal || !hasMovedEnough) {
          return false;
        }

        // Exceções de ponta: não arrastar para a direita na primeira aba
        if (activeIdx === 0 && dx > 0) {
          return false;
        }
        // Exceções de ponta: não arrastar para a esquerda na última aba
        if (activeIdx === TAB_ORDER.length - 1 && dx < 0) {
          return false;
        }

        return true;
      },
      onMoveShouldSetPanResponderCapture: () => false,

      onPanResponderGrant: () => {
        isSwipingRef.current = true;
        translateX.stopAnimation();
      },

      onPanResponderMove: (_, gestureState) => {
        const { currentIndex: activeIdx } = stateRef.current;
        let { dx } = gestureState;

        // Limita o deslocamento nas extremidades da navegação
        if (activeIdx === 0 && dx > 0) {
          dx = 0;
        } else if (activeIdx === TAB_ORDER.length - 1 && dx < 0) {
          dx = 0;
        }

        translateX.setValue(dx);
      },

      onPanResponderRelease: (_, gestureState) => {
        const {
          currentIndex: activeIdx,
          threshold: swipeThreshold,
          onNavigateTab: navCallback,
        } = stateRef.current;

        const { dx, vx } = gestureState;

        // Arrastar para esquerda (dx negativo): próxima aba à direita
        const isSwipeLeft = dx <= -swipeThreshold || (dx < -30 && vx < -0.5);
        // Arrastar para direita (dx positivo): aba anterior à esquerda
        const isSwipeRight = dx >= swipeThreshold || (dx > 30 && vx > 0.5);

        let targetTab: TabName | null = null;

        if (isSwipeLeft && activeIdx < TAB_ORDER.length - 1) {
          targetTab = TAB_ORDER[activeIdx + 1];
        } else if (isSwipeRight && activeIdx > 0) {
          targetTab = TAB_ORDER[activeIdx - 1];
        }

        if (targetTab) {
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {
            // Ignora ausência de módulo háptico em ambientes virtuais/web
          }

          if (navCallback) {
            navCallback(targetTab);
          }
        }

        // Retorno elástico suave animado diretamente na thread nativa (120 Hz)
        Animated.spring(translateX, {
          toValue: 0,
          friction: 7,
          tension: 40,
          useNativeDriver: true,
        }).start(() => {
          isSwipingRef.current = false;
        });
      },

      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          friction: 7,
          tension: 40,
          useNativeDriver: true,
        }).start(() => {
          isSwipingRef.current = false;
        });
      },
    });
  }, [translateX]);

  const contextValue = useMemo(
    () => ({
      setSwipeDisabled: setInternalDisabled,
    }),
    [],
  );

  return (
    <SwipeableTabContext.Provider value={contextValue}>
      <Animated.View
        style={[
          styles.container,
          style,
          {
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </SwipeableTabContext.Provider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    minWidth: 0,
    minHeight: 0,
  },
});
