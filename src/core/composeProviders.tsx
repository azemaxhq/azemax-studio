import type { ReactNode, ComponentType } from 'react';

type ProviderProps = { children: ReactNode };

/**
 * Compose nested providers into a flat API to avoid deep indentation
 * and make ordering explicit.
 *
 * Usage:
 *   const AppProviders = composeProviders(
 *     PerformanceProvider,
 *     ProjectProvider,
 *     TerminalProvider,
 *     ExplanationProvider,
 *     SettingsProvider
 *   );
 *   <AppProviders><AppContent /></AppProviders>
 */
export function composeProviders(
  ...providers: ComponentType<ProviderProps>[]
): ComponentType<ProviderProps> {
  return function Composed({ children }: ProviderProps) {
    let acc: ReactNode = children;
    for (let i = providers.length - 1; i >= 0; i--) {
      const Provider = providers[i];
      acc = <Provider>{acc}</Provider>;
    }
    return acc as React.ReactElement;
  };
}
