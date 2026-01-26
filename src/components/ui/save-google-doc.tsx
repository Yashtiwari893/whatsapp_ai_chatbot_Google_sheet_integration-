"use client";

import { useState } from "react";

type Props = {
  phoneNumber: string;
};

export function SaveGoogleDoc({ phoneNumber }: Props) {
  const [docUrl, setDocUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!docUrl.trim()) {
      alert("Please enter Google Doc URL or ID");
      return;
    }

    if (!phoneNumber) {
      alert("Phone number missing");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/save-google-doc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          doc_url: docUrl.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save doc");
      }

      alert("✅ Google Doc saved successfully");
    } catch (err) {
      alert(`❌ ${err instanceof Error ? err.message : "Something went wrong"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={docUrl}
        onChange={(e) => setDocUrl(e.target.value)}
        placeholder="Paste Google Doc URL or Doc ID"
        className="w-full px-3 py-2 border rounded-md"
      />

      <button
        onClick={handleSave}
        disabled={loading}
        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? "Saving..." : "Save Google Doc"}
      </button>
    </div>
  );
}