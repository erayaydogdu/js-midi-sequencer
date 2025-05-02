
import React, { useMemo } from 'react'; // Import useMemo
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from '@/components/ui/slider';
import type { MIDIDevice } from '@/types/sequencer';
import { Play, StopCircle, Zap, Settings, Mic } from 'lucide-react'; // Using Zap for swing, Mic for input device

interface GlobalControlsProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiInputDevices: MIDIDevice[];
  selectedInputDeviceId?: string;
  midiLearnActive: boolean;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onPlay: () => void;
  onStop: () => void;
  onInputDeviceChange: (deviceId: string) => void;
  onToggleMidiLearn: () => void;
}

const GlobalControls: React.FC<GlobalControlsProps> = ({
  bpm,
  swing,
  isPlaying,
  midiInputDevices,
  selectedInputDeviceId,
  midiLearnActive,
  onBpmChange,
  onSwingChange,
  onPlay,
  onStop,
  onInputDeviceChange,
  onToggleMidiLearn,
}) => {
  const handleBpmInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(event.target.value, 10);
    if (!isNaN(newBpm) && newBpm > 0 && newBpm < 999) { // Add reasonable limits
      onBpmChange(newBpm);
    }
  };

  const handleSwingSliderChange = (value: number[]) => {
    // Only update if the value actually changed to prevent infinite loops
    if (value[0] !== swing) {
      onSwingChange(value[0]);
    }
  };

  // Memoize the value array for the Slider to prevent infinite loops
  const swingValue = useMemo(() => [swing], [swing]);


  return (
    <div className="p-4 border-b border-border bg-card flex flex-wrap items-center justify-between gap-4 shadow-sm">
      <div className="flex items-center gap-4">
        {/* Play/Stop */}
        <Button
          onClick={isPlaying ? onStop : onPlay}
          variant={isPlaying ? "destructive" : "default"}
          size="lg"
          className="w-24"
        >
          {isPlaying ? <StopCircle className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />}
          {isPlaying ? 'Stop' : 'Play'}
        </Button>
      </div>

       <div className="flex items-center gap-6 flex-grow justify-center">
         {/* BPM */}
        <div className="flex items-center gap-2">
          <Label htmlFor="bpm-input" className="text-sm font-medium text-muted-foreground whitespace-nowrap">BPM</Label>
          <Input
            id="bpm-input"
            type="number"
            value={bpm}
            onChange={handleBpmInputChange}
            min="1"
            max="999"
            className="w-20 h-9 text-center"
          />
        </div>

        {/* Swing */}
        <div className="flex items-center gap-2 w-40">
           <Label htmlFor="swing-slider" className="text-sm font-medium text-muted-foreground whitespace-nowrap flex items-center">
             <Zap className="h-4 w-4 mr-1 text-accent"/> Swing ({swing}%)
           </Label>
           <Slider
             id="swing-slider"
             min={0}
             max={75} // Max swing usually around 75% for musical purposes
             step={1}
             value={swingValue} // Use memoized value
             onValueChange={handleSwingSliderChange}
             className="w-full"
           />
        </div>
       </div>


      <div className="flex items-center gap-4">
        {/* MIDI Input Device */}
        <div className="flex items-center gap-2">
           <Label htmlFor="input-device-select" className="text-sm font-medium text-muted-foreground whitespace-nowrap flex items-center">
              <Mic className="h-4 w-4 mr-1 text-accent"/> Input
           </Label>
          <Select
            value={selectedInputDeviceId || ''}
            onValueChange={onInputDeviceChange}
          >
            <SelectTrigger id="input-device-select" className="w-[180px] h-9">
              <SelectValue placeholder="Select MIDI Input" />
            </SelectTrigger>
            <SelectContent>
              {midiInputDevices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name}
                </SelectItem>
              ))}
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* MIDI Learn Toggle */}
        <Button
          variant={midiLearnActive ? "secondary" : "outline"}
          size="icon"
          onClick={onToggleMidiLearn}
          title={midiLearnActive ? "Disable MIDI Learn" : "Enable MIDI Learn"}
          className={midiLearnActive ? 'ring-2 ring-accent' : ''}
        >
          <Settings className="h-5 w-5" />
          <span className="sr-only">Toggle MIDI Learn</span>
        </Button>
      </div>
    </div>
  );
};

export default GlobalControls;

