
import type React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input'; // Assuming Input component exists
import { Slider } from '@/components/ui/slider'; // Assuming Slider component exists
import type { Track, MIDIDevice } from '@/types/sequencer';
import { Volume2, VolumeX, Trash2, Copy } from 'lucide-react';

interface TrackControlsProps {
  track: Track;
  outputDevices: MIDIDevice[];
  onTrackChange: (trackId: string, changes: Partial<Track>) => void;
  onDeleteTrack: (trackId: string) => void;
  onCopyTrack: (trackId: string) => void; // Placeholder for copy functionality
}

const MIDI_CHANNELS = Array.from({ length: 16 }, (_, i) => ({
  value: i.toString(16).padStart(4, '0'), // Original format '0000', '0001', ...
  label: `Ch ${i + 1}`,
}));


const TrackControls: React.FC<TrackControlsProps> = ({
  track,
  outputDevices,
  onTrackChange,
  onDeleteTrack,
  onCopyTrack,
}) => {
  const handleDeviceChange = (deviceId: string) => {
    onTrackChange(track.id, { outputDeviceId: deviceId });
  };

  const handleChannelChange = (channel: string) => {
    onTrackChange(track.id, { midiChannel: channel });
  };

  const handleMuteToggle = () => {
    onTrackChange(track.id, { muted: !track.muted });
  };

    const handleTransposeChange = (value: number[]) => {
    onTrackChange(track.id, { transpose: value[0] });
  };


  return (
    <div className="p-4 border border-border rounded-lg bg-card space-y-4 shadow">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-card-foreground">{track.name}</h3>
        <div className="flex items-center space-x-2">
           <Button variant="ghost" size="icon" onClick={handleMuteToggle} title={track.muted ? "Unmute Track" : "Mute Track"}>
            {track.muted ? <VolumeX className="h-5 w-5 text-destructive" /> : <Volume2 className="h-5 w-5 text-muted-foreground hover:text-foreground" />}
          </Button>
          {/* <Button variant="ghost" size="icon" onClick={() => onCopyTrack(track.id)} title="Copy Track">
             <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </Button> */}
          <Button variant="ghost" size="icon" onClick={() => onDeleteTrack(track.id)} title="Delete Track">
            <Trash2 className="h-4 w-4 text-destructive/80 hover:text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* MIDI Output Device */}
        <div className="space-y-1">
          <Label htmlFor={`device-${track.id}`} className="text-sm font-medium text-muted-foreground">Output Device</Label>
          <Select
            value={track.outputDeviceId || ''}
            onValueChange={handleDeviceChange}
          >
            <SelectTrigger id={`device-${track.id}`} className="w-full">
              <SelectValue placeholder="Select MIDI Output" />
            </SelectTrigger>
            <SelectContent>
              {outputDevices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name}
                </SelectItem>
              ))}
               <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* MIDI Channel */}
        <div className="space-y-1">
          <Label htmlFor={`channel-${track.id}`} className="text-sm font-medium text-muted-foreground">MIDI Channel</Label>
          <Select
            value={track.midiChannel}
            onValueChange={handleChannelChange}
          >
            <SelectTrigger id={`channel-${track.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MIDI_CHANNELS.map((channel) => (
                <SelectItem key={channel.value} value={channel.value}>
                  {channel.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

       {/* Transpose Slider */}
       <div className="space-y-1">
          <Label htmlFor={`transpose-${track.id}`} className="text-sm font-medium text-muted-foreground">
            Transpose ({track.transpose >= 0 ? '+' : ''}{track.transpose})
          </Label>
          <Slider
            id={`transpose-${track.id}`}
            min={-12}
            max={12}
            step={1}
            value={[track.transpose]}
            onValueChange={handleTransposeChange}
            className="w-full"
          />
        </div>

      {/* Placeholder for other track controls like Volume, Pan, etc. */}
      {/* Example:
      <div className="space-y-1">
        <Label htmlFor={`volume-${track.id}`} className="text-sm font-medium text-muted-foreground">Volume</Label>
        <Slider id={`volume-${track.id}`} defaultValue={[100]} max={127} step={1} />
      </div>
      */}
    </div>
  );
};

export default TrackControls;
