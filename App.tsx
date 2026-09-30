import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/contexts/AppContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';

// Intercepts and completes OAuth redirect sessions on mobile & web
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('expo-web-browser').maybeCompleteAuthSession?.();
} catch {
  // Running in Node / non-browser test environment — no-op
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppProvider>
          <AppNavigator />
        </AppProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

