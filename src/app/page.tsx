
"use client"; // Required for hooks and interactivity

import React from 'react';
import StepGrid from '@/components/sequencer/StepGrid';
import TrackControls from '@/components/sequencer/TrackControls';
import GlobalControls from '@/components/sequencer/GlobalControls';
import PatternSelector from '@/components/sequencer/PatternSelector';
import MIDILearnOverlay from '@/components/sequencer/MIDILearnOverlay';
import { useSequencerLogic } from '@/hooks/useSequencerLogic';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from "@/components/ui/toaster";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";


export default function SequencerPage() {
  const {
    sequencerState,
    currentPattern,
    currentTrack,
    midiError,
    actions,
  } = useSequencerLogic();


  if (midiError) {
    return (
       <div className="flex items-center justify-center min-h-screen p-4">
        <Alert variant="destructive" className="max-w-lg">
          <Terminal className="h-4 w-4" />
          <AlertTitle>MIDI Error</AlertTitle>
          <AlertDescription>
            {midiError} Please check your browser settings and ensure you're using HTTPS.
          </AlertDescription>
        </Alert>
       </div>
    );
  }

   // Handle loading state or initial pattern/track not being ready yet
   if (!currentPattern || !currentTrack) {
    return (
       <div className="flex items-center justify-center min-h-screen">
         Loading Sequencer... {/* Or a proper skeleton loader */}
       </div>
     );
   }


  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex-shrink-0 z-10">
        <GlobalControls
          bpm={sequencerState.bpm}
          swing={sequencerState.swing}
          isPlaying={sequencerState.isPlaying}
          midiInputDevices={sequencerState.midiInputDevices}
          selectedInputDeviceId={sequencerState.selectedInputDeviceId}
          midiLearnActive={sequencerState.midiLearnActive}
          onBpmChange={actions.handleBpmChange}
          onSwingChange={actions.handleSwingChange}
          onPlay={actions.handlePlay}
          onStop={actions.handleStop}
          onInputDeviceChange={actions.handleInputDeviceChange}
          onToggleMidiLearn={actions.handleToggleMidiLearn}
        />
         <PatternSelector
           patterns={Object.values(sequencerState.patterns)}
           currentPatternId={sequencerState.currentPatternId}
           nextPatternQueue={sequencerState.nextPatternQueue}
           onSelectPattern={actions.handlePatternSelect}
           onQueuePattern={actions.handlePatternSelect} // Same action handles queueing if playing
           onAddPattern={() => actions.handleAddPattern()}
           onCopyPattern={actions.handleCopyPattern}
           onDeletePattern={actions.handleDeletePattern}
           isPlaying={sequencerState.isPlaying}
         />
      </header>

      <main className="flex-grow flex flex-col md:flex-row overflow-hidden">
        {/* Track List / Selector Panel (Optional - could be integrated differently) */}
         <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border p-4 flex-shrink-0 overflow-y-auto">
            <h2 className="text-lg font-semibold mb-3">Tracks</h2>
            <ScrollArea className="h-[calc(100%-40px)]"> {/* Adjust height as needed */}
              <div className="space-y-2 pr-3">
                  {Object.values(currentPattern.tracks)
                    .sort((a,b) => a.trackNumber - b.trackNumber) // Ensure tracks are ordered
                    .map((track) => (
                      <Button
                        key={track.id}
                        variant={track.id === currentTrack.id ? 'secondary' : 'ghost'}
                        className={`w-full justify-start ${track.muted ? 'text-muted-foreground line-through' : ''}`}
                        onClick={() => actions.handleTrackSelect(track.id)}
                         onDoubleClick={() => actions.toggleTrackMute(track.id)} // Double click to mute/unmute
                         title={track.muted ? 'Unmute (Double Click)' : 'Mute (Double Click)'}
                      >
                        {track.name}
                      </Button>
                  ))}
                 <Button variant="outline" className="w-full mt-4" onClick={() => actions.handleAddTrack()}>
                     + Add Track
                  </Button>
              </div>
            </ScrollArea>
         </aside>


        {/* Main Content Area (Track Controls and Step Grid) */}
        <div className="flex-grow flex flex-col p-4 md:p-6 space-y-4 md:space-y-6 overflow-y-auto">
          <TrackControls
            track={currentTrack}
            outputDevices={sequencerState.midiOutputDevices}
            onTrackChange={actions.handleTrackChange}
             onDeleteTrack={actions.handleDeleteTrack}
             onCopyTrack={() => console.log("Copy track requested")} // Placeholder
          />
          <StepGrid
            steps={currentTrack.steps}
            currentStepIndex={sequencerState.activeStepIndex}
            selectedStepId={sequencerState.selectedStepId}
            onStepClick={actions.handleStepToggle} // Toggle step on/off on click
            // Consider adding onStepSelect if separate selection is needed:
            // onStepSelect={actions.handleStepSelect}
          />
           {/* Display selected step details - optional */}
           {sequencerState.selectedStepId && (
            <div className="p-2 bg-card border rounded-md text-xs text-muted-foreground">
              Selected Step: {sequencerState.selectedStepId}
              {/* Add more details here if needed, e.g., Note, Velocity */}
              {/* Note: {currentTrack.steps.find(s => s.id === sequencerState.selectedStepId)?.notePitch} */}
            </div>
          )}
        </div>
      </main>


       {/* MIDI Learn Overlay */}
        <MIDILearnOverlay
            isOpen={sequencerState.midiLearnActive}
            onClose={actions.handleToggleMidiLearn} // Close toggles learn mode off
            currentAssignments={sequencerState.midiAssignments}
            onSaveAssignments={actions.handleSaveMidiAssignments}
            lastLearnedControl={sequencerState.lastLearnedControl}
        />

       <Toaster /> {/* Add Toaster for notifications */}
    </div>
  );
}

