"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

type DocChunk = {
  content: string;
};

function DocPreviewContent() {
  const searchParams = useSearchParams();
  const phone_number = searchParams.get("phone_number");

  const [chunks, setChunks] = useState<DocChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  const [docName, setDocName] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const fetchDocPreview = useCallback(async () => {
    if (!phone_number) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/doc-preview?phone_number=${encodeURIComponent(phone_number)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch doc data");
      }

      setChunks(data.chunks || []);
      setConnected(data.connected || false);
      setDocId(data.docId || null);
      setDocName(data.docName || null);
      setLastSyncedAt(data.last_synced_at || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [phone_number]);

  useEffect(() => {
    fetchDocPreview();
  }, [fetchDocPreview]);

  if (!phone_number) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Doc Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-500">No phone number provided</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/files">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Files
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Google Doc Preview</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Document Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p><strong>Phone Number:</strong> {phone_number}</p>
            <p><strong>Connected:</strong> {connected ? "Yes" : "No"}</p>
            {docId && <p><strong>Doc ID:</strong> {docId}</p>}
            {docName && <p><strong>Doc Name:</strong> {docName}</p>}
            {lastSyncedAt && <p><strong>Last Synced:</strong> {new Date(lastSyncedAt).toLocaleString()}</p>}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="p-6">
            <p>Loading document chunks...</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-red-500">Error: {error}</p>
          </CardContent>
        </Card>
      ) : !connected ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-gray-500">No Google Doc connected for this phone number.</p>
          </CardContent>
        </Card>
      ) : chunks.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-gray-500">No chunks found. Try syncing the document first.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Document Chunks ({chunks.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {chunks.map((chunk, index) => (
                <div key={index} className="border rounded p-4 bg-gray-50">
                  <div className="text-sm text-gray-600 mb-2">Chunk {index + 1}</div>
                  <div className="text-sm whitespace-pre-wrap">{chunk.content}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DocPreviewPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6"><p>Loading...</p></div>}>
      <DocPreviewContent />
    </Suspense>
  );
}