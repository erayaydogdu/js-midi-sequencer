
import type React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Copy, Trash2 } from 'lucide-react';
import type { Pattern } from '@/types/sequencer';
import { cn } from '@/lib/utils';

interface PatternSelectorProps {
  patterns: Pattern[];
  currentPatternId: string;
  nextPatternQueue: string[];
  onSelectPattern: (patternId: string) => void;
  onQueuePattern: (patternId: string) => void; // For adding to next queue
  onAddPattern: () => void;
  onCopyPattern: (patternId: string) => void;
  onDeletePattern: (patternId: string) => void;
  isPlaying: boolean; // To adjust behavior when playing
}

const PatternSelector: React.FC<PatternSelectorProps> = ({
  patterns,
  currentPatternId,
  nextPatternQueue,
  onSelectPattern,
  onQueuePattern,
  onAddPattern,
  onCopyPattern,
  onDeletePattern,
  isPlaying,
}) => {
  const currentPattern = patterns.find(p => p.id === currentPatternId);

  const handleSelect = (patternId: string) => {
    if (isPlaying) {
      onQueuePattern(patternId);
    } else {
      onSelectPattern(patternId);
    }
  };

  return (
    <div className="p-4 border-b border-border bg-card flex items-center justify-between gap-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Pattern:</span>
        <Select value={currentPatternId} onValueChange={handleSelect}>
           <SelectTrigger className="w-[180px] h-9">
             <SelectValue placeholder="Select Pattern" />
           </SelectTrigger>
           <SelectContent>
             {patterns.map((p) => (
               <SelectItem key={p.id} value={p.id}>
                 {p.name}
               </SelectItem>
             ))}
           </SelectContent>
         </Select>
      </div>

       {isPlaying && nextPatternQueue.length > 0 && (
        <div className="text-xs text-muted-foreground hidden md:block">
          Next: {nextPatternQueue.map(id => patterns.find(p => p.id === id)?.name || '?').join(', ')}
        </div>
      )}


      <div className="flex items-center gap-2">
         <Button variant="outline" size="icon" onClick={onAddPattern} title="Add New Pattern">
           <PlusCircle className="h-5 w-5" />
         </Button>
         {currentPattern && (
           <>
             <Button variant="outline" size="icon" onClick={() => onCopyPattern(currentPatternId)} title="Copy Current Pattern">
               <Copy className="h-5 w-5" />
             </Button>
             {patterns.length > 1 && ( // Only allow delete if more than one pattern exists
                <Button variant="outline" size="icon" onClick={() => onDeletePattern(currentPatternId)} title="Delete Current Pattern">
                 <Trash2 className="h-5 w-5 text-destructive/80 hover:text-destructive" />
               </Button>
              )}
           </>
         )}
      </div>
    </div>
  );
};

export default PatternSelector;

