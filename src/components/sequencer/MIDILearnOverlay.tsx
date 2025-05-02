
import type React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MidiAssignments } from '@/types/sequencer';
import { useState, useEffect, type ChangeEvent } from 'react';

interface MIDILearnOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentAssignments: MidiAssignments;
  onSaveAssignments: (assignments: MidiAssignments) => void;
  lastLearnedControl: number | null;
}

// Define the order and labels for the controls to learn
const controlsToLearn: Array<{ name: keyof MidiAssignments; label: string }> = [
    { name: 'setup_play', label: 'Play Button' },
    { name: 'setup_stop', label: 'Stop Button' },
    { name: 'setup_pattern', label: 'Pattern/Track Toggle Button' },
    { name: 'setup_copy', label: 'Copy/Paste/Mute Button' },
    { name: 'setup_clear', label: 'Clear Button' },
    { name: 'setup_tempo', label: 'Tempo Knob/Slider' },
    { name: 'setup_swing', label: 'Swing Knob/Slider' },
    { name: 'setup_notepitch', label: 'Note Pitch Knob/Slider' },
    { name: 'setup_velocity', label: 'Velocity Knob/Slider' },
    { name: 'setup_notelength', label: 'Note Length Knob/Slider' },
    // Add steps and tracks dynamically or list them explicitly if fixed
    ...Array.from({ length: 16 }, (_, i) => ({ name: `setup_step${i + 1}` as keyof MidiAssignments, label: `Step Button ${i + 1}` })),
    ...Array.from({ length: 8 }, (_, i) => ({ name: `setup_track${i + 1}` as keyof MidiAssignments, label: `Track/Pattern Button ${i + 1}` })),
];


const MIDILearnOverlay: React.FC<MIDILearnOverlayProps> = ({
  isOpen,
  onClose,
  currentAssignments,
  onSaveAssignments,
  lastLearnedControl,
}) => {
  const [assignments, setAssignments] = useState<MidiAssignments>(currentAssignments);
  const [currentControlIndex, setCurrentControlIndex] = useState(0);
  const [focusedInput, setFocusedInput] = useState<keyof MidiAssignments | null>(null);

   // Update local state when currentAssignments prop changes
   useEffect(() => {
    setAssignments(currentAssignments);
    // Reset index if needed, or find the first unassigned control
     const firstUnassigned = controlsToLearn.findIndex(c => !currentAssignments[c.name]);
     setCurrentControlIndex(firstUnassigned >= 0 ? firstUnassigned : 0);
     setFocusedInput(controlsToLearn[firstUnassigned >= 0 ? firstUnassigned : 0]?.name || null);

  }, [currentAssignments, isOpen]); // Re-run when overlay opens

  useEffect(() => {
      if (isOpen && focusedInput && lastLearnedControl !== null && assignments[focusedInput] !== lastLearnedControl) {
            // Check if this CC is already assigned to another control
            const existingAssignment = Object.entries(assignments).find(
                ([key, value]) => value === lastLearnedControl && key !== focusedInput
            );

            if (existingAssignment) {
                console.warn(`MIDI CC ${lastLearnedControl} is already assigned to ${existingAssignment[0]}. Overwriting.`);
                // Optionally clear the old assignment
                // setAssignments(prev => ({ ...prev, [existingAssignment[0]]: undefined }));
            }


            setAssignments(prev => ({ ...prev, [focusedInput]: lastLearnedControl }));

            // Move to the next control
            const nextIndex = currentControlIndex + 1;
            if (nextIndex < controlsToLearn.length) {
                setCurrentControlIndex(nextIndex);
                setFocusedInput(controlsToLearn[nextIndex].name);
            } else {
                // Last control learned
                setFocusedInput(null);
                 // Consider automatically saving and closing, or require explicit save
                 // onSaveAssignments(updatedAssignments); // Be careful with state updates
                 // onClose();
            }
      }
  }, [lastLearnedControl, focusedInput, currentControlIndex, assignments, isOpen]);


  const handleInputChange = (e: ChangeEvent<HTMLInputElement>, name: keyof MidiAssignments) => {
    const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
     // Basic validation: Ensure it's a number between 0 and 127
     if (value === undefined || (!isNaN(value) && value >= 0 && value <= 127)) {
       setAssignments(prev => ({ ...prev, [name]: value }));
     }
  };

    const handleFocus = (name: keyof MidiAssignments) => {
        setFocusedInput(name);
        const index = controlsToLearn.findIndex(c => c.name === name);
        if(index !== -1) {
            setCurrentControlIndex(index);
        }
    };

    const handleSkip = () => {
         const nextIndex = currentControlIndex + 1;
         if (nextIndex < controlsToLearn.length) {
             setCurrentControlIndex(nextIndex);
             setFocusedInput(controlsToLearn[nextIndex].name);
         } else {
             setFocusedInput(null); // Reached end
         }
    }

  const handleSave = () => {
    onSaveAssignments(assignments);
    onClose();
  };

  const currentControl = controlsToLearn[currentControlIndex];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MIDI Learn Setup</DialogTitle>
          <DialogDescription>
            Assign your MIDI controller's knobs and buttons.
            {currentControl && focusedInput === currentControl.name ? (
                ` Please press or move the control for: **${currentControl.label}**.`
            ): " Click an input field and move the corresponding control, or enter the CC number manually."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {controlsToLearn.map(({ name, label }, index) => (
            <div key={name} className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor={name} className="text-right col-span-1">
                {label}
              </Label>
              <Input
                id={name}
                name={name}
                type="number"
                value={assignments[name] ?? ''}
                onChange={(e) => handleInputChange(e, name)}
                onFocus={() => handleFocus(name)}
                min="0"
                max="127"
                className={`col-span-3 ${focusedInput === name ? 'ring-2 ring-accent' : ''}`}
                placeholder="Move control or type CC"
              />
            </div>
          ))}
        </div>

        <DialogFooter className="sticky bottom-0 bg-background py-4 border-t">
           <Button type="button" variant="outline" onClick={handleSkip} disabled={!focusedInput}>
             Skip Current
           </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save Assignments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MIDILearnOverlay;
