"use client";

import React from 'react';
import StepGrid from '@/components/sequencer/StepGrid';
import TrackControls from '@/components/sequencer/TrackControls';
import GlobalControls from '@/components/sequencer/GlobalControls';
import PatternSelector from '@/components/sequencer/PatternSelector';
import MIDILearnOverlay from '@/components/sequencer/MIDILearnOverlay';
import { useSequencer } from '@/hooks/useSequencer';
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
    actions,
    midi,
  } = useSequencer();

  // Note: MIDI is optional - the sequencer works without it
  // The MIDI controller hook handles unsupported browsers gracefully

  // Handle loading state
  if (!currentPattern || !currentTrack) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        Loading Sequencer...
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
          onBpmChange={actions.setBpm}
          onSwingChange={actions.setSwing}
          onPlay={actions.play}
          onStop={actions.stop}
          onInputDeviceChange={actions.selectInputDevice}
          onToggleMidiLearn={actions.toggleMidiLearn}
        />
        <PatternSelector
          patterns={sequencerState.patterns}
          currentPatternId={sequencerState.currentPatternId}
          nextPatternQueue={sequencerState.nextPatternQueue}
          onSelectPattern={actions.selectPattern}
          onQueuePattern={actions.queuePattern}
          onAddPattern={() => actions.addPattern(undefined)}
          onCopyPattern={actions.copyPattern}
          onDeletePattern={actions.deletePattern}
          isPlaying={sequencerState.isPlaying}
        />
      </header>

      <main className="flex-grow flex flex-col md:flex-row overflow-hidden">
        {/* Track List Panel */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border p-4 flex-shrink-0 overflow-y-auto">
          <h2 className="text-lg font-semibold mb-3">Tracks</h2>
          <ScrollArea className="h-[calc(100%-40px)]">
            <div className="space-y-2 pr-3">
              {sequencerState.tracks.map((track) => (
                <Button
                  key={track.id}
                  variant={track.id === currentTrack.id ? 'secondary' : 'ghost'}
                  className={`w-full justify-start ${track.muted ? 'text-muted-foreground line-through' : ''}`}
                  onClick={() => actions.selectTrack(track.id)}
                  onDoubleClick={() => actions.toggleTrackMute(track.id)}
                  title={track.muted ? 'Unmute (Double Click)' : 'Mute (Double Click)'}
                >
                  {track.name}
                </Button>
              ))}
              <Button variant="outline" className="w-full mt-4" onClick={() => actions.addTrack(undefined)}>
                + Add Track
              </Button>
            </div>
          </ScrollArea>
        </aside>

        {/* Main Content Area */}
        <div className="flex-grow flex flex-col p-4 md:p-6 space-y-4 md:space-y-6 overflow-y-auto">
          <TrackControls
            track={currentTrack}
            outputDevices={sequencerState.midiOutputDevices}
            onTrackChange={(id, changes) => actions.updateTrack(id, changes)}
            onDeleteTrack={actions.deleteTrack}
            onCopyTrack={() => console.log("Copy track requested")}
          />
          <StepGrid
            steps={currentTrack.steps}
            currentStepIndex={sequencerState.currentStep}
            selectedStepId={sequencerState.selectedStepId}
            onStepClick={(stepId) => actions.toggleStep(stepId)}
            key={currentTrack.id}
          />
          {sequencerState.selectedStepId && (
            <div className="p-2 bg-card border rounded-md text-xs text-muted-foreground">
              Selected Step: {sequencerState.selectedStepId}
            </div>
          )}
        </div>
      </main>

      {/* MIDI Learn Overlay */}
      <MIDILearnOverlay
        isOpen={sequencerState.midiLearnActive}
        onClose={actions.toggleMidiLearn}
        currentAssignments={sequencerState.midiAssignments}
        onSaveAssignments={actions.saveMidiAssignments}
        lastLearnedControl={sequencerState.lastLearnedControl}
      />

      <Toaster />
    </div>
  );
}
