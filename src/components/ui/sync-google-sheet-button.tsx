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
  total_rows: number;
};

export function SyncGoogleSheetButton({ phoneNumber }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [lastResult, setLastResult] = useState<{ totalRows: number; newRows: number; deletedRows: number; lastSyncedAt: string } | null>(null);

  // Fetch current sync status
  const fetchSyncStatus = async () => {
    try {
      const res = await fetch(`/api/sheet-preview?phone_number=${encodeURIComponent(phoneNumber)}`);
      if (res.ok) {
        const data = await res.json();
        setSyncStatus({
          last_synced_at: data.last_synced_at,
          total_rows: data.total || 0
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

      const res = await fetch("/api/sync-google-sheet", {
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
        alert(data.error || "Google Sheet sync failed");
        return;
      }

      // Update status and show results
      setLastResult({
        totalRows: data.totalRows,
        newRows: data.newRows,
        deletedRows: data.deletedRows,
        lastSyncedAt: data.lastSyncedAt
      });

      // Refresh sync status
      await fetchSyncStatus();

      // Show detailed sync results
      alert(`✅ Google Sheet synced!\n\n📊 Results:\n• Total rows: ${data.totalRows}\n• Added: ${data.newRows} rows\n• Deleted: ${data.deletedRows} rows\n• Last synced: ${new Date(data.lastSyncedAt).toLocaleString()}`);
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
          {syncing ? "Syncing..." : "Sync Google Sheet Knowledge"}
        </Button>

        <Link href={`/sheet-preview?phone_number=${encodeURIComponent(phoneNumber)}`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="w-4 h-4" />
          </Button>
        </Link>
      </div>

      {syncStatus && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground space-y-1">
              <div>Last synced: {syncStatus.last_synced_at ? new Date(syncStatus.last_synced_at).toLocaleString() : "Never"}</div>
              <div>Total rows: {syncStatus.total_rows}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {lastResult && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm space-y-1">
              <div className="font-medium">Last sync results:</div>
              <div>• Total rows: {lastResult.totalRows}</div>
              <div>• Added: {lastResult.newRows} rows</div>
              <div>• Deleted: {lastResult.deletedRows} rows</div>
              <div>• Synced at: {new Date(lastResult.lastSyncedAt).toLocaleString()}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
