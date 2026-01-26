"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

type Props = {
  phoneNumber: string;
};

type SyncStatus = {
  last_synced_at: string | null;
  total_chunks: number;
};

export function SyncGoogleDocButton({ phoneNumber }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [lastResult, setLastResult] = useState<{ totalChunks: number; newChunks: number; deletedChunks: number; updatedChunks: number; lastSyncedAt: string } | null>(null);

  // Fetch current sync status
  const fetchSyncStatus = async () => {
    try {
      const res = await fetch(`/api/doc-preview?phone_number=${encodeURIComponent(phoneNumber)}`);
      if (res.ok) {
        const data = await res.json();
        setSyncStatus({
          last_synced_at: data.last_synced_at,
          total_chunks: data.total || 0
        });
      }
    } catch (err) {
      console.error("Error fetching sync status:", err);
    }
  };

  useEffect(() => {
    fetchSyncStatus();
  }, [phoneNumber]);

  async function handleSync() {
    try {
      setSyncing(true);
      setLastResult(null);

      const res = await fetch("/api/sync-google-doc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Google Doc sync failed");
        return;
      }

      // Update status and show results
      setLastResult({
        totalChunks: data.totalChunks,
        newChunks: data.newChunks,
        deletedChunks: data.deletedChunks,
        updatedChunks: data.updatedChunks,
        lastSyncedAt: new Date().toISOString()
      });

      // Refresh sync status
      await fetchSyncStatus();

      // Show detailed sync results
      alert(`✅ Google Doc synced!\n\n📊 Results:\n• Total chunks: ${data.totalChunks}\n• Added: ${data.newChunks} chunks\n• Deleted: ${data.deletedChunks} chunks\n• Updated: ${data.updatedChunks} chunks`);
    } catch (err) {
      console.error("Sync error:", err);
      alert("Something went wrong while syncing");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          onClick={handleSync}
          disabled={syncing}
          className="flex-1"
        >
          {syncing ? "Syncing..." : "Sync Google Doc Knowledge"}
        </Button>

        <Link href={`/doc-preview?phone_number=${encodeURIComponent(phoneNumber)}`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="w-4 h-4" />
          </Button>
        </Link>
      </div>

      {syncStatus && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-gray-600">
              <p>Last synced: {syncStatus.last_synced_at ? new Date(syncStatus.last_synced_at).toLocaleString() : "Never"}</p>
              <p>Total chunks: {syncStatus.total_chunks}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {lastResult && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <h4 className="font-semibold text-green-800 mb-2">Last Sync Results</h4>
            <div className="text-sm text-green-700 space-y-1">
              <p>Total chunks: {lastResult.totalChunks}</p>
              <p>Added: {lastResult.newChunks}</p>
              <p>Deleted: {lastResult.deletedChunks}</p>
              <p>Updated: {lastResult.updatedChunks}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}