/**
 * AppErrorBoundary — the app-wide JS safety net, wrapped around the router
 * `<Stack>` in `app/_layout.tsx`.
 *
 * SCOPE — read this before assuming it will catch a given crash:
 *   ✓ JS *render* throws in any screen (incl. "Maximum update depth exceeded"
 *     from a render loop) → themed screen that NAMES the offending component
 *     via `componentDidCatch`'s component stack ("in DagGraph3D (at dag.tsx:…)").
 *   ✓ uncaught JS errors off the render path (timers, events, un-awaited
 *     rejects) → global `ErrorUtils` handler below (logged).
 *   ✗ NATIVE crashes — a TurboModule raising an NSException on its own queue, a
 *     worklet throwing out of VisionCamera's async-runner, a C++ abort —
 *     terminate the process; JS never sees them. Those are NAMED for you in the
 *     crash report by `MrzInstallCrashDiagnostics` (nitro-modules/attest/ios/
 *     MrzVisionGuard.mm) and must be fixed at the call site.
 *
 * We show the **component stack on screen** on purpose: a render loop used to
 * either freeze the screen or (old builds) cascade into a native crash with no
 * hint of where. Now it self-identifies without needing `sudo log collect`.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';

// --- Global uncaught-JS-error handler, installed once when this module loads
// (the import in app/_layout.tsx pulls it in at boot). Logs with a greppable
// tag, then chains to the previous handler so dev redboxes and the native fatal
// path are preserved. It does NOT swallow — silently eating errors is exactly
// what made earlier crashes take hours to find.
interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}
const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
if (errorUtils?.setGlobalHandler) {
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[solidarity:uncaught]${isFatal ? ' FATAL' : ''} ${err.message}\n${err.stack ?? ''}`,
    );
    previous?.(error, isFatal);
  });
}

interface Props {
  readonly children: ReactNode;
}
interface State {
  readonly error: Error | null;
  readonly componentStack: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = info.componentStack ?? '';
    // The component stack is the single most useful line for a render loop /
    // render throw — log it (greppable) AND keep it in state to show on screen.
    console.error(`[solidarity:render-error] ${error.message}\n${stack}`);
    this.setState({ componentStack: stack });
  }

  private readonly reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error == null) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.pageBg,
          paddingTop: 80,
          paddingHorizontal: 24,
          paddingBottom: 32,
        }}
      >
        <Text style={{ color: Colors.text1, fontSize: 20, fontWeight: '700', marginBottom: 8 }}>
          Something went wrong
        </Text>
        <Text style={{ color: Colors.text2, fontSize: 13, marginBottom: 16 }}>
          {error.message || 'Unexpected error'}
        </Text>
        <ScrollView
          style={{ flex: 1, marginBottom: 16 }}
          contentContainerStyle={{ paddingBottom: 12 }}
        >
          <Text selectable style={{ color: Colors.text3, fontSize: 11, fontFamily: 'Menlo' }}>
            {componentStack || error.stack || '(no stack)'}
          </Text>
        </ScrollView>
        <ThemedButton label="Try again" variant="primary" fullWidth onPress={this.reset} />
      </View>
    );
  }
}
