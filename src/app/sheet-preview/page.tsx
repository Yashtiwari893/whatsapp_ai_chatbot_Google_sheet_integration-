"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

type SheetRow = Record<string, any>;

function SheetPreviewContent() {
  const searchParams = useSearchParams();
  const phone_number = searchParams.get("phone_number");

  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSheetPreview = useCallback(async () => {
    if (!phone_number) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/sheet-preview?phone_number=${encodeURIComponent(phone_number)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch sheet data");
      }

      setRows(data.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [phone_number]);

  useEffect(() => {
    fetchSheetPreview();
  }, [fetchSheetPreview]);

  if (!phone_number) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Sheet Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-500">Phone number parameter is required</p>
            <Link href="/files">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Files
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/files">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Sheet Preview</h1>
          <p className="text-muted-foreground">Phone: {phone_number}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sheet Data ({rows.length} rows)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>Loading sheet data...</p>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">No sheet data found for this phone number.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-50">
                    {Object.keys(rows[0] || {}).map((key) => (
                      <th key={key} className="border border-gray-300 px-4 py-2 text-left font-medium">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      {Object.values(row).map((value: any, cellIndex) => (
                        <td key={cellIndex} className="border border-gray-300 px-4 py-2">
                          {value?.toString() || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SheetPreviewPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6">Loading...</div>}>
      <SheetPreviewContent />
    </Suspense>
  );
}