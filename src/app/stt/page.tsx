"use client";

import { useState, useRef } from "react";

interface TranscriptionResult {
    rawTranscript: string;
    cleanedTranscript: string;
    language: string;
    confidence: number;
    wordCount: number;
    processingTime: number;
    method: string;
}

export default function MistralSTTPage() {
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [result, setResult] = useState<TranscriptionResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;

            const chunks: Blob[] = [];
            mediaRecorder.ondataavailable = (event) => {
                chunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                setAudioBlob(blob);
            };

            mediaRecorder.start();
            setIsRecording(true);
            setError(null);
        } catch (err) {
            setError("Failed to access microphone: " + (err as Error).message);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && streamRef.current) {
            mediaRecorderRef.current.stop();
            streamRef.current.getTracks().forEach(track => track.stop());
            setIsRecording(false);
        }
    };

    const transcribeAudio = async () => {
        if (!audioBlob) return;

        setLoading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('language', 'auto');
            formData.append('enableCleanup', 'true');

            const response = await fetch('/api/stt/mistral', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Transcription failed');
            }

            setResult(data.data);
        } catch (err) {
            setError("Transcription failed: " + (err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">
                    🎤 Mistral-Enhanced Speech-to-Text
                </h1>

                <div className="space-y-6">
                    {/* Recording Section */}
                    <div className="border rounded-lg p-4">
                        <h2 className="text-xl font-semibold mb-4">Record Audio</h2>

                        <div className="flex gap-4 items-center">
                            {!isRecording ? (
                                <button
                                    onClick={startRecording}
                                    className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                                >
                                    🎤 Start Recording
                                </button>
                            ) : (
                                <button
                                    onClick={stopRecording}
                                    className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                                >
                                    ⏹️ Stop Recording
                                </button>
                            )}

                            {audioBlob && (
                                <div className="text-sm text-gray-600">
                                    Recorded: {(audioBlob.size / 1024 / 1024).toFixed(2)} MB
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Transcription Section */}
                    {audioBlob && (
                        <div className="border rounded-lg p-4">
                            <h2 className="text-xl font-semibold mb-4">Transcribe Audio</h2>

                            <button
                                onClick={transcribeAudio}
                                disabled={loading}
                                className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                            >
                                {loading ? "🔄 Transcribing..." : "📝 Transcribe with Mistral"}
                            </button>
                        </div>
                    )}

                    {/* Results Section */}
                    {result && (
                        <div className="border rounded-lg p-4">
                            <h2 className="text-xl font-semibold mb-4">Transcription Results</h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h3 className="font-medium text-gray-700 mb-2">Raw Transcript:</h3>
                                    <p className="text-gray-600 bg-gray-50 p-3 rounded">
                                        {result.rawTranscript}
                                    </p>
                                </div>

                                <div>
                                    <h3 className="font-medium text-gray-700 mb-2">Mistral-Enhanced:</h3>
                                    <p className="text-gray-800 bg-blue-50 p-3 rounded font-medium">
                                        {result.cleanedTranscript}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                    <span className="font-medium">Language:</span> {result.language}
                                </div>
                                <div>
                                    <span className="font-medium">Confidence:</span> {(result.confidence * 100).toFixed(1)}%
                                </div>
                                <div>
                                    <span className="font-medium">Words:</span> {result.wordCount}
                                </div>
                                <div>
                                    <span className="font-medium">Time:</span> {result.processingTime}ms
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error Display */}
                    {error && (
                        <div className="border border-red-200 rounded-lg p-4 bg-red-50">
                            <h3 className="text-red-800 font-medium mb-2">Error:</h3>
                            <p className="text-red-700">{error}</p>
                        </div>
                    )}
                </div>

                {/* Features List */}
                <div className="mt-8 border-t pt-6">
                    <h2 className="text-xl font-semibold mb-4">✨ Features</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <ul className="space-y-2">
                            <li>🎯 Local Whisper (Free primary STT)</li>
                            <li>🧠 Mistral AI text enhancement</li>
                            <li>🌍 Multi-language support</li>
                            <li>🎵 Audio format flexibility</li>
                        </ul>
                        <ul className="space-y-2">
                            <li>🔄 Automatic fallbacks</li>
                            <li>⚡ Real-time processing</li>
                            <li>🛡️ Background noise handling</li>
                            <li>📊 Confidence scoring</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}