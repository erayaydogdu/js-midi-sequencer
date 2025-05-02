
import type React from 'react';
import { cn } from '@/lib/utils';
import type { Step } from '@/types/sequencer';
import { Button } from '@/components/ui/button';

interface StepGridProps {
  steps: Step[];
  currentStepIndex: number | null;
  selectedStepId: string | null;
  onStepClick: (stepId: string) => void;
}

const StepGrid: React.FC<StepGridProps> = ({
  steps,
  currentStepIndex,
  selectedStepId,
  onStepClick,
}) => {
  return (
    <div className="grid grid-cols-16 gap-1 p-2 bg-card rounded-md shadow-inner">
      {steps.map((step, index) => {
        const isActive = currentStepIndex === index;
        const isSelected = selectedStepId === step.id;
        // Highlight groups of 4 for readability
        const isGroupStart = index % 4 === 0;

        return (
          <Button
            key={step.id}
            variant="outline"
            size="sm"
            className={cn(
              'aspect-square h-auto w-full p-0 text-xs transition-colors duration-50', // Faster transition for active step
              'border border-border hover:bg-accent/50 focus:ring-accent',
              step.enabled ? 'bg-primary/30 text-primary-foreground' : 'bg-background/50 text-muted-foreground', // Enabled vs Disabled step
              isSelected ? 'ring-2 ring-offset-1 ring-accent !bg-accent text-accent-foreground' : '', // Selected step
              isActive ? '!bg-accent/80 animate-pulse-step' : '', // Active playing step
              isGroupStart && index !== 0 ? 'ml-1' : '' // Add margin for group separation
            )}
            onClick={() => onStepClick(step.id)}
            aria-pressed={step.enabled}
            aria-label={`Step ${index + 1}`}
          >
            {/* Display note name if enabled, otherwise step number */}
            {/* {step.enabled && step.notePitch !== undefined ? `${notenames[step.notePitch % 12]}${Math.floor(step.notePitch / 12)}` : index + 1} */}
             {index + 1} {/* Simplified display */}
          </Button>
        );
      })}
      {/* Keyframes for pulse effect */}
      <style jsx>{`
        @keyframes pulse-step {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        .animate-pulse-step {
          animation: pulse-step 0.3s ease-in-out;
        }
        .grid-cols-16 {
          grid-template-columns: repeat(16, minmax(0, 1fr));
        }
      `}</style>
    </div>
  );
};

// Helper for note names (optional, can be moved to utils)
const notenames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];


export default StepGrid;
