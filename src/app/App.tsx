import { useEffect } from 'react';
import { initRuntime } from '../render/runtime';
import { useAppStore } from '../state/store';
import { BottomPanel } from './components/BottomPanel';
import { CanvasView } from './components/CanvasView';
import { SidePanel } from './components/SidePanel';
import { ToolBar } from './components/ToolBar';
import { TopBar } from './components/TopBar';
import { useShortcuts } from './shortcuts';
import { useApplyTheme } from './theme/theme';

export function App() {
  const theme = useApplyTheme();
  useShortcuts();

  useEffect(() => {
    const { setGpu } = useAppStore.getState();
    void initRuntime((reason) => {
      setGpu({ state: 'lost', reason });
    }).then((result) => {
      if (result.kind === 'webgpu') {
        setGpu({ state: 'ready', info: result.info, maxTextureSize: result.limits.maxTextureDimension2D });
      } else {
        setGpu({ state: 'unavailable', webgl2: result.kind === 'webgl2', reason: result.reason });
      }
    });
  }, []);

  return (
    <div className="app">
      <TopBar theme={theme} />
      <div className="workspace">
        <ToolBar />
        <CanvasView theme={theme} />
        <SidePanel />
      </div>
      <BottomPanel />
    </div>
  );
}
