'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, MicOff, Upload, Download, Loader2 } from 'lucide-react';

interface TranscriptionResult {
  rawTranscript: string;
  cleanedTranscript: string;
  language?: string;
  timestamps?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export default function SpeechToTextPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Starts audio recording from microphone
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudioBlob(audioBlob, 'recording.webm');

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('Failed to access microphone. Please check permissions.');
      console.error('Recording error:', err);
    }
  }, []);

  /**
   * Stops audio recording
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  /**
   * Processes audio blob by sending to API
   */
  const processAudioBlob = async (audioBlob: Blob, filename: string) => {
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, filename);

      const response = await fetch('/api/stt/mistral', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Transcription failed');
      }

      setTranscription(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed');
      console.error('Processing error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handles file upload
   */
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setError(null);

    // Validate file type
    const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/x-m4a'];
    if (!allowedTypes.includes(file.type)) {
      setError('Unsupported file type. Please upload WAV, MP3, WebM, M4A, or MP4 audio files.');
      return;
    }

    // Validate file size (25MB)
    if (file.size > 25 * 1024 * 1024) {
      setError('File too large. Maximum size is 25MB.');
      return;
    }

    await processAudioBlob(file, file.name);
  }, []);

  /**
   * Downloads transcription as text file
   */
  const downloadTranscription = useCallback(() => {
    if (!transcription) return;

    const content = `Raw Transcript:\n${transcription.rawTranscript}\n\nCleaned Transcript:\n${transcription.cleanedTranscript}\n\nLanguage: ${transcription.language || 'Unknown'}`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [transcription]);

  /**
   * Formats timestamp for display
   */
  const formatTimestamp = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Speech-to-Text with Mistral AI</h1>
        <p className="text-gray-600">
          Convert audio to text with high accuracy. Supports multiple languages including English, Hindi, Gujarati, and Hinglish.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Input Section */}
        <Card>
          <CardHeader>
            <CardTitle>Audio Input</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Recording Controls */}
            <div className="flex gap-2">
              <Button
                onClick={isRecording ? stopRecording : startRecording}
                variant={isRecording ? "destructive" : "default"}
                disabled={isProcessing}
                className="flex-1"
              >
                {isRecording ? (
                  <>
                    <MicOff className="w-4 h-4 mr-2" />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 mr-2" />
                    Start Recording
                  </>
                )}
              </Button>
            </div>

            <div className="text-center text-sm text-gray-500">or</div>

            {/* File Upload */}
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isProcessing}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                disabled={isProcessing}
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Audio File
              </Button>
              {selectedFile && (
                <p className="text-sm text-gray-600">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>

            {/* Processing Status */}
            {isProcessing && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span>Processing audio...</span>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Transcription Results
              {transcription && (
                <Button
                  onClick={downloadTranscription}
                  variant="outline"
                  size="sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {transcription ? (
              <ScrollArea className="h-96">
                <div className="space-y-4">
                  {/* Metadata */}
                  <div className="text-sm text-gray-600 space-y-1">
                    {transcription.language && (
                      <p><strong>Language:</strong> {transcription.language}</p>
                    )}
                  </div>

                  {/* Cleaned Transcript */}
                  <div>
                    <h3 className="font-semibold mb-2">Cleaned Transcript</h3>
                    <Textarea
                      value={transcription.cleanedTranscript}
                      readOnly
                      className="min-h-24"
                    />
                  </div>

                  {/* Raw Transcript */}
                  <div>
                    <h3 className="font-semibold mb-2">Raw Transcript</h3>
                    <Textarea
                      value={transcription.rawTranscript}
                      readOnly
                      className="min-h-24"
                    />
                  </div>

                  {/* Timestamps */}
                  {transcription.timestamps && transcription.timestamps.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">Timestamps</h3>
                      <ScrollArea className="h-32 border rounded p-2">
                        {transcription.timestamps.map((segment, index) => (
                          <div key={index} className="text-sm mb-1">
                            <span className="font-mono text-gray-500">
                              [{formatTimestamp(segment.start)} - {formatTimestamp(segment.end)}]
                            </span>
                            {' '}
                            {segment.text}
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-500">
                <div className="text-center">
                  <Mic className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Start recording or upload an audio file to see transcription results</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Supported Formats Info */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <h3 className="font-semibold mb-2">Supported Formats & Languages</h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium mb-1">Audio Formats:</p>
              <ul className="list-disc list-inside text-gray-600">
                <li>WAV</li>
                <li>MP3</li>
                <li>WebM</li>
                <li>M4A</li>
                <li>MP4</li>
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1">Supported Languages:</p>
              <ul className="list-disc list-inside text-gray-600">
                <li>English</li>
                <li>Hindi</li>
                <li>Gujarati</li>
                <li>Hinglish</li>
                <li>Auto-detection</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}