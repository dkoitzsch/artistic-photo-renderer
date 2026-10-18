import type { ReactNode } from 'react';
import { useAppStore, type Tool as ToolId } from '../../state/store';
import { BrushIcon, EyedropperIcon, FocusIcon, HandIcon, MoveIcon, SmartSelectIcon } from './Icons';

type Tool = { id: string; label: string; icon: ReactNode; phase?: number; tool?: ToolId };

const TOOLS: Tool[] = [
  { id: 'move', label: 'Verschieben (V)', icon: <MoveIcon />, tool: 'move' },
  { id: 'brush', label: 'Pinsel (B)', icon: <BrushIcon />, tool: 'brush' },
  { id: 'smart', label: 'Smarte Auswahl (W)', icon: <SmartSelectIcon />, tool: 'smart' },
  { id: 'focus', label: 'Fokuspunkt (F)', icon: <FocusIcon />, tool: 'focus' },
  { id: 'eyedropper', label: 'Pipette', icon: <EyedropperIcon />, phase: 1 },
  { id: 'hand', label: 'Hand (Leertaste)', icon: <HandIcon />, phase: 1 },
];

export function ToolBar() {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  return (
    <nav className="toolbar" aria-label="Werkzeuge">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`icon-button tool${t.tool === tool ? ' active' : ''}`}
          disabled={t.phase !== undefined}
          onClick={() => {
            if (t.tool) setTool(t.tool);
          }}
          data-testid={`tool-${t.id}`}
          title={t.phase !== undefined ? `${t.label} – ab Phase ${t.phase}` : t.label}
          aria-label={t.label}
        >
          {t.icon}
        </button>
      ))}
    </nav>
  );
}
