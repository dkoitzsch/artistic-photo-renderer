import type { ReactNode } from 'react';
import { BrushIcon, EyedropperIcon, FocusIcon, HandIcon, MoveIcon, SmartSelectIcon } from './Icons';

type Tool = { id: string; label: string; icon: ReactNode; phase?: number };

const TOOLS: Tool[] = [
  { id: 'move', label: 'Verschieben (V)', icon: <MoveIcon /> },
  { id: 'brush', label: 'Pinsel (B)', icon: <BrushIcon />, phase: 5 },
  { id: 'smart', label: 'Smarte Auswahl', icon: <SmartSelectIcon />, phase: 5 },
  { id: 'focus', label: 'Fokuspunkt', icon: <FocusIcon />, phase: 2 },
  { id: 'eyedropper', label: 'Pipette', icon: <EyedropperIcon />, phase: 1 },
  { id: 'hand', label: 'Hand (Leertaste)', icon: <HandIcon />, phase: 1 },
];

export function ToolBar() {
  return (
    <nav className="toolbar" aria-label="Werkzeuge">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`icon-button tool${tool.id === 'move' ? ' active' : ''}`}
          disabled={tool.phase !== undefined}
          title={tool.phase !== undefined ? `${tool.label} – ab Phase ${tool.phase}` : tool.label}
          aria-label={tool.label}
        >
          {tool.icon}
        </button>
      ))}
    </nav>
  );
}
